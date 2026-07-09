import type { App } from 'obsidian';
import { Modal, Setting, setIcon } from 'obsidian';

import { formatBytes } from '../shared/format-utils';
import type { UserFeedback } from '../shared/user-feedback';
import { resolveEngineCapabilities } from './capability-view';
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
    this.titleEl.setText('Manage models');
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
      this.renderLoadErrorPanel(state.loadError);
      return;
    }

    const toolbar = this.contentEl.createDiv({ cls: 'local-stt-toolbar' });
    this.tabBarEl = toolbar.createDiv({ cls: 'local-stt-tab-bar' });
    this.listContainer = this.contentEl.createDiv({ cls: 'local-stt-model-list' });
    this.renderTabs();
    this.renderModelList();
  }

  private renderLoadErrorPanel(loadError: string | null): void {
    const panel = this.contentEl.createDiv({ cls: 'local-stt-empty-panel' });
    const iconWrap = panel.createDiv({ cls: 'local-stt-empty-panel__icon' });
    setIcon(iconWrap, 'download-cloud');
    panel.createEl('h3', { text: "Couldn't load models" });
    panel.createEl('p', {
      text: 'The speech engine may not be installed or may not be responding. Re-run setup to reinstall it, or try again.',
    });
    if (loadError !== null && loadError.length > 0) {
      panel.createEl('p', { cls: 'local-stt-empty-panel__detail', text: loadError });
    }
    const actions = panel.createDiv({ cls: 'local-stt-empty-panel__actions' });
    actions
      .createEl('button', { cls: 'mod-cta', text: 'Run setup' })
      .addEventListener('click', () => {
        this.close();
        this.deps.onRunSetup?.();
      });
    actions.createEl('button', { text: 'Try again' }).addEventListener('click', () => {
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
      this.listContainer.createEl('p', { text: 'Loading model catalog\u2026' });
      return;
    }

    if (state.loadStatus === 'error') {
      this.listContainer.createEl('p', {
        text: state.loadError ?? 'Failed to load the model catalog.',
      });
      return;
    }

    const activeFamily = state.catalog.families.find(
      (f) => f.runtimeId === this.activeTab?.runtimeId && f.familyId === this.activeTab?.familyId,
    );
    if (activeFamily !== undefined && activeFamily.summary.length > 0) {
      this.listContainer.createEl('p', {
        cls: 'local-stt-family-summary',
        text: activeFamily.summary,
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
        text: 'No models available for this engine.',
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
      setting.setDesc(this.buildTagsFragment(row.model));
    }

    // Action buttons based on allowedActions.
    for (const action of row.allowedActions) {
      switch (action) {
        case 'install':
          setting.addButton((button) => {
            button
              .setCta()
              .setButtonText('Install')
              .setDisabled(this.actionInProgress)
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
                  { failureMessage: 'Could not start the model install. Try again.' },
                );
              });
          });
          break;

        case 'use':
          setting.addButton((button) => {
            button
              .setCta()
              .setButtonText('Use')
              .setDisabled(this.actionInProgress)
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
                    failureMessage:
                      'Could not select the model. Check that its files are available.',
                    successMessage: 'Model selected.',
                  },
                );
              });
          });
          break;

        case 'selected':
          setting.addButton((button) => {
            button.setButtonText('Selected').setDisabled(true);
          });
          break;

        case 'cancel':
          setting.addButton((button) => {
            if (row.isCanceling) {
              button.setButtonText('Cancelling\u2026').setDisabled(true);
            } else {
              button
                .setCta()
                .setButtonText('Cancel')
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
              .setButtonText('Remove')
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
                    failureMessage:
                      'Could not remove the model. Close any process using its files.',
                    successMessage: 'Model removed.',
                  },
                );
              });
          });
          break;

        case 'details':
          setting.addExtraButton((button) => {
            button
              .setIcon('info')
              .setTooltip('Details')
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
        text: tag,
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
