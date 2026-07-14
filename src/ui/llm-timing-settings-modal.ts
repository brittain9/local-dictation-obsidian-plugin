import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  ModalSettingsAutoSaver,
  type ModalSettingsPersistence,
} from '../settings/modal-settings-auto-saver';
import { DEFAULT_PLUGIN_SETTINGS, LLM_MIN_WORDS_MAX } from '../settings/plugin-settings';
import { activePresetOverride } from './llm-preset-overrides';
import { describeTimestampTransformInteraction } from './llm-timing-settings-presentation';
import { addValidatedNumberSetting } from './validated-number-setting';

type LlmTimingSettingsModalDependencies = ModalSettingsPersistence;

export class LlmTimingSettingsModal extends Modal {
  private readonly autoSaver: ModalSettingsAutoSaver;
  private minimumWords: number;

  constructor(
    app: App,
    private readonly dependencies: LlmTimingSettingsModalDependencies,
  ) {
    super(app);
    this.autoSaver = new ModalSettingsAutoSaver(dependencies);
    this.minimumWords = dependencies.getSettings().llmPostprocessSkipMinWords;
  }

  override onOpen(): void {
    this.titleEl.setText('Timing settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();

    const settings = this.dependencies.getSettings();
    const timestampInteraction = describeTimestampTransformInteraction(settings);
    if (timestampInteraction !== null) {
      this.contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: timestampInteraction,
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
        void this.autoSaver.persist({ llmPostprocessSkipMinWords: value });
      },
      onValidityChange: () => {},
      value: typeof override?.value === 'number' ? override.value : this.minimumWords,
    });

    new Setting(this.contentEl).addButton((button) => {
      button.setButtonText('Reset').onClick(async () => {
        this.minimumWords = DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipMinWords;
        this.render();
        await this.autoSaver.persist({
          llmPostprocessSkipMinWords: DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipMinWords,
        });
      });
    });
  }
}
