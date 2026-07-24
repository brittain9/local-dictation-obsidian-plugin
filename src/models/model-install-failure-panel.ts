import { Setting } from 'obsidian';

import { t } from '../shared/i18n';
import type { FailedInstallInfo } from './model-install-manager';
import { type CatalogModelRecord, matchesModelTriple } from './model-management-types';

export interface ModelInstallFailurePanelHandle {
  setRetryDisabled(disabled: boolean): void;
}

interface ModelInstallFailurePanelOptions {
  disabled: boolean;
  failureId: string;
  modelName: string;
  onDismiss: (failureId: string) => void;
  onRetry: (failureId: string) => void;
}

export function renderModelInstallFailurePanel(
  container: HTMLElement,
  options: ModelInstallFailurePanelOptions,
): ModelInstallFailurePanelHandle {
  const setting = new Setting(container)
    .setName(t('models.manage.installFailed', { model: options.modelName }))
    .setDesc(t('models.manage.installFailedDesc'));
  setting.settingEl.addClass('local-stt-install-failure');
  setting.settingEl.setAttribute('aria-live', 'polite');
  setting.settingEl.setAttribute('role', 'status');

  let setRetryDisabled = (_disabled: boolean): void => {};
  setting.addButton((button) => {
    setRetryDisabled = (disabled) => {
      button.setDisabled(disabled);
      button.buttonEl.toggleAttribute('aria-busy', disabled);
    };
    button
      .setCta()
      .setButtonText(t('models.manage.retryInstall'))
      .onClick(() => {
        options.onRetry(options.failureId);
      });
  });
  setting.addButton((button) => {
    button.setButtonText(t('models.manage.dismissInstallFailure')).onClick(() => {
      options.onDismiss(options.failureId);
    });
  });
  setRetryDisabled(options.disabled);

  return { setRetryDisabled };
}

export function resolveFailedInstallDisplayName(
  failedInstall: FailedInstallInfo,
  models: readonly CatalogModelRecord[],
): string {
  return (
    models.find((model) =>
      matchesModelTriple(
        model,
        failedInstall.selection.runtimeId,
        failedInstall.selection.familyId,
        failedInstall.selection.modelId,
      ),
    )?.displayName ?? failedInstall.selection.modelId
  );
}
