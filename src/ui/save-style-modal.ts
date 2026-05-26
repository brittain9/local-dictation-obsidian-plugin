import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import type { LlmPresetMode } from '../llm/presets';
import {
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
} from '../settings/plugin-settings';

interface ModeOption {
  key: string;
  label: string;
  mode: LlmPresetMode | null;
}

const DEFAULT_MODE_KEY = 'any';

const MODE_OPTIONS: readonly ModeOption[] = [
  { key: DEFAULT_MODE_KEY, label: 'Any mode (use current mode)', mode: null },
  { key: 'per_utterance', label: 'After each phrase', mode: 'per_utterance' },
  { key: 'batch', label: 'All at once on stop', mode: 'batch' },
];

export interface SaveStyleModalDefaults {
  minWords: number;
  temperature: number;
}

export interface SaveStyleModalResult {
  description: string;
  label: string;
  minWords: number | null;
  mode: LlmPresetMode | null;
  temperature: number | null;
}

export interface SaveStyleModalOptions {
  defaults: SaveStyleModalDefaults;
  existingLabels: readonly string[];
  initialLabel?: string;
  onSave: (result: SaveStyleModalResult) => Promise<void> | void;
  reachedMaxCount: boolean;
}

export class SaveStyleModal extends Modal {
  private descriptionInput: HTMLTextAreaElement | null = null;
  private errorEl: HTMLElement | null = null;
  private labelInput: HTMLInputElement | null = null;
  private minWordsInput: HTMLInputElement | null = null;
  private mode: LlmPresetMode | null = null;
  private overrideContainer: HTMLDivElement | null = null;
  private overrideEnabled = false;
  private temperatureInput: HTMLInputElement | null = null;

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
      text: 'Save the current prompt as a reusable preset. The provider, model, and other settings are not included.',
    });

    new Setting(this.contentEl).setName('Name').addText((text) => {
      text.setPlaceholder('e.g. Meeting notes');
      text.setValue(this.options.initialLabel ?? '');
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_LABEL_CHARS;
      text.inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void this.handleSave();
        }
      });
      this.labelInput = text.inputEl;
    });

    new Setting(this.contentEl).setName('Description (optional)').addTextArea((text) => {
      text.setPlaceholder('When to use this preset');
      text.inputEl.rows = 3;
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_DESCRIPTION_CHARS;
      this.descriptionInput = text.inputEl;
    });

    new Setting(this.contentEl)
      .setName('Mode')
      .setDesc(
        'Switch to this mode when the preset is picked. Choose Any to keep the current mode.',
      )
      .addDropdown((dropdown) => {
        for (const option of MODE_OPTIONS) {
          dropdown.addOption(option.key, option.label);
        }
        dropdown.setValue(DEFAULT_MODE_KEY);
        dropdown.onChange((value) => {
          this.mode = MODE_OPTIONS.find((option) => option.key === value)?.mode ?? null;
        });
      });

    new Setting(this.contentEl)
      .setName('Override min words and temperature')
      .setDesc(
        'When on, this preset uses its own min words and temperature instead of the global Advanced values.',
      )
      .addToggle((toggle) => {
        toggle.setValue(false);
        toggle.onChange((value) => {
          this.overrideEnabled = value;
          this.overrideContainer?.toggleClass('local-stt-hidden', !value);
        });
      });

    this.overrideContainer = this.contentEl.createDiv({ cls: 'local-stt-hidden' });

    new Setting(this.overrideContainer)
      .setName('Min words')
      .setDesc('Skip the LLM transform when the utterance has fewer words than this.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '50';
        text.setValue(String(this.options.defaults.minWords));
        this.minWordsInput = text.inputEl;
      });

    new Setting(this.overrideContainer)
      .setName('Temperature')
      .setDesc('Sampling randomness. 0 is deterministic; higher is more varied.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '2';
        text.inputEl.step = '0.05';
        text.setValue(String(this.options.defaults.temperature));
        this.temperatureInput = text.inputEl;
      });

    this.errorEl = this.contentEl.createEl('p', {
      cls: 'local-stt-save-style__error local-stt-hidden',
    });
    this.errorEl.setAttribute('role', 'alert');
    this.errorEl.setAttribute('aria-live', 'polite');

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
    this.minWordsInput = null;
    this.mode = null;
    this.overrideContainer = null;
    this.overrideEnabled = false;
    this.temperatureInput = null;
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

    let minWords: number | null = null;
    let temperature: number | null = null;
    if (this.overrideEnabled) {
      const parsedMinWords = this.parseInteger(this.minWordsInput?.value, 0, 50);
      if (parsedMinWords === null) {
        this.showError('Min words must be a whole number between 0 and 50.');
        return;
      }
      const parsedTemperature = this.parseNumber(this.temperatureInput?.value, 0, 2);
      if (parsedTemperature === null) {
        this.showError('Temperature must be a number between 0 and 2.');
        return;
      }
      minWords = parsedMinWords;
      temperature = parsedTemperature;
    }

    try {
      await this.options.onSave({
        description,
        label,
        minWords,
        mode: this.mode,
        temperature,
      });
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the preset.';
      this.showError(message);
    }
  }

  private parseInteger(value: string | undefined, min: number, max: number): number | null {
    if (value === undefined || value.trim() === '') return null;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
    return parsed;
  }

  private parseNumber(value: string | undefined, min: number, max: number): number | null {
    if (value === undefined || value.trim() === '') return null;
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
    return parsed;
  }

  private showError(message: string): void {
    if (this.errorEl === null) return;
    this.errorEl.setText(message);
    this.errorEl.removeClass('local-stt-hidden');
  }
}
