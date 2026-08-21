import type { App } from 'obsidian';
import { type ButtonComponent, Modal, Setting } from 'obsidian';

import { t } from '../shared/i18n';
import { styleDestructiveButton } from './destructive-button';

export interface ConfirmModalOptions {
  cancelLabel?: string;
  confirmLabel: string;
  destructive?: boolean;
  link?: { href: string; text: string };
  message: string;
  onConfirm: () => Promise<void> | void;
  title: string;
}

export class ConfirmModal extends Modal {
  private cancelButton: ButtonComponent | null = null;
  private confirmButton: ButtonComponent | null = null;
  private confirming = false;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly options: ConfirmModalOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.options.title);
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: this.options.message });
    if (this.options.link !== undefined) {
      this.contentEl.createEl('a', {
        attr: { href: this.options.link.href, rel: 'noopener', target: '_blank' },
        text: this.options.link.text,
      });
    }
    this.errorEl = this.contentEl.createEl('p', {
      attr: { role: 'alert' },
      cls: 'local-stt-confirm-modal__error',
    });
    this.errorEl.hide();

    new Setting(this.contentEl)
      .addButton((button) => {
        this.cancelButton = button;
        button.setButtonText(this.options.cancelLabel ?? t('common.cancel')).onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.confirmButton = button;
        button.setButtonText(this.options.confirmLabel);
        if (this.options.destructive === true) {
          styleDestructiveButton(button, { primary: true });
        } else {
          button.setCta();
        }
        button.onClick(() => {
          void this.handleConfirm();
        });
      });
  }

  override onClose(): void {
    this.cancelButton = null;
    this.confirmButton = null;
    this.errorEl = null;
    this.contentEl.empty();
  }

  private async handleConfirm(): Promise<void> {
    if (this.confirming) return;
    this.confirming = true;
    this.cancelButton?.setDisabled(true);
    this.confirmButton?.setDisabled(true);
    this.errorEl?.hide();
    try {
      await this.options.onConfirm();
      this.close();
    } catch {
      this.errorEl?.setText(t('common.actionFailed'));
      this.errorEl?.show();
    } finally {
      this.confirming = false;
      this.cancelButton?.setDisabled(false);
      this.confirmButton?.setDisabled(false);
    }
  }
}
