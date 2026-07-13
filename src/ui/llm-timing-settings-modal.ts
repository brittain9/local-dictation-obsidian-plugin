import type { App, ButtonComponent } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { LLM_MIN_WORDS_MAX, type PluginSettings } from '../settings/plugin-settings';
import { activePresetOverride, resolveEffectiveTransformTiming } from './llm-preset-overrides';
import { addValidatedNumberSetting } from './validated-number-setting';

interface LlmTimingSettingsModalDependencies {
  getSettings: () => PluginSettings;
  onSave?: () => void;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

export class LlmTimingSettingsModal extends Modal {
  private invalid = false;
  private minimumWords: number;
  private saveButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private readonly dependencies: LlmTimingSettingsModalDependencies,
  ) {
    super(app);
    this.minimumWords = dependencies.getSettings().llmPostprocessSkipMinWords;
  }

  override onOpen(): void {
    this.titleEl.setText('Timing settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.invalid = false;
    this.saveButton = null;
  }

  private render(): void {
    this.contentEl.empty();
    this.invalid = false;
    this.saveButton = null;

    const settings = this.dependencies.getSettings();
    const effectiveTiming = resolveEffectiveTransformTiming(settings);
    if (settings.timestampsEnabled) {
      this.contentEl.createEl('p', {
        cls: 'setting-item-description',
        text:
          effectiveTiming === 'per_utterance'
            ? 'After each phrase preserves timestamp boundaries.'
            : 'All at once may rewrite or remove timestamps, depending on the preset.',
      });
    }

    const override = activePresetOverride(settings, 'minWords');
    addValidatedNumberSetting(this.contentEl, {
      desc:
        override === null
          ? 'Skip the transform when the transcript has fewer words than this.'
          : `Managed by “${override.label}”. Edit that preset to change this value.`,
      disabled: override !== null,
      integer: true,
      max: LLM_MIN_WORDS_MAX,
      min: 0,
      name: 'Minimum words',
      onChange: (value) => {
        this.minimumWords = value;
      },
      onValidityChange: (valid) => {
        this.invalid = !valid;
        this.saveButton?.setDisabled(this.invalid);
      },
      value: typeof override?.value === 'number' ? override.value : this.minimumWords,
    });

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.saveButton = button;
        button
          .setCta()
          .setButtonText('Save')
          .onClick(() => {
            void this.handleSave();
          });
      });
  }

  private async handleSave(): Promise<void> {
    if (this.invalid) {
      return;
    }
    await this.dependencies.saveSettings({
      ...this.dependencies.getSettings(),
      llmPostprocessSkipMinWords: this.minimumWords,
    });
    this.dependencies.onSave?.();
    this.close();
  }
}
