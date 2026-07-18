import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { t } from '../shared/i18n';

export interface ConfirmModalOptions {
  cancelLabel?: string;
  confirmLabel: string;
  destructive?: boolean;
  message: string;
  onConfirm: () => Promise<void> | void;
  title: string;
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly options: ConfirmModalOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.options.title);
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: this.options.message });

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(this.options.cancelLabel ?? t('common.cancel')).onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText(this.options.confirmLabel);
        if (this.options.destructive === true) {
          button.setWarning();
        } else {
          button.setCta();
        }
        button.onClick(() => {
          void this.handleConfirm();
        });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private async handleConfirm(): Promise<void> {
    try {
      await this.options.onConfirm();
    } finally {
      this.close();
    }
  }
}
