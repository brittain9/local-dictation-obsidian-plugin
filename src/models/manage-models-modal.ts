import type { App } from 'obsidian';
import { Modal, Setting, setIcon } from 'obsidian';

import {
  catalogModelSupportsLanguage,
  dictationLanguageLabel,
} from '../language/dictation-language';
import { formatBytes } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
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
import { deriveModelFamilyTabs, deriveModelRowStates, type ModelRowState } from './model-row-state';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

interface ManageModelsModalDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  manager: ModelInstallManager;
  onChanged: () => void;
  onRunSetup?: () => void;
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
  private listContainer: HTMLDivElement | null = null;
  private readonly progressElements = new Map<string, HTMLDivElement>();
  private releaseSubscription: (() => void) | null = null;
  private tabButtons = new Map<string, HTMLButtonElement>();
  private tabBarEl: HTMLDivElement | null = null;

  constructor(
    app: App,
    private readonly deps: ManageModelsModalDependencies,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass('local-stt-manage-models');
    this.titleEl.setText(t('models.manage.title'));
    this.renderContent();

    this.releaseSubscription = this.deps.manager.subscribe(() => {
      this.handleStateChange();
    });
  }

  private renderContent(): void {
    this.contentEl.empty();
    this.progressElements.clear();
    this.tabBarEl = null;
    this.listContainer = null;
    this.tabButtons.clear();

    const state = this.deps.manager.getState();
    if (state.loadStatus === 'error' && this.deps.onRunSetup !== undefined) {
      this.renderLoadErrorPanel();
      return;
    }

    const toolbar = this.contentEl.createDiv({ cls: 'local-stt-toolbar' });
    this.tabBarEl = toolbar.createDiv({ cls: 'local-stt-tab-bar' });
    this.listContainer = this.contentEl.createDiv({ cls: 'local-stt-model-list' });
    this.renderTabs();
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
    this.listContainer = null;
    this.tabBarEl = null;
    this.tabButtons.clear();
    this.progressElements.clear();
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // Tab bar
  // -------------------------------------------------------------------------

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
    const adapters = deriveModelFamilyTabs(state);

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
      if (
        adapters.findIndex((candidate) => candidate.task === adapter.task) ===
        adapters.indexOf(adapter)
      ) {
        this.tabBarEl.createSpan({
          cls: 'local-stt-task-label',
          text:
            adapter.task === 'tts'
              ? t('models.manage.readAloudModels')
              : t('models.manage.dictationModels'),
        });
      }
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
    if (this.listContainer === null || this.activeTab === null) {
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

    const activeFamily = state.catalog.families.find(
      (f) => f.runtimeId === this.activeTab?.runtimeId && f.familyId === this.activeTab?.familyId,
    );
    if (activeFamily !== undefined && activeFamily.summary.length > 0) {
      this.listContainer.createEl('p', {
        cls: 'local-stt-family-summary',
        text: localizeFamilySummary(activeFamily.familyId, activeFamily.summary),
      });
    }

    const rows = deriveModelRowStates(state);
    const activeTab = this.activeTab;
    const tabRows = rows.filter(
      (row) =>
        row.model.runtimeId === activeTab.runtimeId && row.model.familyId === activeTab.familyId,
    );

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
                void this.runAction(
                  async () => {
                    await this.deps.manager.install({
                      familyId: row.model.familyId,
                      kind: 'catalog_model',
                      modelId: row.model.modelId,
                      runtimeId: row.model.runtimeId,
                    });
                  },
                  { failureMessage: t('models.manage.installStartFailed') },
                );
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
      this.renderVoiceRows(row, container);
    }
  }

  private renderVoiceRows(row: ModelRowState, container: HTMLDivElement): void {
    const installed = this.deps.manager
      .getState()
      .installedModels.find((model) =>
        matchesModelTriple(model, row.model.runtimeId, row.model.familyId, row.model.modelId),
      );
    for (const artifact of row.model.artifacts.filter(
      (candidate) => candidate.role === 'voice' && !candidate.required,
    )) {
      const voiceId = artifact.voiceId;
      if (voiceId === undefined) continue;
      const voiceSetting = new Setting(container)
        .setName(voiceLabel(voiceId))
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

      // The active install belongs to a different adapter than the visible tab.
      // Progress ticks for that install don't affect visible rows — skip the
      // full re-render to avoid clobbering the DOM under the user's cursor.
      if (
        this.activeTab === null ||
        activeInstall.installUpdate.runtimeId !== this.activeTab.runtimeId ||
        activeInstall.installUpdate.familyId !== this.activeTab.familyId
      ) {
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

    for (const tag of model.uxTags) {
      tagsContainer.createSpan({
        cls: 'local-stt-tag',
        text: formatModelTagLabel(tag),
      });
    }

    const totalSize = getTotalModelSize(model);
    if (totalSize > 0) {
      tagsContainer.createSpan({
        cls: 'local-stt-tag local-stt-tag--size',
        text: formatBytes(totalSize),
      });
    }

    return frag;
  }
}

function voiceLabel(voiceId: string): string {
  return `${voiceId.charAt(0).toUpperCase()}${voiceId.slice(1)}`;
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
