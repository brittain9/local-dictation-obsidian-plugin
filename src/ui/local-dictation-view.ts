import { ItemView, Setting, setIcon, type WorkspaceLeaf } from 'obsidian';

import {
  describePresetBehavior,
  describePresetTiming,
  isLlmPresetTiming,
  type LlmPreset,
  type LlmPresetOverrides,
  type LlmPresetTiming,
  listPresetEntries,
  resolveActivePresetEntry,
} from '../llm/presets';
import type { LlmCleanupFailure } from '../llm/provider';
import type { LlmPresetStateMutation } from '../settings/llm-preset-state';
import { type PluginSettings, resetLlmPostprocessDefaults } from '../settings/plugin-settings';
import {
  addNumberInputSetting,
  appendInfoTooltip,
  createSettingGroup,
} from '../settings/setting-helpers';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import { ConfirmModal } from './confirm-modal';
import { FocusRefreshController } from './focus-refresh-controller';
import { formatCleanupFailureBanner } from './llm-provider-ui';
import { LlmRoutingControls } from './llm-routing-controls';
import {
  type LlmSidebarPresentation,
  resolveLlmSidebarPresentation,
} from './llm-sidebar-presentation';
import { INLINE_STATUS_PRESENTATION } from './llm-status';
import { PresetManagerModal } from './preset-manager-modal';

export const LOCAL_DICTATION_VIEW_TYPE = 'local-dictation-sidebar';
const LOCAL_DICTATION_VIEW_TITLE = 'Local Dictation';
const LOCAL_DICTATION_VIEW_ICON = 'audio-lines';
const HEADING_TOOLTIP =
  'Uses an LLM provider to transform the dictated transcript — cleaning, rewriting, summarizing, reformatting, or running custom prompts.';
const NARROW_SIDEBAR_WIDTH_PX = 420;

const CLEANUP_MODE_OPTIONS: ReadonlyArray<{ label: string; value: LlmPresetTiming }> = [
  { label: 'After each phrase', value: 'per_utterance' },
  { label: 'All at once on stop', value: 'batch' },
];

interface LocalDictationViewDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getOpenRouterApiKey: () => string;
  getSettings: () => PluginSettings;
  getLlmCleanupFailure?: () => LlmCleanupFailure | null;
  logger?: PluginLogger | undefined;
  mutatePresetState: (mutation: LlmPresetStateMutation) => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  subscribeLlmCleanupFailure?: (callback: () => void) => () => void;
  synchronizePresets: () => Promise<void>;
}

export class LocalDictationView extends ItemView {
  private advancedOpen = false;
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
      getOpenRouterApiKey: () => this.dependencies.getOpenRouterApiKey(),
      getSettings: () => this.dependencies.getSettings(),
      logger: this.dependencies.logger,
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
    return LOCAL_DICTATION_VIEW_TITLE;
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

    const headerGroup = createSettingGroup(contentEl, 'Transform', HEADING_TOOLTIP);
    this.renderCleanupToggle(headerGroup, settings);

    if (settings.llmPostprocessMode === 'off') {
      this.renderEmptyState(contentEl, presentation);
      return;
    }

    this.renderRuntimeFailureBanner(headerGroup);

    const styleGroup = createSettingGroup(contentEl, 'Preset');
    this.renderPresetPicker(styleGroup, settings);
    this.renderCleanupMode(styleGroup, settings);

    const whereGroup = createSettingGroup(contentEl, 'Provider');
    this.routingControls.render(whereGroup, settings);

    const contextGroup = createSettingGroup(contentEl, 'Context');
    this.renderUseNoteContextToggle(contextGroup, settings);
    this.renderNoteContextChars(contextGroup, settings);

    const advanced = contentEl.createEl('details', { cls: 'local-dictation-advanced' });
    const advancedSummary = advanced.createEl('summary');
    const advancedSummaryText = advancedSummary.createSpan({
      cls: 'local-dictation-advanced__summary',
    });
    advancedSummaryText.createSpan({
      cls: 'local-dictation-advanced__title',
      text: 'Advanced settings',
    });
    advancedSummaryText.createSpan({
      cls: 'local-dictation-advanced__description',
      text: 'Limits, generation, and diagnostics',
    });
    advanced.open = this.advancedOpen;
    advanced.addEventListener('toggle', () => {
      this.advancedOpen = advanced.open;
    });

    this.renderLimitsSection(advanced, settings);
    this.renderGenerationSection(advanced, settings);
    this.renderDiagnosticsSection(advanced, settings);
  }

  requestRefresh(): void {
    this.scheduleRender();
  }

  private renderOverview(parent: HTMLElement, presentation: LlmSidebarPresentation): void {
    const header = parent.createEl('header', { cls: 'local-dictation-sidebar__header' });
    header.createDiv({ cls: 'local-dictation-sidebar__eyebrow', text: 'Transcript workflow' });
    header.createEl('h2', {
      cls: 'local-dictation-sidebar__title',
      text: 'Transform dictation',
    });
    header.createEl('p', {
      cls: 'local-dictation-sidebar__description',
      text: 'Choose how spoken text is shaped before it reaches your note.',
    });

    const status = header.createDiv({ cls: 'local-dictation-sidebar__summary' });
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
      .setName('Enabled')
      .setDesc('Apply the active preset to new dictated text.')
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

  private renderCleanupMode(parent: HTMLElement, settings: PluginSettings): void {
    if (settings.llmPostprocessMode === 'off') {
      return;
    }
    const { preset } = resolveActivePresetEntry(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    );
    const pinned = preset.timing;

    new Setting(parent)
      .setName('Run transform')
      .setDesc(
        pinned !== undefined
          ? `Set by ${preset.label} — ${describePresetTiming(pinned).toLowerCase()}.`
          : 'Run after each phrase, or all at once when you stop.',
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
      .setName('Active preset')
      .setDesc(description)
      .addDropdown((dropdown) => {
        for (const entry of entries) {
          dropdown.addOption(entry.ref, formatPresetOptionLabel(entry.preset));
        }
        dropdown.setValue(active.ref);
        dropdown.selectEl.setAttribute('title', activeLabel);
        dropdown.onChange(async (value) => {
          await this.mutatePresetState((state) => ({
            ...state,
            activePresetRef: value,
          }));
        });
      });
    setting.settingEl.addClass('local-dictation-preset-setting');

    setting.addExtraButton((button) => {
      button
        .setIcon('settings')
        .setTooltip('Manage presets')
        .onClick(() => {
          void this.openPresetManager();
        });
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

  private renderRuntimeFailureBanner(parent: HTMLElement): void {
    const failure = this.dependencies.getLlmCleanupFailure?.() ?? null;
    if (failure === null) {
      return;
    }

    const row = parent.createDiv({
      cls: `local-dictation-status ${INLINE_STATUS_PRESENTATION.warning.className}`,
    });
    const iconEl = row.createSpan({ cls: 'local-dictation-status__icon' });
    setIcon(iconEl, INLINE_STATUS_PRESENTATION.warning.icon);
    row.createSpan({
      cls: 'local-dictation-status__text',
      text: formatCleanupFailureBanner(failure),
    });
  }

  private renderUseNoteContextToggle(parent: HTMLElement, settings: PluginSettings): void {
    const override = activePresetOverride(settings, 'useNoteContext');
    const setting = new Setting(parent)
      .setName('Use note as LLM context')
      .setDesc(
        override !== null
          ? `Set by preset "${override.label}". Edit the preset to change.`
          : 'Include the open note above the cursor in the LLM prompt.',
      )
      .addToggle((toggle) => {
        toggle.setValue(override !== null ? override.value === true : settings.useLlmNoteContext);
        toggle.setDisabled(override !== null);
        toggle.onChange(async (value) => {
          await this.saveField('useLlmNoteContext', value);
        });
      });
    appendInfoTooltip(
      setting,
      'Experimental: results vary with note length and model. The note text is sent with every transform — on OpenRouter that adds input-token cost; on local models it adds latency.',
    );
  }

  private renderNoteContextChars(parent: HTMLElement, settings: PluginSettings): void {
    const override = activePresetOverride(settings, 'useNoteContext');
    const effectiveNoteContext =
      override !== null ? override.value === true : settings.useLlmNoteContext;
    if (!effectiveNoteContext) {
      return;
    }
    this.addNumberSetting(
      parent,
      'Note context chars',
      'Chars of note text',
      settings.llmPostprocessNoteContextChars,
      (value) => this.saveField('llmPostprocessNoteContextChars', value, { rerender: false }),
      'Characters of surrounding note text fed to the model as context.',
    );
  }

  private renderLimitsSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(
      parent,
      'Limits',
      'Bounds on the context fed to the model, plus a word floor for skipping the transform.',
    );

    // The cap only governs per-utterance context (note text + prior utterances);
    // batch context is bounded by "Note context chars" alone, so hide it there.
    if (settings.llmPostprocessMode !== 'batch') {
      this.addNumberSetting(
        items,
        'Total context cap',
        'Hard cap on context chars',
        settings.llmPostprocessTotalContextCap,
        (value) => this.saveField('llmPostprocessTotalContextCap', value, { rerender: false }),
        'Hard cap on total context characters across note and prior utterances.',
      );

      if (Math.ceil(settings.llmPostprocessTotalContextCap / 4) >= 4_000) {
        items.createEl('p', {
          cls: 'local-dictation-muted',
          text: 'Large context windows can slow local models and reduce LLM transform quality.',
        });
      }

      this.addNumberSetting(
        items,
        'Prior utterances',
        'Recent utterances kept',
        settings.llmPostprocessPriorUtterancesN,
        (value) => this.saveField('llmPostprocessPriorUtterancesN', value, { rerender: false }),
        'Number of recent transcribed utterances included as conversation history.',
      );
    }

    if (settings.llmRemoteFeaturesEnabled && settings.llmRouting !== 'local') {
      this.addNumberSetting(
        items,
        'Remote timeout (seconds)',
        'Give up on OpenRouter after this long',
        settings.llmRemoteTimeoutSec,
        (value) => this.saveField('llmRemoteTimeoutSec', value, { rerender: false }),
        'Abort an OpenRouter transform request after this many seconds. The raw transcript is kept.',
      );
    }

    const override = activePresetOverride(settings, 'minWords');
    this.addNumberSetting(
      items,
      'Min words',
      override !== null
        ? `Set by preset "${override.label}". Edit the preset to change.`
        : 'Skip the transform under N words.',
      typeof override?.value === 'number' ? override.value : settings.llmPostprocessSkipMinWords,
      (value) => this.saveField('llmPostprocessSkipMinWords', value, { rerender: false }),
      'Skip the LLM transform when the utterance has fewer words than this.',
      { disabled: override !== null },
    );
  }

  private renderGenerationSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(parent, 'Generation');
    const override = activePresetOverride(settings, 'temperature');
    this.addNumberSetting(
      items,
      'Temperature',
      override !== null
        ? `Set by preset "${override.label}". Edit the preset to change.`
        : 'Sampling randomness',
      typeof override?.value === 'number' ? override.value : settings.llmPostprocessTemperature,
      (value) => this.saveField('llmPostprocessTemperature', value, { rerender: false }),
      'Sampling randomness. 0 is deterministic; higher is more varied.',
      { disabled: override !== null },
    );
  }

  private renderDiagnosticsSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(parent, 'Diagnostics');

    if (settings.timestampsEnabled) {
      items.createEl('p', {
        cls: 'local-dictation-muted',
        text: 'Per-utterance preserves timestamps. Batch may rewrite or drop them — your prompt controls what happens.',
      });
    }

    new Setting(items)
      .setName('Show raw beneath LLM output')
      .setDesc('Keep the Whisper transcript in a collapsible callout under each result.')
      .addToggle((toggle) => {
        toggle.setValue(settings.llmPostprocessShowRawBelow);
        toggle.onChange(async (value) => {
          await this.saveField('llmPostprocessShowRawBelow', value, { rerender: false });
        });
      });

    new Setting(items)
      .setName('Reset LLM defaults')
      .setDesc(
        'Restore the default preset, mode, context, skip gates, and generation values. Your saved presets and selected provider model are kept.',
      )
      .addButton((button) => {
        button.setButtonText('Reset');
        button.setWarning();
        button.onClick(() => {
          this.confirmResetDefaults();
        });
      });
  }

  private confirmResetDefaults(): void {
    new ConfirmModal(this.app, {
      title: 'Reset LLM defaults',
      message:
        'Restore the default preset, mode, context, skip gates, and generation values? Your saved presets and selected provider model are kept.',
      confirmLabel: 'Reset',
      destructive: true,
      onConfirm: async () => {
        await this.mutatePresetState(
          (state) => ({
            ...state,
            activePresetRef: resolveActivePresetEntry(null, []).ref,
          }),
          { rerender: false },
        );
        await this.persistSettings(resetLlmPostprocessDefaults(this.dependencies.getSettings()));
      },
    }).open();
  }

  private addNumberSetting(
    parent: HTMLElement,
    name: string,
    desc: string,
    value: number,
    onChange: (value: number) => Promise<void>,
    tooltip: string,
    options: { disabled?: boolean } = {},
  ): void {
    addNumberInputSetting(parent, {
      desc,
      name,
      onChange,
      onElement: (element) => {
        if (options.disabled === true) {
          element.disabled = true;
          return;
        }
        this.trackInputFocus(element);
      },
      tooltip,
      value,
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

function activePresetOverride(
  settings: PluginSettings,
  field: keyof LlmPresetOverrides,
): { label: string; value: number | boolean } | null {
  const { preset } = resolveActivePresetEntry(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );
  const value = preset.overrides?.[field];
  if (value === undefined) {
    return null;
  }
  return { label: preset.label, value };
}

function formatPresetOptionLabel(preset: LlmPreset): string {
  if (preset.timing === 'per_utterance') {
    return `${preset.label} (after each phrase)`;
  }
  if (preset.timing === 'batch') {
    return `${preset.label} (on stop)`;
  }
  return preset.label;
}
