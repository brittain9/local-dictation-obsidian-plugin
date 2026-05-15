import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import type { LlmPresetMode } from '../llm/presets';
import {
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
} from '../settings/plugin-settings';

const MODE_ANY = '__any__';

const MODE_OPTIONS: ReadonlyArray<{ label: string; value: LlmPresetMode | typeof MODE_ANY }> = [
  { label: 'Any mode (use current cleanup mode)', value: MODE_ANY },
  { label: 'After each phrase', value: 'per_utterance' },
  { label: 'All at once on stop', value: 'batch' },
];

export interface SaveStyleModalOptions {
  existingLabels: readonly string[];
  initialLabel?: string;
  onSave: (result: {
    description: string;
    label: string;
    mode: LlmPresetMode | null;
  }) => Promise<void> | void;
  reachedMaxCount: boolean;
}

export class SaveStyleModal extends Modal {
  private descriptionInput: HTMLTextAreaElement | null = null;
  private errorEl: HTMLElement | null = null;
  private labelInput: HTMLInputElement | null = null;
  private mode: LlmPresetMode | null = null;

  constructor(
    app: App,
    private readonly options: SaveStyleModalOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText('Save preset');
    this.contentEl.empty();

    if (this.options.reachedMaxCount) {
      this.contentEl.createEl('p', {
        cls: 'local-stt-save-style__error',
        text: `You can save up to ${LLM_USER_PRESET_MAX_COUNT} presets. Delete one before saving a new preset.`,
      });
      new Setting(this.contentEl).addButton((button) => {
        button.setButtonText('Close').onClick(() => {
          this.close();
        });
      });
      return;
    }

    this.contentEl.createEl('p', {
      text: 'Save the current prompt as a reusable preset. The Ollama model and other settings are not included.',
    });

    new Setting(this.contentEl).setName('Name').addText((text) => {
      text.setPlaceholder('e.g. Meeting notes');
      text.setValue(this.options.initialLabel ?? '');
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_LABEL_CHARS;
      this.labelInput = text.inputEl;
    });

    new Setting(this.contentEl).setName('Description (optional)').addTextArea((text) => {
      text.setPlaceholder('When to use this preset');
      text.inputEl.rows = 3;
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_DESCRIPTION_CHARS;
      this.descriptionInput = text.inputEl;
    });

    new Setting(this.contentEl)
      .setName('Cleanup mode')
      .setDesc(
        'Switch to this mode when the preset is picked. Choose Any to keep the current mode.',
      )
      .addDropdown((dropdown) => {
        for (const option of MODE_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(MODE_ANY);
        dropdown.onChange((value) => {
          this.mode = value === MODE_ANY ? null : (value as LlmPresetMode);
        });
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
    this.mode = null;
  }

  private async handleSave(): Promise<void> {
    const label = (this.labelInput?.value ?? '').trim();
    const description = (this.descriptionInput?.value ?? '').trim();

    if (label.length === 0) {
      this.showError('Enter a name for this preset.');
      return;
    }

    const duplicate = this.options.existingLabels.some(
      (existing) => existing.toLowerCase() === label.toLowerCase(),
    );
    if (duplicate) {
      this.showError('A preset with that name already exists.');
      return;
    }

    try {
      await this.options.onSave({ description, label, mode: this.mode });
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the preset.';
      this.showError(message);
    }
  }

  private showError(message: string): void {
    if (this.errorEl === null) return;
    this.errorEl.setText(message);
    this.errorEl.style.display = '';
  }
}
