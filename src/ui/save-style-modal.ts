import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
} from '../settings/plugin-settings';

export interface SaveStyleModalOptions {
  existingLabels: readonly string[];
  initialLabel?: string;
  onSave: (result: { description: string; label: string }) => Promise<void> | void;
  reachedMaxCount: boolean;
}

export class SaveStyleModal extends Modal {
  private descriptionInput: HTMLTextAreaElement | null = null;
  private errorEl: HTMLElement | null = null;
  private labelInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private readonly options: SaveStyleModalOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText('Save writing style');
    this.contentEl.empty();

    if (this.options.reachedMaxCount) {
      this.contentEl.createEl('p', {
        cls: 'local-stt-save-style__error',
        text: `You can save up to ${LLM_USER_PRESET_MAX_COUNT} writing styles. Delete one before saving a new style.`,
      });
      new Setting(this.contentEl).addButton((button) => {
        button.setButtonText('Close').onClick(() => {
          this.close();
        });
      });
      return;
    }

    this.contentEl.createEl('p', {
      text: 'Save the current prompt as a reusable writing style. The Ollama model and other settings are not included.',
    });

    new Setting(this.contentEl).setName('Name').addText((text) => {
      text.setPlaceholder('e.g. Meeting notes');
      text.setValue(this.options.initialLabel ?? '');
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_LABEL_CHARS;
      this.labelInput = text.inputEl;
    });

    new Setting(this.contentEl).setName('Description (optional)').addTextArea((text) => {
      text.setPlaceholder('When to use this style');
      text.inputEl.rows = 3;
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_DESCRIPTION_CHARS;
      this.descriptionInput = text.inputEl;
    });

    this.errorEl = this.contentEl.createEl('p', { cls: 'local-stt-save-style__error' });
    this.errorEl.style.display = 'none';

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setCta()
          .setButtonText('Save')
          .onClick(() => {
            void this.handleSave();
          });
      });

    this.labelInput?.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.descriptionInput = null;
    this.errorEl = null;
    this.labelInput = null;
  }

  private async handleSave(): Promise<void> {
    const label = (this.labelInput?.value ?? '').trim();
    const description = (this.descriptionInput?.value ?? '').trim();

    if (label.length === 0) {
      this.showError('Enter a name for this style.');
      return;
    }

    const duplicate = this.options.existingLabels.some(
      (existing) => existing.toLowerCase() === label.toLowerCase(),
    );
    if (duplicate) {
      this.showError('A writing style with that name already exists.');
      return;
    }

    try {
      await this.options.onSave({ description, label });
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the style.';
      this.showError(message);
    }
  }

  private showError(message: string): void {
    if (this.errorEl === null) return;
    this.errorEl.setText(message);
    this.errorEl.style.display = '';
  }
}
