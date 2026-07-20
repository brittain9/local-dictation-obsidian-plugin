import type { App } from 'obsidian';
import { Modal, Setting, setIcon } from 'obsidian';

import {
  catalogModelSupportsLanguage,
  dictationLanguageLabel,
} from '../language/dictation-language';
import { formatBytes, formatVoiceLabel } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import { ConfirmModal } from '../ui/confirm-modal';
import { resolveEngineCapabilities } from './capability-view';
import { localizeFamilySummary } from './catalog-localization';
import { formatModelTagLabel } from './model-guidance';
import { isCancellingPhase, type ModelInstallManager } from './model-install-manager';
import {
  createInstallProgressElement,
  type InstallProgressState,
  updateInstallProgressElement,
} from './model-install-progress';
import { ModelDetailsModal } from './model-management-modals';
import {
  type CatalogModelRecord,
  getTotalModelSize,
  type ModelFamilyId,
  matchesModelTriple,
  type RuntimeId,
} from './model-management-types';
import { resolveModelPresentationPolicy } from './model-presentation-policy';
import { deriveModelFamilyTabs, deriveModelRowStates, type ModelRowState } from './model-row-state';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type ModelPickerTask = 'stt' | 'tts';

export interface ModelPickerOptions {
  initialTask?: ModelPickerTask;
  onChanged?: () => void;
}

export function resolveInitialModelPickerTask(options: ModelPickerOptions): ModelPickerTask {
  return options.initialTask ?? 'stt';
}

export function searchQueryAfterTaskSwitch(
  currentTask: ModelPickerTask,
  nextTask: ModelPickerTask,
  currentQuery: string,
): string {
  return currentTask === nextTask ? currentQuery : '';
}

interface ManageModelsModalDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  initialTask?: ModelPickerTask;
  manager: ModelInstallManager;
  onChanged: () => void;
  onRunSetup?: () => void;
}

export interface TtsLanguageOption {
  code: 'de' | 'en' | 'es' | 'fr' | 'it' | 'pt';
  label: string;
}

export const TTS_LANGUAGE_OPTIONS: readonly TtsLanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
];

export function resolveInitialTtsLanguage(
  state: Pick<ReturnType<ModelInstallManager['getState']>, 'catalog' | 'selectedTtsModel'>,
): TtsLanguageOption['code'] {
  const selection = state.selectedTtsModel;
  if (selection?.kind !== 'catalog_model') return 'en';
  const model = state.catalog.models.find((candidate) =>
    matchesModelTriple(candidate, selection.runtimeId, selection.familyId, selection.modelId),
  );
  const language = model?.languageTags[0];
  return TTS_LANGUAGE_OPTIONS.some((candidate) => candidate.code === language)
    ? (language as TtsLanguageOption['code'])
    : 'en';
}

export function filterModelRowsForPicker(
  rows: readonly ModelRowState[],
  options: {
    activeFamily: AdapterTabKey | null;
    language: TtsLanguageOption['code'];
    query: string;
    task: ModelPickerTask;
  },
): ModelRowState[] {
  const query = options.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (row.model.task !== options.task) return false;
    if (options.task === 'stt') {
      if (
        options.activeFamily === null ||
        row.model.runtimeId !== options.activeFamily.runtimeId ||
        row.model.familyId !== options.activeFamily.familyId
      ) {
        return false;
      }
    } else if (!row.model.languageTags.includes(options.language)) {
      return false;
    }
    if (query.length === 0) return true;
    return [
      row.model.displayName,
      row.model.summary,
      ...row.model.languageTags,
      ...row.model.uxTags,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}

interface AdapterTabKey {
  runtimeId: RuntimeId;
  familyId: ModelFamilyId;
}

function adapterTabId(key: AdapterTabKey): string {
  return `${key.runtimeId}:${key.familyId}`;
}

// ---------------------------------------------------------------------------
// ManageModelsModal
// ---------------------------------------------------------------------------

export class ManageModelsModal extends Modal {
  private actionInProgress = false;
  private activeTab: AdapterTabKey | null = null;
  private activeTask: ModelPickerTask;
  private activeTtsLanguage: TtsLanguageOption['code'] = 'en';
  private ttsLanguageManuallySelected = false;
  private browserEl: HTMLDivElement | null = null;
  private navigationEl: HTMLDivElement | null = null;
  private listContainer: HTMLDivElement | null = null;
  private readonly progressElements = new Map<string, HTMLDivElement>();
  private releaseSubscription: (() => void) | null = null;
  private tabButtons = new Map<string, HTMLButtonElement>();
  private tabBarEl: HTMLDivElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchQuery = '';
  private taskButtons = new Map<ModelPickerTask, HTMLButtonElement>();

  constructor(
    app: App,
    private readonly deps: ManageModelsModalDependencies,
  ) {
    super(app);
    this.activeTask = resolveInitialModelPickerTask(deps);
  }

  override onOpen(): void {
    this.modalEl.addClass('local-stt-manage-models');
    this.titleEl.setText(t('models.manage.title'));
    this.activeTtsLanguage = resolveInitialTtsLanguage(this.deps.manager.getState());
    this.renderContent();

    this.releaseSubscription = this.deps.manager.subscribe(() => {
      this.handleStateChange();
    });
  }

  private renderContent(): void {
    this.contentEl.empty();
    this.progressElements.clear();
    this.browserEl = null;
    this.navigationEl = null;
    this.tabBarEl = null;
    this.listContainer = null;
    this.searchInputEl = null;
    this.tabButtons.clear();
    this.taskButtons.clear();

    const state = this.deps.manager.getState();
    if (state.loadStatus === 'error' && this.deps.onRunSetup !== undefined) {
      this.renderLoadErrorPanel();
      return;
    }

    const toolbar = this.contentEl.createDiv({ cls: 'local-stt-toolbar' });
    const taskSwitcher = toolbar.createDiv({
      attr: { 'aria-label': t('models.manage.taskLabel'), role: 'tablist' },
      cls: 'local-stt-task-switcher',
    });
    for (const task of ['stt', 'tts'] as const) {
      const button = taskSwitcher.createEl('button', {
        attr: {
          'aria-selected': String(task === this.activeTask),
          role: 'tab',
          type: 'button',
        },
        cls: 'local-stt-task-switcher__button',
        text:
          task === 'tts' ? t('models.manage.readAloudModels') : t('models.manage.dictationModels'),
      });
      button.toggleClass('is-active', task === this.activeTask);
      button.addEventListener('click', () => this.switchTask(task));
      this.taskButtons.set(task, button);
    }
    this.searchInputEl = toolbar.createEl('input', {
      attr: {
        'aria-label': t('models.manage.searchPlaceholder', {
          task:
            this.activeTask === 'tts'
              ? t('models.manage.readAloudModels')
              : t('models.manage.dictationModels'),
        }),
        placeholder: t('models.manage.searchPlaceholder', {
          task:
            this.activeTask === 'tts'
              ? t('models.manage.readAloudModels')
              : t('models.manage.dictationModels'),
        }),
        type: 'search',
      },
      cls: 'local-stt-model-search',
    });
    this.searchInputEl.value = this.searchQuery;
    this.searchInputEl.addEventListener('input', () => {
      this.searchQuery = this.searchInputEl?.value ?? '';
      this.renderModelList();
    });

    this.browserEl = this.contentEl.createDiv({ cls: 'local-stt-model-browser' });
    this.navigationEl = this.browserEl.createDiv({ cls: 'local-stt-model-browser__navigation' });
    this.listContainer = this.browserEl.createDiv({ cls: 'local-stt-model-list' });
    this.renderNavigation();
    this.renderModelList();
  }

  private renderLoadErrorPanel(): void {
    const panel = this.contentEl.createDiv({ cls: 'local-stt-empty-panel' });
    const iconWrap = panel.createDiv({ cls: 'local-stt-empty-panel__icon' });
    setIcon(iconWrap, 'download-cloud');
    panel.createEl('h3', { text: t('models.manage.loadFailedTitle') });
    panel.createEl('p', {
      text: t('models.manage.loadFailedDesc'),
    });
    const actions = panel.createDiv({ cls: 'local-stt-empty-panel__actions' });
    actions
      .createEl('button', { cls: 'mod-cta', text: t('models.manage.runSetup') })
      .addEventListener('click', () => {
        this.close();
        this.deps.onRunSetup?.();
      });
    actions.createEl('button', { text: t('common.tryAgain') }).addEventListener('click', () => {
      void this.deps.manager.init();
    });
  }

  override onClose(): void {
    this.releaseSubscription?.();
    this.releaseSubscription = null;
    this.actionInProgress = false;
    this.browserEl = null;
    this.navigationEl = null;
    this.listContainer = null;
    this.tabBarEl = null;
    this.searchInputEl = null;
    this.tabButtons.clear();
    this.taskButtons.clear();
    this.progressElements.clear();
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // Task and navigation controls
  // -------------------------------------------------------------------------

  private switchTask(task: ModelPickerTask): void {
    if (task === this.activeTask) return;
    this.searchQuery = searchQueryAfterTaskSwitch(this.activeTask, task, this.searchQuery);
    this.activeTask = task;
    if (this.searchInputEl !== null) {
      this.searchInputEl.value = '';
      const taskLabel =
        task === 'tts' ? t('models.manage.readAloudModels') : t('models.manage.dictationModels');
      const placeholder = t('models.manage.searchPlaceholder', { task: taskLabel });
      this.searchInputEl.placeholder = placeholder;
      this.searchInputEl.setAttribute('aria-label', placeholder);
    }
    for (const [candidate, button] of this.taskButtons) {
      button.toggleClass('is-active', candidate === task);
      button.setAttribute('aria-selected', String(candidate === task));
    }
    this.renderNavigation();
    this.renderModelList();
  }

  private renderNavigation(): void {
    if (this.navigationEl === null) return;
    this.navigationEl.empty();
    this.navigationEl.toggleClass('local-stt-language-rail', this.activeTask === 'tts');
    if (this.activeTask === 'tts') {
      this.renderLanguageRail();
      return;
    }
    this.navigationEl.removeAttribute('role');
    this.navigationEl.removeAttribute('aria-label');
    this.tabBarEl = this.navigationEl.createDiv({ cls: 'local-stt-tab-bar' });
    this.renderTabs();
  }

  private renderLanguageRail(): void {
    if (this.navigationEl === null) return;
    this.navigationEl.addClass('local-stt-language-rail');
    this.navigationEl.setAttribute('role', 'tablist');
    this.navigationEl.setAttribute('aria-label', t('models.manage.languagesLabel'));
    for (const [index, language] of TTS_LANGUAGE_OPTIONS.entries()) {
      const selected = language.code === this.activeTtsLanguage;
      const button = this.navigationEl.createEl('button', {
        attr: {
          'aria-selected': String(selected),
          role: 'tab',
          tabindex: selected ? '0' : '-1',
          type: 'button',
        },
        cls: 'local-stt-language-rail__button',
      });
      button.createSpan({ cls: 'local-stt-language-rail__name', text: language.label });
      button.createSpan({
        cls: 'local-stt-language-rail__code',
        text: language.code.toUpperCase(),
      });
      button.toggleClass('is-active', selected);
      button.addEventListener('click', () => this.selectTtsLanguage(language.code));
      button.addEventListener('keydown', (event) => {
        const nextIndex = resolveLanguageNavigationIndex(index, event.key);
        if (nextIndex === null) return;
        event.preventDefault();
        const next = TTS_LANGUAGE_OPTIONS[nextIndex];
        if (next === undefined) return;
        this.selectTtsLanguage(next.code);
        this.navigationEl
          ?.querySelectorAll<HTMLButtonElement>('.local-stt-language-rail__button')
          .item(nextIndex)
          .focus();
      });
    }
  }

  private selectTtsLanguage(language: TtsLanguageOption['code']): void {
    if (language === this.activeTtsLanguage) return;
    this.ttsLanguageManuallySelected = true;
    this.activeTtsLanguage = language;
    this.renderNavigation();
    this.renderModelList();
  }

  private renderTabs(): void {
    if (this.tabBarEl === null) {
      return;
    }

    this.tabBarEl.empty();
    this.tabButtons.clear();

    const state = this.deps.manager.getState();

    // Only show adapter tabs for (runtime, family) pairs present in both the
    // compiled sidecar AND the catalog — compiled alone doesn't guarantee any
    // downloadable models, and catalog alone doesn't guarantee the sidecar can
    // run them.
    const adapters = deriveModelFamilyTabs(state).filter((adapter) => adapter.task === 'stt');

    if (
      this.activeTab === null ||
      !adapters.some(
        (a) => a.runtimeId === this.activeTab?.runtimeId && a.familyId === this.activeTab?.familyId,
      )
    ) {
      const first = adapters[0];
      this.activeTab =
        first !== undefined ? { runtimeId: first.runtimeId, familyId: first.familyId } : null;
    }

    for (const adapter of adapters) {
      const tabKey: AdapterTabKey = {
        runtimeId: adapter.runtimeId,
        familyId: adapter.familyId,
      };
      const btn = this.tabBarEl.createEl('button', {
        cls: 'local-stt-tab',
        text: adapter.displayName,
      });

      if (
        this.activeTab !== null &&
        tabKey.runtimeId === this.activeTab.runtimeId &&
        tabKey.familyId === this.activeTab.familyId
      ) {
        btn.addClass('local-stt-tab--active');
      }

      btn.addEventListener('click', () => {
        this.activeTab = tabKey;
        this.updateTabActiveStates();
        this.renderModelList();
      });

      this.tabButtons.set(adapterTabId(tabKey), btn);
    }
  }

  private updateTabActiveStates(): void {
    const activeId = this.activeTab === null ? null : adapterTabId(this.activeTab);
    for (const [tabId, btn] of this.tabButtons) {
      btn.toggleClass('local-stt-tab--active', tabId === activeId);
    }
  }

  // -------------------------------------------------------------------------
  // Model list
  // -------------------------------------------------------------------------

  private renderModelList(): void {
    if (this.listContainer === null || (this.activeTask === 'stt' && this.activeTab === null)) {
      return;
    }

    this.listContainer.empty();
    this.progressElements.clear();

    const state = this.deps.manager.getState();

    if (state.loadStatus === 'loading') {
      this.listContainer.createEl('p', { text: t('models.manage.loadingCatalog') });
      return;
    }

    if (state.loadStatus === 'error') {
      this.listContainer.createEl('p', {
        text: t('models.manage.loadCatalogFailed'),
      });
      return;
    }

    const activeFamily = state.catalog.families.find((family) =>
      this.activeTask === 'tts'
        ? family.task === 'tts'
        : family.runtimeId === this.activeTab?.runtimeId &&
          family.familyId === this.activeTab?.familyId,
    );
    if (activeFamily !== undefined && activeFamily.summary.length > 0) {
      this.listContainer.createEl('p', {
        cls: 'local-stt-family-summary',
        text: localizeFamilySummary(activeFamily.familyId, activeFamily.summary),
      });
    }

    const rows = deriveModelRowStates(state).filter((row) =>
      state.compiledAdapters.some(
        (adapter) =>
          adapter.runtimeId === row.model.runtimeId && adapter.familyId === row.model.familyId,
      ),
    );
    const tabRows = filterModelRowsForPicker(rows, {
      activeFamily: this.activeTab,
      language: this.activeTtsLanguage,
      query: this.searchQuery,
      task: this.activeTask,
    });

    if (tabRows.length === 0) {
      this.listContainer.createEl('p', {
        cls: 'local-stt-empty-state',
        text: t('models.manage.noneAvailable'),
      });
      return;
    }

    for (const row of tabRows) {
      this.renderRow(row, this.listContainer.createDiv());
    }
  }

  private renderRow(row: ModelRowState, container: HTMLDivElement): void {
    container.empty();

    const setting = new Setting(container);
    setting.settingEl.addClass('local-stt-model-row');
    setting.setName(row.model.displayName);
    const selectedLanguage = this.deps.manager.getDictationLanguage();
    const supportsSelectedLanguage =
      row.model.task === 'tts' || catalogModelSupportsLanguage(row.model, selectedLanguage);

    // Description: install progress when installing/canceling, tags + size otherwise.
    if (row.isInstalling || row.isCanceling) {
      const progressState = this.buildProgressState(row);
      if (progressState !== null) {
        const progressEl = createInstallProgressElement(progressState);
        this.progressElements.set(getRowKey(row), progressEl);
        const fragment = createFragment();
        fragment.append(progressEl);
        setting.setDesc(fragment);
      }
    } else {
      const tags = this.buildTagsFragment(row.model);
      if (!supportsSelectedLanguage) {
        tags.append(
          document.createTextNode(
            t('models.manage.unsupportedLanguage', {
              language: dictationLanguageLabel(selectedLanguage),
            }),
          ),
        );
      }
      setting.setDesc(tags);
    }

    // Action buttons based on allowedActions.
    for (const action of row.allowedActions) {
      switch (action) {
        case 'install':
          setting.addButton((button) => {
            button
              .setCta()
              .setButtonText(t('common.install'))
              .setDisabled(this.actionInProgress || !supportsSelectedLanguage)
              .onClick(() => {
                this.requestModelInstall(row.model);
              });
          });
          break;

        case 'use':
          setting.addButton((button) => {
            button
              .setCta()
              .setButtonText(t('models.manage.use'))
              .setDisabled(this.actionInProgress || !supportsSelectedLanguage)
              .onClick(() => {
                void this.runAction(
                  async () => {
                    await this.deps.manager.select({
                      familyId: row.model.familyId,
                      kind: 'catalog_model',
                      modelId: row.model.modelId,
                      runtimeId: row.model.runtimeId,
                    });
                    this.close();
                  },
                  {
                    failureMessage: t('models.manage.selectFailed'),
                    successMessage: t('models.manage.selectedNotice'),
                  },
                );
              });
          });
          break;

        case 'selected':
          setting.addButton((button) => {
            button.setButtonText(t('models.manage.selected')).setDisabled(true);
          });
          break;

        case 'cancel':
          setting.addButton((button) => {
            if (row.isCanceling) {
              button.setButtonText(t('models.manage.cancelling')).setDisabled(true);
            } else {
              button
                .setCta()
                .setButtonText(t('common.cancel'))
                .setDisabled(this.actionInProgress)
                .onClick(() => {
                  void this.runAction(async () => {
                    await this.deps.manager.cancel();
                  });
                });
            }
          });
          break;

        case 'remove':
          setting.addButton((button) => {
            button
              .setWarning()
              .setButtonText(t('common.remove'))
              .setDisabled(this.actionInProgress)
              .onClick(() => {
                void this.runAction(
                  async () => {
                    await this.deps.manager.remove({
                      familyId: row.model.familyId,
                      kind: 'catalog_model',
                      modelId: row.model.modelId,
                      runtimeId: row.model.runtimeId,
                    });
                  },
                  {
                    failureMessage: t('models.manage.removeFailed'),
                    successMessage: t('models.manage.removedNotice'),
                  },
                );
              });
          });
          break;

        case 'details':
          setting.addExtraButton((button) => {
            button
              .setIcon('info')
              .setTooltip(t('models.manage.details'))
              .onClick(() => {
                const state = this.deps.manager.getState();
                const installedModel = state.installedModels.find((m) =>
                  matchesModelTriple(m, row.model.runtimeId, row.model.familyId, row.model.modelId),
                );
                const capabilities = resolveEngineCapabilities(
                  state.compiledRuntimes,
                  state.compiledAdapters,
                  row.model.runtimeId,
                  row.model.familyId,
                );
                new ModelDetailsModal(
                  this.app,
                  row.model,
                  installedModel?.installPath ?? null,
                  capabilities,
                ).open();
              });
          });
          break;
      }
    }

    if (row.installed && row.model.task === 'tts') {
      this.renderVoiceManagement(row, container);
    }
  }

  private renderVoiceManagement(row: ModelRowState, container: HTMLDivElement): void {
    const optionalVoices = row.model.artifacts.filter(
      (candidate) => candidate.role === 'voice' && !candidate.required,
    );
    if (optionalVoices.length === 0) return;
    const details = container.createEl('details', { cls: 'local-stt-voice-management' });
    details.createEl('summary', { text: t('models.manage.manageVoices') });
    const installed = this.deps.manager
      .getState()
      .installedModels.find((model) =>
        matchesModelTriple(model, row.model.runtimeId, row.model.familyId, row.model.modelId),
      );
    for (const artifact of optionalVoices) {
      const voiceId = artifact.voiceId;
      if (voiceId === undefined) continue;
      const voiceSetting = new Setting(details)
        .setName(formatVoiceLabel(voiceId))
        .setDesc(t('models.manage.optionalVoice'));
      voiceSetting.settingEl.addClass('local-stt-voice-row');
      if (installed?.installedVoiceIds.includes(voiceId) ?? false) {
        voiceSetting.addButton((button) => {
          button.setButtonText(t('models.manage.voiceInstalled')).setDisabled(true);
        });
      } else {
        voiceSetting.addButton((button) => {
          button
            .setButtonText(t('common.install'))
            .setDisabled(this.actionInProgress)
            .onClick(() => {
              void this.runAction(
                async () => {
                  await this.deps.manager.install(
                    {
                      familyId: row.model.familyId,
                      kind: 'catalog_model',
                      modelId: row.model.modelId,
                      runtimeId: row.model.runtimeId,
                    },
                    [artifact.artifactId],
                  );
                },
                { failureMessage: t('models.manage.installStartFailed') },
              );
            });
        });
      }
    }
  }

  private requestModelInstall(model: CatalogModelRecord): void {
    const confirmation = resolveModelPresentationPolicy(model).installConfirmation;
    const install = async (): Promise<void> => {
      await this.runAction(
        async () => {
          await this.deps.manager.install({
            familyId: model.familyId,
            kind: 'catalog_model',
            modelId: model.modelId,
            runtimeId: model.runtimeId,
          });
        },
        { failureMessage: t('models.manage.installStartFailed') },
      );
    };
    if (confirmation === null) {
      void install();
      return;
    }
    new ConfirmModal(this.app, {
      confirmLabel: t('common.install'),
      message: confirmation.message,
      onConfirm: install,
      title: confirmation.title,
    }).open();
  }

  // -------------------------------------------------------------------------
  // State change handler
  // -------------------------------------------------------------------------

  private handleStateChange(): void {
    const state = this.deps.manager.getState();
    if (!this.ttsLanguageManuallySelected && state.loadStatus === 'ready') {
      this.activeTtsLanguage = resolveInitialTtsLanguage(state);
    }

    // If we're currently in the sidecar-required panel (listContainer === null)
    // or the state has just transitioned into error mode, do a full re-render
    // so the layout matches the load status.
    if (
      this.listContainer === null ||
      (state.loadStatus === 'error' && this.deps.onRunSetup !== undefined)
    ) {
      this.renderContent();
      return;
    }

    const { activeInstall } = state;

    // Fast path: if an install is active for a visible row, try in-place
    // progress update instead of full re-render.
    if (activeInstall !== null) {
      const key = installTripleKey(activeInstall.installUpdate);
      const existingProgressEl = this.progressElements.get(key);

      if (existingProgressEl !== null && existingProgressEl !== undefined) {
        updateInstallProgressElement(existingProgressEl, {
          ...activeInstall.installUpdate,
          isCancelling: isCancellingPhase(activeInstall.phase),
        });
        return;
      }

      // Progress ticks for a model outside the active task/language do not
      // affect visible rows. Avoid rebuilding the DOM under the user's cursor.
      const installingModel = state.catalog.models.find((model) =>
        matchesModelTriple(
          model,
          activeInstall.installUpdate.runtimeId,
          activeInstall.installUpdate.familyId,
          activeInstall.installUpdate.modelId,
        ),
      );
      const visible =
        this.activeTask === 'tts'
          ? installingModel?.task === 'tts' &&
            installingModel.languageTags.includes(this.activeTtsLanguage)
          : this.activeTab !== null &&
            activeInstall.installUpdate.runtimeId === this.activeTab.runtimeId &&
            activeInstall.installUpdate.familyId === this.activeTab.familyId;
      if (!visible) {
        return;
      }
    }

    this.renderModelList();
  }

  // -------------------------------------------------------------------------
  // Action runner
  // -------------------------------------------------------------------------

  private async runAction(
    action: () => Promise<void>,
    messages: { failureMessage?: string; successMessage?: string } = {},
  ): Promise<void> {
    if (this.actionInProgress) {
      return;
    }

    this.actionInProgress = true;
    this.renderModelList();

    try {
      await action();
      if (messages.successMessage !== undefined) {
        this.deps.feedback.show({ intent: 'success', message: messages.successMessage });
      }
      this.deps.onChanged();
    } catch (error) {
      if (messages.failureMessage !== undefined) {
        this.deps.feedback.show({
          cause: error,
          intent: 'error',
          message: messages.failureMessage,
        });
      }
    } finally {
      this.actionInProgress = false;
      this.renderModelList();
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildProgressState(row: ModelRowState): InstallProgressState | null {
    const state = this.deps.manager.getState();
    const { activeInstall } = state;

    if (activeInstall === null) {
      return null;
    }

    if (
      activeInstall.installUpdate.runtimeId !== row.model.runtimeId ||
      activeInstall.installUpdate.familyId !== row.model.familyId ||
      activeInstall.installUpdate.modelId !== row.model.modelId
    ) {
      return null;
    }

    return {
      ...activeInstall.installUpdate,
      isCancelling: isCancellingPhase(activeInstall.phase),
    };
  }

  private buildTagsFragment(model: CatalogModelRecord): DocumentFragment {
    const frag = createFragment();
    const tagsContainer = frag.createSpan({ cls: 'local-stt-tags' });
    const policy = resolveModelPresentationPolicy(model);

    for (const tag of model.uxTags) {
      const policyBadge = policy.badges.find((badge) => badge.tag === tag);
      tagsContainer.createSpan({
        cls:
          policyBadge?.tone === 'warning'
            ? 'local-stt-tag local-stt-tag--warning'
            : 'local-stt-tag',
        text: policyBadge?.label ?? formatModelTagLabel(tag),
      });
    }

    const totalSize = getTotalModelSize(model);
    if (totalSize > 0) {
      tagsContainer.createSpan({
        cls: 'local-stt-tag local-stt-tag--size',
        text: formatBytes(totalSize),
      });
    }

    if (policy.warning !== null) {
      frag.createDiv({ cls: 'local-stt-model-warning', text: policy.warning });
    }

    return frag;
  }
}

export function resolveLanguageNavigationIndex(currentIndex: number, key: string): number | null {
  const last = TTS_LANGUAGE_OPTIONS.length - 1;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return currentIndex === last ? 0 : currentIndex + 1;
    case 'ArrowUp':
    case 'ArrowLeft':
      return currentIndex === 0 ? last : currentIndex - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

function getRowKey(row: ModelRowState): string {
  return `${row.model.runtimeId}:${row.model.familyId}:${row.model.modelId}`;
}

function installTripleKey(update: {
  runtimeId: RuntimeId;
  familyId: ModelFamilyId;
  modelId: string;
}): string {
  return `${update.runtimeId}:${update.familyId}:${update.modelId}`;
}
