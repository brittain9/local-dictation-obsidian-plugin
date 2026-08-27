import type { App } from 'obsidian';
import { Modal, SearchComponent, Setting, setIcon } from 'obsidian';

import {
  catalogModelSupportsLanguage,
  dictationLanguageLabel,
  formatCatalogLanguageLabel,
} from '../language/dictation-language';
import { formatBytes, formatVoiceLabel } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import { SidecarLifecycleConflictError } from '../sidecar/sidecar-lifecycle-gate';
import { ConfirmModal } from '../ui/confirm-modal';
import { styleDestructiveButton } from '../ui/destructive-button';
import { localizeFamilySummary } from './catalog-localization';
import { formatModelTagLabel } from './model-guidance';
import {
  isCancellingPhase,
  type ModelInstallManager,
  type ModelManagerState,
} from './model-install-manager';
import {
  createInstallProgressElement,
  type InstallProgressState,
  updateInstallProgressElement,
} from './model-install-progress';
import { openModelDetailsModal } from './model-management-modals';
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

export type ModelPickerTask = 'stt' | 'translation' | 'tts';
const MODEL_PICKER_TASKS: readonly ModelPickerTask[] = ['stt', 'tts', 'translation'];

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

function taskLabel(task: ModelPickerTask): string {
  switch (task) {
    case 'stt':
      return t('models.manage.dictationModels');
    case 'translation':
      return t('models.manage.translationModels');
    case 'tts':
      return t('models.manage.readAloudModels');
  }
}

export type ModelLanguageFilter = { kind: 'all' } | { kind: 'language'; tag: string };

export interface ModelLanguageOption {
  code: string | null;
  filter: ModelLanguageFilter;
  label: string;
}

export const ALL_MODEL_LANGUAGES: ModelLanguageFilter = { kind: 'all' };

const MODEL_LANGUAGE_ORDER = ['en', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'ja'] as const;

export function deriveModelLanguageOptions(
  models: readonly CatalogModelRecord[],
): ModelLanguageOption[] {
  const languageTags = new Set(
    models.filter((model) => model.task === 'stt').flatMap((model) => model.languageTags),
  );
  const knownTags = MODEL_LANGUAGE_ORDER.filter((tag) => languageTags.delete(tag));
  const remainingTags = [...languageTags].sort((left, right) => left.localeCompare(right));

  return [
    { code: null, filter: ALL_MODEL_LANGUAGES, label: t('models.manage.allLanguages') },
    ...[...knownTags, ...remainingTags].map((tag) => ({
      code: tag.toUpperCase(),
      filter: { kind: 'language' as const, tag },
      label: modelLanguageLabel(tag),
    })),
  ];
}

export function modelMatchesLanguageFilter(
  model: Pick<CatalogModelRecord, 'languageTags'>,
  filter: ModelLanguageFilter,
): boolean {
  return filter.kind === 'all' || model.languageTags.includes(filter.tag);
}

interface ManageModelsModalDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  initialTask?: ModelPickerTask;
  manager: ModelInstallManager;
  onChanged: () => void;
  openModelStore?: (path: string) => Promise<void>;
  onRunSetup?: () => void;
}

export function filterModelRowsForPicker(
  rows: readonly ModelRowState[],
  options: {
    activeFamily: AdapterTabKey | null;
    language: ModelLanguageFilter;
    query: string;
    task: ModelPickerTask;
  },
): ModelRowState[] {
  const query = options.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (row.model.task !== options.task) return false;
    if (
      options.activeFamily === null ||
      row.model.runtimeId !== options.activeFamily.runtimeId ||
      row.model.familyId !== options.activeFamily.familyId ||
      !modelMatchesLanguageFilter(row.model, options.language)
    ) {
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

export function derivePickerFamilyTabs(
  adapters: readonly ReturnType<typeof deriveModelFamilyTabs>[number][],
  rows: readonly ModelRowState[],
  options: { language: ModelLanguageFilter; task: ModelPickerTask },
): ReturnType<typeof deriveModelFamilyTabs> {
  return adapters.filter(
    (adapter) =>
      adapter.task === options.task &&
      rows.some(
        (row) =>
          row.model.task === options.task &&
          row.model.runtimeId === adapter.runtimeId &&
          row.model.familyId === adapter.familyId &&
          modelMatchesLanguageFilter(row.model, options.language),
      ),
  );
}

function adapterTabId(key: AdapterTabKey): string {
  return `${key.runtimeId}:${key.familyId}`;
}

// ---------------------------------------------------------------------------
// ManageModelsModal
// ---------------------------------------------------------------------------

export class ManageModelsModal extends Modal {
  private actionInProgress = false;
  private readonly activeTabs = new Map<ModelPickerTask, AdapterTabKey>();
  private activeTask: ModelPickerTask;
  private activeLanguage: ModelLanguageFilter = ALL_MODEL_LANGUAGES;
  private browserEl: HTMLDivElement | null = null;
  private navigationEl: HTMLDivElement | null = null;
  private navigationSignature = '';
  private listContainer: HTMLDivElement | null = null;
  private readonly progressElements = new Map<string, HTMLDivElement>();
  private releaseSubscription: (() => void) | null = null;
  private tabButtons = new Map<string, HTMLButtonElement>();
  private tabBarEl: HTMLDivElement | null = null;
  private search: SearchComponent | null = null;
  private searchQuery = '';
  private taskButtons = new Map<ModelPickerTask, HTMLButtonElement>();
  private renderedFailureId: string | null = null;

  constructor(
    app: App,
    private readonly deps: ManageModelsModalDependencies,
  ) {
    super(app);
    this.activeTask = resolveInitialModelPickerTask(deps);
  }

  override onOpen(): void {
    this.modalEl.addClass('local-stt-manage-models');
    this.setTitle(t('models.manage.title'));
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
    this.navigationSignature = '';
    this.tabBarEl = null;
    this.listContainer = null;
    this.search = null;
    this.tabButtons.clear();
    this.taskButtons.clear();

    const state = this.deps.manager.getState();
    this.renderedFailureId = state.failedInstall?.failureId ?? null;
    // Reopening with a pending failure must land on the row that reports it,
    // which overrides the caller's preferred initial task.
    this.revealFailedModel(state);

    if (state.loadStatus === 'error' && this.deps.onRunSetup !== undefined) {
      this.renderLoadErrorPanel();
      return;
    }

    const toolbar = this.contentEl.createDiv({ cls: 'local-stt-toolbar' });
    if (state.modelStore.path.length > 0 && this.deps.openModelStore !== undefined) {
      const openModelStore = toolbar.createEl('button', {
        text: t('models.manage.openFolder'),
      });
      openModelStore.addEventListener('click', () => {
        void this.openModelStore(state.modelStore.path);
      });
    }
    const taskSwitcher = toolbar.createDiv({
      attr: { 'aria-label': t('models.manage.taskLabel'), role: 'tablist' },
      cls: 'local-stt-task-switcher',
    });
    for (const [index, task] of MODEL_PICKER_TASKS.entries()) {
      const button = taskSwitcher.createEl('button', {
        attr: {
          'aria-selected': String(task === this.activeTask),
          role: 'tab',
          tabindex: task === this.activeTask ? '0' : '-1',
          type: 'button',
        },
        cls: 'local-stt-task-switcher__button',
        text: taskLabel(task),
      });
      button.toggleClass('is-active', task === this.activeTask);
      button.addEventListener('click', () => this.switchTask(task));
      button.addEventListener('keydown', (event) => {
        const nextIndex = resolveTabNavigationIndex(index, event.key, MODEL_PICKER_TASKS.length);
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTask = MODEL_PICKER_TASKS[nextIndex];
        if (nextTask === undefined) return;
        this.switchTask(nextTask);
        this.taskButtons.get(nextTask)?.focus();
      });
      this.taskButtons.set(task, button);
    }
    const searchLabel = t('models.manage.searchPlaceholder', {
      task: taskLabel(this.activeTask),
    });
    const searchHost = toolbar.createDiv({ cls: 'local-stt-model-search' });
    this.search = new SearchComponent(searchHost)
      .setPlaceholder(searchLabel)
      .setValue(this.searchQuery)
      .onChange((value) => {
        this.searchQuery = value;
        this.renderModelList();
      });
    this.search.inputEl.setAttribute('aria-label', searchLabel);

    this.browserEl = this.contentEl.createDiv({ cls: 'local-stt-model-browser' });
    this.navigationEl = this.browserEl.createDiv({
      cls: 'local-stt-model-browser__navigation local-stt-language-rail',
    });
    const results = this.browserEl.createDiv({ cls: 'local-stt-model-browser__results' });
    this.tabBarEl = results.createDiv({
      attr: { 'aria-label': t('models.manage.familiesLabel'), role: 'tablist' },
      cls: 'local-stt-tab-bar',
    });
    this.listContainer = results.createDiv({ cls: 'local-stt-model-list' });
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
    this.navigationSignature = '';
    this.listContainer = null;
    this.tabBarEl = null;
    this.search = null;
    this.tabButtons.clear();
    this.taskButtons.clear();
    this.progressElements.clear();
    this.renderedFailureId = null;
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // Task and navigation controls
  // -------------------------------------------------------------------------

  private switchTask(task: ModelPickerTask): void {
    if (task === this.activeTask) return;
    this.setActiveTask(task);
    this.renderNavigation();
    this.renderModelList();
  }

  /**
   * Moves the browser to `task` without rendering, so callers that are about to
   * build the toolbar from scratch and callers reacting to a state change can
   * share one definition of what switching tasks means.
   */
  private setActiveTask(task: ModelPickerTask): void {
    if (task === this.activeTask) return;
    this.searchQuery = searchQueryAfterTaskSwitch(this.activeTask, task, this.searchQuery);
    this.activeTask = task;
    if (this.search !== null) {
      this.search.setValue('');
      const placeholder = t('models.manage.searchPlaceholder', { task: taskLabel(task) });
      this.search.setPlaceholder(placeholder);
      this.search.inputEl.setAttribute('aria-label', placeholder);
    }
    for (const [candidate, button] of this.taskButtons) {
      button.toggleClass('is-active', candidate === task);
      button.setAttribute('aria-selected', String(candidate === task));
      button.setAttribute('tabindex', candidate === task ? '0' : '-1');
    }
  }

  private renderNavigation(): void {
    if (this.navigationEl === null) return;
    this.renderLanguageRail();
    this.renderTabs();
    this.navigationSignature = this.buildNavigationSignature();
  }

  private renderLanguageRail(): void {
    if (this.navigationEl === null) return;
    this.navigationEl.empty();
    this.navigationEl.addClass('local-stt-language-rail');
    this.navigationEl.setAttribute('role', 'tablist');
    this.navigationEl.setAttribute('aria-label', t('models.manage.languagesLabel'));
    const options = deriveModelLanguageOptions(this.getRunnableRows().map((row) => row.model));
    for (const [index, language] of options.entries()) {
      const selected = languageFiltersEqual(language.filter, this.activeLanguage);
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
      if (language.code !== null) {
        button.createSpan({ cls: 'local-stt-language-rail__code', text: language.code });
      }
      button.toggleClass('is-active', selected);
      button.addEventListener('click', () => this.selectLanguage(language.filter));
      button.addEventListener('keydown', (event) => {
        const nextIndex = resolveTabNavigationIndex(index, event.key, options.length);
        if (nextIndex === null) return;
        event.preventDefault();
        const next = options[nextIndex];
        if (next === undefined) return;
        this.selectLanguage(next.filter);
        this.navigationEl
          ?.querySelectorAll<HTMLButtonElement>('.local-stt-language-rail__button')
          .item(nextIndex)
          .focus();
      });
    }
  }

  private selectLanguage(language: ModelLanguageFilter): void {
    if (languageFiltersEqual(language, this.activeLanguage)) return;
    this.activeLanguage = language;
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
    const rows = this.getRunnableRows();

    // Only show adapter tabs for (runtime, family) pairs present in both the
    // compiled sidecar AND the catalog — compiled alone doesn't guarantee any
    // downloadable models, and catalog alone doesn't guarantee the sidecar can
    // run them.
    const adapters = derivePickerFamilyTabs(deriveModelFamilyTabs(state), rows, {
      language: this.activeLanguage,
      task: this.activeTask,
    });
    const activeTab = this.getActiveTab();

    if (
      activeTab === null ||
      !adapters.some(
        (adapter) =>
          adapter.runtimeId === activeTab.runtimeId && adapter.familyId === activeTab.familyId,
      )
    ) {
      const first = adapters[0];
      if (first === undefined) {
        this.activeTabs.delete(this.activeTask);
      } else {
        this.activeTabs.set(this.activeTask, {
          runtimeId: first.runtimeId,
          familyId: first.familyId,
        });
      }
    }

    for (const [index, adapter] of adapters.entries()) {
      const tabKey: AdapterTabKey = {
        runtimeId: adapter.runtimeId,
        familyId: adapter.familyId,
      };
      const btn = this.tabBarEl.createEl('button', {
        cls: 'local-stt-tab',
        text: adapter.displayName,
      });

      const selected = matchesAdapterTab(tabKey, this.getActiveTab());
      if (selected) {
        btn.addClass('local-stt-tab--active');
      }
      btn.setAttribute('aria-selected', String(selected));
      btn.setAttribute('role', 'tab');
      btn.setAttribute('tabindex', selected ? '0' : '-1');

      btn.addEventListener('click', () => {
        this.selectFamily(tabKey);
      });
      btn.addEventListener('keydown', (event) => {
        const nextIndex = resolveTabNavigationIndex(index, event.key, adapters.length);
        if (nextIndex === null) return;
        event.preventDefault();
        const next = adapters[nextIndex];
        if (next === undefined) return;
        const nextTab = { familyId: next.familyId, runtimeId: next.runtimeId };
        this.selectFamily(nextTab);
        this.tabButtons.get(adapterTabId(nextTab))?.focus();
      });

      this.tabButtons.set(adapterTabId(tabKey), btn);
    }
  }

  private updateTabActiveStates(): void {
    const activeTab = this.getActiveTab();
    const activeId = activeTab === null ? null : adapterTabId(activeTab);
    for (const [tabId, btn] of this.tabButtons) {
      const selected = tabId === activeId;
      btn.toggleClass('local-stt-tab--active', selected);
      btn.setAttribute('aria-selected', String(selected));
      btn.setAttribute('tabindex', selected ? '0' : '-1');
    }
  }

  private selectFamily(tab: AdapterTabKey): void {
    if (matchesAdapterTab(tab, this.getActiveTab())) return;
    this.activeTabs.set(this.activeTask, tab);
    this.updateTabActiveStates();
    this.renderModelList();
  }

  // -------------------------------------------------------------------------
  // Model list
  // -------------------------------------------------------------------------

  private renderModelList(): void {
    if (this.listContainer === null) {
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

    const activeTab = this.getActiveTab();
    if (activeTab === null) {
      this.listContainer.createEl('p', {
        cls: 'local-stt-empty-state',
        text:
          this.activeLanguage.kind === 'all'
            ? t('models.manage.noneAvailable')
            : t('models.manage.noneForLanguage'),
      });
      return;
    }

    const activeFamily = state.catalog.families.find(
      (family) =>
        family.task === this.activeTask &&
        family.runtimeId === activeTab.runtimeId &&
        family.familyId === activeTab.familyId,
    );
    if (activeFamily !== undefined && activeFamily.summary.length > 0) {
      this.listContainer.createEl('p', {
        cls: 'local-stt-family-summary',
        text: localizeFamilySummary(activeFamily.familyId, activeFamily.summary),
      });
    }

    const rows = this.getRunnableRows();
    const tabRows = filterModelRowsForPicker(rows, {
      activeFamily: activeTab,
      language: this.activeLanguage,
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
    setting.setClass('local-stt-model-row');
    setting.setName(row.model.displayName);
    const selectedLanguage = this.deps.manager.getDictationLanguage();
    const supportsSelectedLanguage =
      row.model.task !== 'stt' || catalogModelSupportsLanguage(row.model, selectedLanguage);

    // Description: install progress when installing/canceling, the same bar in
    // its failed state when the last install for this model failed, tags + size
    // otherwise.
    if (row.isInstalling || row.isCanceling) {
      const progressState = this.buildProgressState(row);
      if (progressState !== null) {
        const progressEl = createInstallProgressElement(progressState);
        this.progressElements.set(getRowKey(row), progressEl);
        const fragment = createFragment();
        fragment.append(progressEl);
        setting.setDesc(fragment);
      }
    } else if (row.failedInstall !== null) {
      // Deliberately not registered in `progressElements`: a failure is a
      // settled state with nothing left to tick.
      const fragment = createFragment();
      fragment.append(
        createInstallProgressElement({
          details: null,
          downloadedBytes: null,
          isCancelling: false,
          message: row.failedInstall.message,
          state: 'failed',
          totalBytes: null,
        }),
      );
      setting.setDesc(fragment);
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
            styleDestructiveButton(button)
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

        case 'retry':
          setting.addButton((button) => {
            const failureId = row.failedInstall?.failureId ?? null;
            button
              .setCta()
              .setButtonText(t('models.manage.retryInstall'))
              .setDisabled(
                this.actionInProgress ||
                  failureId === null ||
                  this.deps.manager.getState().activeInstall !== null,
              )
              .onClick(() => {
                if (failureId === null) return;
                void this.runAction(
                  async () => {
                    await this.deps.manager.retryFailedInstall(failureId);
                  },
                  { failureMessage: t('models.manage.installStartFailed') },
                );
              });
          });
          break;

        case 'dismiss':
          setting.addButton((button) => {
            const failureId = row.failedInstall?.failureId ?? null;
            button
              .setButtonText(t('models.manage.dismissInstallFailure'))
              .setDisabled(this.actionInProgress || failureId === null)
              .onClick(() => {
                if (failureId === null) return;
                this.deps.manager.dismissFailedInstall(failureId);
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
                openModelDetailsModal(this.app, state, {
                  familyId: row.model.familyId,
                  kind: 'catalog_model',
                  modelId: row.model.modelId,
                  runtimeId: row.model.runtimeId,
                });
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
    const missingOptionalVoices = optionalVoices.filter(
      (artifact) =>
        artifact.voiceId !== undefined &&
        !(installed?.installedVoiceIds.includes(artifact.voiceId) ?? false),
    );
    if (missingOptionalVoices.length > 1) {
      new Setting(details)
        .setName(t('models.manage.installAllVoices'))
        .setDesc(t('models.manage.installAllVoicesDesc', { count: missingOptionalVoices.length }))
        .addButton((button) => {
          button
            .setButtonText(t('common.install'))
            .setCta()
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
                    missingOptionalVoices.map((artifact) => artifact.artifactId),
                  );
                },
                { failureMessage: t('models.manage.installStartFailed') },
              );
            });
        });
    }
    for (const artifact of optionalVoices) {
      const voiceId = artifact.voiceId;
      if (voiceId === undefined) continue;
      const voiceSetting = new Setting(details)
        .setName(formatVoiceLabel(voiceId))
        .setDesc(t('models.manage.optionalVoice'));
      voiceSetting.setClass('local-stt-voice-row');
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
      confirmLabel: confirmation.confirmLabel,
      ...(confirmation.link === null ? {} : { link: confirmation.link }),
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

    const priorFailureId = this.renderedFailureId;
    const nextFailureId = state.failedInstall?.failureId ?? null;
    if (priorFailureId !== nextFailureId) {
      this.renderedFailureId = nextFailureId;
      // The failure is reported on the model's own row, so that row has to be
      // reachable — otherwise an active tab, language, or search filter would
      // swallow the only report the user gets.
      this.revealFailedModel(state);
      this.renderNavigation();
      this.renderModelList();
      return;
    }

    if (this.navigationSignature !== this.buildNavigationSignature()) {
      this.renderNavigation();
      this.renderModelList();
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
      const activeTab = this.getActiveTab();
      const visible =
        installingModel?.task === this.activeTask &&
        modelMatchesLanguageFilter(installingModel, this.activeLanguage) &&
        activeTab !== null &&
        activeInstall.installUpdate.runtimeId === activeTab.runtimeId &&
        activeInstall.installUpdate.familyId === activeTab.familyId;
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
      // A busy engine is not a failed action: the model is untouched and the
      // same click works once playback stops. Saying "could not remove" here
      // would send the user looking for a problem with the model.
      if (error instanceof SidecarLifecycleConflictError) {
        this.deps.feedback.show({
          intent: 'warning',
          message:
            error.activeKind === 'mutation'
              ? t('settings.sidecar.operationInProgress')
              : t('models.manage.stopSpeechFirst'),
        });
      } else if (messages.failureMessage !== undefined) {
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

  private async openModelStore(path: string): Promise<void> {
    try {
      await this.deps.openModelStore?.(path);
    } catch (error) {
      this.deps.feedback.show({
        cause: error,
        intent: 'error',
        message: t('models.manage.openFolderFailed'),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Points the browser at the model whose install just failed. Silent when
   * there is no failure or the model left the catalog.
   */
  private revealFailedModel(state: Readonly<ModelManagerState>): void {
    const failure = state.failedInstall;
    if (failure === null) return;

    const model = state.catalog.models.find((candidate) =>
      matchesModelTriple(
        candidate,
        failure.selection.runtimeId,
        failure.selection.familyId,
        failure.selection.modelId,
      ),
    );
    if (model === undefined) return;

    this.setActiveTask(model.task);
    this.activeTabs.set(model.task, { familyId: model.familyId, runtimeId: model.runtimeId });
    if (!modelMatchesLanguageFilter(model, this.activeLanguage)) {
      this.activeLanguage = ALL_MODEL_LANGUAGES;
    }
    if (this.searchQuery.trim().length > 0) {
      this.searchQuery = '';
      this.search?.setValue('');
    }
  }

  private getActiveTab(): AdapterTabKey | null {
    return this.activeTabs.get(this.activeTask) ?? null;
  }

  private buildNavigationSignature(): string {
    return this.getRunnableRows()
      .map((row) => {
        const { model } = row;
        return [
          model.runtimeId,
          model.familyId,
          model.modelId,
          model.task,
          ...model.languageTags,
        ].join(':');
      })
      .join('|');
  }

  private getRunnableRows(): ModelRowState[] {
    const state = this.deps.manager.getState();
    return deriveModelRowStates(state).filter((row) =>
      state.compiledAdapters.some(
        (adapter) =>
          adapter.runtimeId === row.model.runtimeId && adapter.familyId === row.model.familyId,
      ),
    );
  }

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

export function resolveTabNavigationIndex(
  currentIndex: number,
  key: string,
  optionCount: number,
): number | null {
  if (optionCount <= 0) return null;
  const last = optionCount - 1;
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

function languageFiltersEqual(left: ModelLanguageFilter, right: ModelLanguageFilter): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'all') return true;
  return right.kind === 'language' && left.tag === right.tag;
}

function matchesAdapterTab(left: AdapterTabKey, right: AdapterTabKey | null): boolean {
  return right !== null && left.runtimeId === right.runtimeId && left.familyId === right.familyId;
}

function modelLanguageLabel(tag: string): string {
  return formatCatalogLanguageLabel(tag);
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
