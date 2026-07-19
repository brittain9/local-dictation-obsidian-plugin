import { Setting } from 'obsidian';
import {
  createInstallProgressElement,
  type InstallProgressState,
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
): { progressEl: HTMLDivElement } {
  const progressEl = createInstallProgressElement(opts.progressState);
  const fragment = createFragment();
  fragment.append(progressEl);

  const setting = new Setting(container).setName(opts.name).setDesc(fragment);
  setting.addButton((button) => {
    button
      .setButtonText(
        opts.isCancelling ? t('settings.install.cancelling') : t('settings.install.cancel'),
      )
      .setDisabled(opts.isCancelling)
      .onClick(opts.onCancel);
  });

  return { progressEl };
}
