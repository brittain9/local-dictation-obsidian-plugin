import { Setting } from 'obsidian';

import {
  createInstallProgressElement,
  type InstallProgressState,
} from '../models/model-install-progress';

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
  const fragment = document.createDocumentFragment();
  fragment.append(progressEl);

  const setting = new Setting(container).setName(opts.name).setDesc(fragment);
  setting.addButton((button) => {
    button
      .setButtonText(opts.isCancelling ? 'Cancelling...' : 'Cancel')
      .setDisabled(opts.isCancelling)
      .onClick(opts.onCancel);
  });

  return { progressEl };
}
