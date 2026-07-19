import { Setting } from 'obsidian';

import { isCancellingPhase, type ModelInstallManager } from '../models/model-install-manager';
import { updateInstallProgressElement } from '../models/model-install-progress';
import { type CurrentModelStatus, deriveCurrentModelDisplay } from '../models/model-row-state';
import { t } from '../shared/i18n';
import { renderActiveInstallCard } from './install-progress-row';

// ---------------------------------------------------------------------------
// Badge helper (maps stable model status -> CSS modifier + localized display text)
// ---------------------------------------------------------------------------

export function getModelStatusBadge(
  status: CurrentModelStatus,
): { modifier: string; text: string } | null {
  switch (status) {
    case 'installed':
      return null;
    case 'not_installed':
      return { modifier: 'missing', text: t('settings.model.notInstalled') };
    case 'external_validated':
      return { modifier: 'ready', text: t('settings.model.validatedExternal') };
    case 'external_file':
      return { modifier: 'external', text: t('settings.model.external') };
    case 'checking':
      return { modifier: 'external', text: t('settings.model.checking') };
    case 'unavailable':
      return { modifier: 'missing', text: t('settings.model.unavailable') };
    case 'not_selected':
      return { modifier: 'none', text: t('settings.model.noModel') };
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ModelSectionCallbacks {
  onManageModels: () => void;
  onExternalFile: () => void;
  onModelInfo: (() => void) | null;
}

/**
 * Renders the model section of the settings tab using the new
 * ModelInstallManager as the state source.
 *
 * Returns a dispose function that unsubscribes from manager state changes.
 * Call it when the settings tab is hidden or re-rendered.
 */
export function renderModelSection(
  container: HTMLDivElement,
  manager: ModelInstallManager,
  callbacks: ModelSectionCallbacks,
): () => void {
  let installProgressEl: HTMLDivElement | null = null;

  function render(): void {
    container.empty();
    installProgressEl = null;

    const state = manager.getState();
    const currentModel = deriveCurrentModelDisplay(state);

    // --- Current model row ---
    const descFragment = createFragment();
    let hasMetadata = false;
    const appendSeparator = (): void => {
      if (hasMetadata) {
        descFragment.createSpan({ text: ' \u00b7 ' });
      }
      hasMetadata = true;
    };

    if (currentModel.engineLabel.length > 0) {
      appendSeparator();
      descFragment.createSpan({ text: currentModel.engineLabel });
    }
    const caps = state.selectedModelCapabilities;
    if (caps.status === 'ready' && caps.capabilities.family.supportsStreaming) {
      appendSeparator();
      descFragment.createSpan({
        cls: 'local-stt-badge local-stt-badge--streaming',
        text: t('settings.model.streaming'),
      });
    }
    const badge = getModelStatusBadge(currentModel.status);
    if (badge !== null) {
      appendSeparator();
      descFragment.createSpan({
        cls: `local-stt-badge local-stt-badge--${badge.modifier}`,
        text: badge.text,
      });
    }
    if (currentModel.detail.length > 0) {
      if (hasMetadata) {
        descFragment.createEl('br');
      }
      descFragment.createSpan({ text: currentModel.detail });
    }

    const cardSetting = new Setting(container)
      .setName(currentModel.displayName)
      .setDesc(descFragment);

    cardSetting.addButton((button) => {
      button
        .setCta()
        .setButtonText(t('settings.model.manageModels'))
        .onClick(() => {
          callbacks.onManageModels();
        });
    });

    cardSetting.addExtraButton((button) => {
      button
        .setIcon('file-input')
        .setTooltip(t('settings.model.useExternalFile'))
        .onClick(() => {
          callbacks.onExternalFile();
        });
    });

    if (callbacks.onModelInfo !== null) {
      const onModelInfo = callbacks.onModelInfo;
      cardSetting.addExtraButton((button) => {
        button
          .setIcon('info')
          .setTooltip(t('settings.model.details'))
          .onClick(() => {
            onModelInfo();
          });
      });
    }

    // --- Install progress panel ---
    const { activeInstall } = state;
    if (activeInstall !== null) {
      const progressState = {
        ...activeInstall.installUpdate,
        isCancelling: isCancellingPhase(activeInstall.phase),
      };
      const activeInstallDisplayName =
        state.catalog.models.find(
          (m) =>
            m.runtimeId === activeInstall.installUpdate.runtimeId &&
            m.familyId === activeInstall.installUpdate.familyId &&
            m.modelId === activeInstall.installUpdate.modelId,
        )?.displayName ?? activeInstall.installUpdate.modelId;

      const isCancelling = isCancellingPhase(activeInstall.phase);
      const { progressEl } = renderActiveInstallCard(container, {
        isCancelling,
        name: t('settings.install.installingNamed', { name: activeInstallDisplayName }),
        onCancel: () => {
          void manager.cancel();
        },
        progressState,
      });
      installProgressEl = progressEl;
    }

    // This row lives in a private wrapper so manager updates cannot erase the
    // sibling language control. Keep Obsidian's `.setting-item:last-child`
    // rule from stripping its bottom padding and pulling the divider upward.
    container.createSpan({ attr: { 'aria-hidden': 'true', style: 'display: none;' } });
  }

  function handleStateChange(): void {
    const state = manager.getState();
    const { activeInstall } = state;

    // If progress element is present and install is still active, do a fast
    // in-place update instead of a full re-render.
    if (activeInstall !== null && installProgressEl !== null) {
      updateInstallProgressElement(installProgressEl, {
        ...activeInstall.installUpdate,
        isCancelling: isCancellingPhase(activeInstall.phase),
      });
      return;
    }

    render();
  }

  render();
  return manager.subscribe(handleStateChange);
}
