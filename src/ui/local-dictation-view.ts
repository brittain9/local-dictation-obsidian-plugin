import { ItemView, Setting, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';

import {
  describePresetBehavior,
  describePresetTiming,
  isLlmPresetTiming,
  type LlmPreset,
  type LlmPresetTiming,
  listPresetEntries,
  resolveActivePresetEntry,
} from '../llm/presets';
import type { LlmCleanupFailure } from '../llm/provider';
import type { LlmPresetStateMutation } from '../settings/llm-preset-state';
import type { PluginSettings } from '../settings/plugin-settings';
import { createSettingGroup } from '../settings/setting-helpers';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import { FocusRefreshController } from './focus-refresh-controller';
import { LlmContextSettingsModal } from './llm-context-settings-modal';
import { LlmModelSettingsModal } from './llm-model-settings-modal';
import { activePresetOverride } from './llm-preset-overrides';
import { formatCleanupFailureBanner } from './llm-provider-ui';
import { LlmRoutingControls } from './llm-routing-controls';
import {
  type LlmSidebarPresentation,
  resolveLlmSidebarPresentation,
} from './llm-sidebar-presentation';
import { INLINE_STATUS_PRESENTATION } from './llm-status';
import { LlmTimingSettingsModal } from './llm-timing-settings-modal';
import { PresetManagerModal } from './preset-manager-modal';

export const LOCAL_DICTATION_VIEW_TYPE = 'local-dictation-sidebar';
const LOCAL_DICTATION_VIEW_ICON = 'audio-lines';
const NARROW_SIDEBAR_WIDTH_PX = 420;

const CLEANUP_MODE_OPTIONS: ReadonlyArray<{ label: string; value: LlmPresetTiming }> = [
  { label: t('llm.timing.option.perUtterance'), value: 'per_utterance' },
  { label: t('llm.timing.option.batch'), value: 'batch' },
];

interface LocalDictationViewDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getSecret: (secretId: string) => string;
  getSettings: () => PluginSettings;
  getLlmCleanupFailure?: () => LlmCleanupFailure | null;
  logger?: PluginLogger | undefined;
  mutatePresetState: (mutation: LlmPresetStateMutation) => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  subscribeLlmCleanupFailure?: (callback: () => void) => () => void;
  synchronizePresets: () => Promise<void>;
}

export class LocalDictationView extends ItemView {
  private focusedInput: HTMLElement | null = null;
  private narrowObserver: ResizeObserver | null = null;
  private deferredRenderPending = false;
  private readonly focusRefreshController: FocusRefreshController;
  private readonly routingControls: LlmRoutingControls;
  private unsubscribeLlmCleanupFailure: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly dependencies: LocalDictationViewDependencies,
  ) {
    super(leaf);
    this.routingControls = new LlmRoutingControls({
      app: this.app,
      feedback: this.dependencies.feedback,
      getSecret: (secretId) => this.dependencies.getSecret(secretId),
      getSettings: () => this.dependencies.getSettings(),
      logger: this.dependencies.logger,
      openModelSettings: () => {
        this.openModelSettings();
      },
      persist: (settings, options) => this.persistSettings(settings, options),
      requestRerender: () => {
        this.scheduleRender();
      },
    });
    this.focusRefreshController = new FocusRefreshController({
      now: () => window.performance.now(),
      refreshPresets: () => this.dependencies.synchronizePresets(),
      refreshProviders: () => this.refreshActiveProvidersIfEnabled({ forceLocal: true }),
    });
    this.routingControls.setInputTracker((element) => {
      this.trackInputFocus(element);
    });
  }

  override getViewType(): string {
    return LOCAL_DICTATION_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return t('plugin.name');
  }

  override getIcon(): string {
    return LOCAL_DICTATION_VIEW_ICON;
  }

  override async onOpen(): Promise<void> {
    this.refresh();
    this.attachWidthObserver();
    this.unsubscribeLlmCleanupFailure =
      this.dependencies.subscribeLlmCleanupFailure?.(() => {
        this.refresh();
      }) ?? null;
    void this.refreshActiveProvidersIfEnabled();
    this.registerDomEvent(this.contentEl.win, 'focus', () => {
      this.focusRefreshController.request();
    });
  }

  // Skip the network probe entirely when LLM transform is off, so opening the
  // sidebar doesn't wake Ollama or hit OpenRouter for a feature the user disabled.
  private refreshActiveProvidersIfEnabled(options?: { forceLocal?: boolean }): Promise<void> {
    const settings = this.dependencies.getSettings();
    if (!settings.llmFeaturesEnabled || settings.llmPostprocessMode === 'off') {
      return Promise.resolve();
    }
    return this.routingControls.refreshActiveProviders(options);
  }

  override async onClose(): Promise<void> {
    this.narrowObserver?.disconnect();
    this.narrowObserver = null;
    this.unsubscribeLlmCleanupFailure?.();
    this.unsubscribeLlmCleanupFailure = null;
    this.routingControls.dispose();
    // Teardown fires blur on any focused input; without this reset that blur
    // would schedule a refresh into the detached contentEl.
    this.deferredRenderPending = false;
    this.focusedInput = null;
  }

  private attachWidthObserver(): void {
    if (this.narrowObserver !== null) return;
    const target = this.contentEl;
    if (typeof ResizeObserver === 'undefined') return;
    this.narrowObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        target.toggleClass(
          'local-dictation-sidebar--narrow',
          width > 0 && width < NARROW_SIDEBAR_WIDTH_PX,
        );
      }
    });
    this.narrowObserver.observe(target);
  }

  refresh(): void {
    const { contentEl } = this;
    const settings = this.dependencies.getSettings();

    this.focusedInput = null;
    this.deferredRenderPending = false;
    contentEl.empty();
    contentEl.addClass('local-dictation-sidebar');

    const presentation = resolveLlmSidebarPresentation(settings);
    this.renderOverview(contentEl, presentation);

    if (!settings.llmFeaturesEnabled) {
      this.renderEmptyState(contentEl, presentation);
      return;
    }

    const transformGroup = contentEl.createDiv({ cls: 'setting-group' });
    const transformItems = transformGroup.createDiv({ cls: 'setting-items' });
    this.renderCleanupToggle(transformItems, settings);

    if (settings.llmPostprocessMode === 'off') {
      this.renderEmptyState(contentEl, presentation);
      return;
    }

    this.renderRuntimeFailureBanner(transformItems);

    const styleGroup = createSettingGroup(contentEl, t('llm.sidebar.group.preset'));
    this.renderPresetPicker(styleGroup, settings);
    this.renderCleanupMode(styleGroup, settings);
    this.renderOriginalTranscriptToggle(styleGroup, settings);

    const whereGroup = createSettingGroup(contentEl, t('llm.sidebar.group.model'));
    this.routingControls.render(whereGroup, settings);

    const contextGroup = createSettingGroup(contentEl, t('llm.sidebar.group.context'));
    this.renderUseNoteContextToggle(contextGroup, settings);
  }

  requestRefresh(): void {
    this.scheduleRender();
  }

  private renderOverview(parent: HTMLElement, presentation: LlmSidebarPresentation): void {
    const header = parent.createEl('header', { cls: 'local-dictation-sidebar__header' });
    header.createDiv({
      cls: 'local-dictation-sidebar__eyebrow',
      text: t('llm.sidebar.eyebrow'),
    });
    header.createEl('h2', {
      cls: 'local-dictation-sidebar__title',
      text: t('llm.sidebar.title'),
    });
    header.createEl('p', {
      cls: 'local-dictation-sidebar__description',
      text: t('llm.sidebar.description'),
    });

    const status = header.createDiv({ cls: 'local-dictation-sidebar__summary' });
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.createSpan({
      cls: `local-dictation-sidebar__badge local-dictation-sidebar__badge--${presentation.state}`,
      text: presentation.statusLabel,
    });
    status.createSpan({
      cls: 'local-dictation-sidebar__summary-text',
      text: presentation.summary,
      title: presentation.summary,
    });
  }

  private renderEmptyState(parent: HTMLElement, presentation: LlmSidebarPresentation): void {
    if (presentation.emptyState === null) {
      return;
    }

    const emptyState = parent.createDiv({ cls: 'local-dictation-sidebar__empty' });
    const icon = emptyState.createDiv({ cls: 'local-dictation-sidebar__empty-icon' });
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, presentation.emptyState.icon);
    emptyState.createEl('h3', { text: presentation.emptyState.title });
    emptyState.createEl('p', { text: presentation.emptyState.description });
  }

  private renderCleanupToggle(parent: HTMLElement, settings: PluginSettings): void {
    const enabled = settings.llmPostprocessMode !== 'off';
    new Setting(parent)
      .setName(t('llm.sidebar.enabled.name'))
      .setDesc(t('llm.sidebar.enabled.description'))
      .addToggle((toggle) => {
        toggle.setValue(enabled);
        toggle.onChange(async (value) => {
          const current = this.dependencies.getSettings();
          await this.persistSettings({
            ...current,
            llmPostprocessMode: value ? current.llmPostprocessLastEnabledMode : 'off',
          });
          if (value) {
            void this.routingControls.refreshActiveProviders({ forceLocal: true });
          }
        });
      });
  }

  private renderOriginalTranscriptToggle(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent)
      .setName(t('llm.sidebar.showOriginal.name'))
      .setDesc(t('llm.sidebar.showOriginal.description'))
      .addToggle((toggle) => {
        toggle.setValue(settings.llmPostprocessShowRawBelow);
        toggle.onChange(async (value) => {
          await this.saveField('llmPostprocessShowRawBelow', value, { rerender: false });
        });
      });
  }

  private renderCleanupMode(parent: HTMLElement, settings: PluginSettings): void {
    if (settings.llmPostprocessMode === 'off') {
      return;
    }
    const { preset } = resolveActivePresetEntry(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    );
    const pinned = preset.timing;

    const setting = new Setting(parent)
      .setName(t('llm.sidebar.runTransform.name'))
      .setDesc(
        pinned !== undefined
          ? t('llm.sidebar.runTransform.setByPreset', {
              preset: preset.label,
              timing: describePresetTiming(pinned),
            })
          : t('llm.sidebar.runTransform.description'),
      )
      .addDropdown((dropdown) => {
        for (const option of CLEANUP_MODE_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(pinned ?? settings.llmPostprocessMode);
        dropdown.setDisabled(pinned !== undefined);
        dropdown.onChange(async (value) => {
          if (!isLlmPresetTiming(value)) {
            return;
          }
          await this.persistSettings({
            ...this.dependencies.getSettings(),
            llmPostprocessLastEnabledMode: value,
            llmPostprocessMode: value,
          });
        });
      });
    setting.addExtraButton((button) => {
      button
        .setIcon('sliders-horizontal')
        .setTooltip(t('llm.timing.settingsTooltip'))
        .onClick(() => {
          this.openTimingSettings();
        });
      button.extraSettingsEl.setAttribute('aria-label', t('llm.timing.settingsTooltip'));
    });
  }

  private renderPresetPicker(parent: HTMLElement, settings: PluginSettings): void {
    const entries = listPresetEntries(settings.llmPostprocessUserPresets);
    const active = resolveActivePresetEntry(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    );

    const description = active.preset.description ?? describePresetBehavior(active.preset);
    const activeLabel = formatPresetOptionLabel(active.preset);
    const setting = new Setting(parent)
      .setName(t('llm.sidebar.activePreset'))
      .setDesc(description)
      .addDropdown((dropdown) => {
        for (const entry of entries) {
          dropdown.addOption(entry.ref, formatPresetOptionLabel(entry.preset));
        }
        dropdown.setValue(active.ref);
        setTooltip(dropdown.selectEl, activeLabel);
        dropdown.onChange(async (value) => {
          await this.mutatePresetState((state) => ({
            ...state,
            activePresetRef: value,
          }));
        });
      });
    setting.setClass('local-dictation-preset-setting');

    setting.addExtraButton((button) => {
      button
        .setIcon('sliders-horizontal')
        .setTooltip(t('llm.preset.manager.title'))
        .onClick(() => {
          void this.openPresetManager();
        });
      button.extraSettingsEl.setAttribute('aria-label', t('llm.preset.manager.title'));
    });
  }

  private async openPresetManager(): Promise<void> {
    await this.dependencies.synchronizePresets();
    new PresetManagerModal(this.app, {
      feedback: this.dependencies.feedback,
      getSettings: () => this.dependencies.getSettings(),
      mutatePresetState: async (mutation) => {
        await this.mutatePresetState(mutation);
      },
    }).open();
  }

  private openTimingSettings(): void {
    new LlmTimingSettingsModal(this.app, {
      getSettings: () => this.dependencies.getSettings(),
      onSave: () => {
        this.requestRefresh();
      },
      saveSettings: async (settings) => {
        await this.dependencies.saveSettings(settings);
      },
    }).open();
  }

  private openModelSettings(): void {
    new LlmModelSettingsModal(this.app, {
      getSettings: () => this.dependencies.getSettings(),
      onSave: () => {
        this.requestRefresh();
      },
      saveSettings: async (settings) => {
        await this.dependencies.saveSettings(settings);
      },
    }).open();
  }

  private openContextSettings(): void {
    new LlmContextSettingsModal(this.app, {
      getSettings: () => this.dependencies.getSettings(),
      onSave: () => {
        this.requestRefresh();
      },
      saveSettings: async (settings) => {
        await this.dependencies.saveSettings(settings);
      },
    }).open();
  }

  private renderRuntimeFailureBanner(parent: HTMLElement): void {
    const failure = this.dependencies.getLlmCleanupFailure?.() ?? null;
    if (failure === null) {
      return;
    }

    const row = parent.createDiv({
      cls: `local-dictation-status ${INLINE_STATUS_PRESENTATION.warning.className}`,
    });
    row.setAttribute('aria-live', 'polite');
    row.setAttribute('role', 'alert');
    const iconEl = row.createSpan({ cls: 'local-dictation-status__icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, INLINE_STATUS_PRESENTATION.warning.icon);
    row.createSpan({
      cls: 'local-dictation-status__text',
      text: formatCleanupFailureBanner(failure),
    });
  }

  private renderUseNoteContextToggle(parent: HTMLElement, settings: PluginSettings): void {
    const override = activePresetOverride(settings, 'useNoteContext');
    const setting = new Setting(parent)
      .setName(t('llm.context.useCurrentNote.name'))
      .setDesc(
        override !== null
          ? t('llm.managedByPreset', { preset: override.label })
          : t('llm.context.useCurrentNote.description'),
      )
      .addToggle((toggle) => {
        toggle.setValue(override !== null ? override.value === true : settings.useLlmNoteContext);
        toggle.setDisabled(override !== null);
        toggle.onChange(async (value) => {
          await this.saveField('useLlmNoteContext', value);
        });
      });
    setting.addExtraButton((button) => {
      button
        .setIcon('sliders-horizontal')
        .setTooltip(t('llm.context.settingsTooltip'))
        .onClick(() => {
          this.openContextSettings();
        });
      button.extraSettingsEl.setAttribute('aria-label', t('llm.context.settingsTooltip'));
    });
  }

  private trackInputFocus(element: HTMLElement): void {
    element.addEventListener('focus', () => {
      this.focusedInput = element;
    });
    element.addEventListener('blur', () => {
      if (this.focusedInput === element) {
        this.focusedInput = null;
      }
      this.renderWhenIdle();
    });
  }

  private renderWhenIdle(): void {
    if (!this.deferredRenderPending) {
      return;
    }

    window.setTimeout(() => {
      if (!this.deferredRenderPending) {
        return;
      }
      if (this.focusedInput?.isConnected) {
        return;
      }
      this.deferredRenderPending = false;
      this.refresh();
    }, 0);
  }

  // Deferring while an input is focused avoids clobbering in-progress text and cursor on re-render.
  private scheduleRender(): void {
    if (this.focusedInput?.isConnected) {
      this.deferredRenderPending = true;
      return;
    }
    this.refresh();
  }

  private async saveField<TKey extends keyof PluginSettings>(
    key: TKey,
    value: PluginSettings[TKey],
    options: { rerender?: boolean } = {},
  ): Promise<void> {
    await this.persistSettings(
      {
        ...this.dependencies.getSettings(),
        [key]: value,
      },
      options,
    );
  }

  private async persistSettings(
    nextSettings: PluginSettings,
    options: { rerender?: boolean } = {},
  ): Promise<void> {
    await this.dependencies.saveSettings(nextSettings);
    if (options.rerender ?? true) {
      this.refresh();
    }
  }

  private async mutatePresetState(
    mutation: LlmPresetStateMutation,
    options: { rerender?: boolean } = {},
  ): Promise<void> {
    await this.dependencies.mutatePresetState(mutation);
    if (options.rerender ?? true) {
      this.requestRefresh();
    }
  }
}

function formatPresetOptionLabel(preset: LlmPreset): string {
  if (preset.timing === 'per_utterance') {
    return t('llm.preset.option.perUtterance', { preset: preset.label });
  }
  if (preset.timing === 'batch') {
    return t('llm.preset.option.batch', { preset: preset.label });
  }
  return preset.label;
}
