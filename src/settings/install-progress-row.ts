import { Setting } from 'obsidian';
import {
  createInstallProgressElement,
  type InstallProgressState,
  updateInstallProgressElement,
} from '../models/model-install-progress';
import { t } from '../shared/i18n';

export interface ActiveInstallCardOptions {
  isCancelling: boolean;
  name: string;
  onCancel: () => void;
  progressState: InstallProgressState;
}

export function renderActiveInstallCard(
  container: HTMLElement,
  opts: ActiveInstallCardOptions,
): {
  progressEl: HTMLDivElement;
  update: (next: ActiveInstallCardOptions) => void;
} {
  const progressEl = createInstallProgressElement(opts.progressState);
  const fragment = createFragment();
  fragment.append(progressEl);

  const setting = new Setting(container).setName(opts.name).setDesc(fragment);
  let cancelButton: Parameters<Parameters<Setting['addButton']>[0]>[0] | null = null;
  setting.addButton((button) => {
    cancelButton = button;
    button
      .setButtonText(
        opts.isCancelling ? t('settings.install.cancelling') : t('settings.install.cancel'),
      )
      .setDisabled(opts.isCancelling)
      .onClick(opts.onCancel);
  });

  return {
    progressEl,
    update: (next) => {
      setting.setName(next.name);
      updateInstallProgressElement(progressEl, next.progressState);
      cancelButton
        ?.setButtonText(
          next.isCancelling ? t('settings.install.cancelling') : t('settings.install.cancel'),
        )
        .setDisabled(next.isCancelling);
    },
  };
}
