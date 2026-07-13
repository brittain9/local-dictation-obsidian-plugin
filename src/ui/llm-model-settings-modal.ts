import type { App, ButtonComponent } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  LLM_TEMPERATURE_MAX,
  MAX_LLM_REMOTE_THRESHOLD_CHARS,
  MAX_LLM_REMOTE_TIMEOUT_SEC,
  MIN_LLM_REMOTE_THRESHOLD_CHARS,
  MIN_LLM_REMOTE_TIMEOUT_SEC,
  type PluginSettings,
} from '../settings/plugin-settings';
import { resolveModelSettingsPresentation } from './llm-model-settings-presentation';
import { addValidatedNumberSetting } from './validated-number-setting';

interface LlmModelSettingsModalDependencies {
  getSettings: () => PluginSettings;
  onSave?: () => void;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

type ModelDraft = Pick<
  PluginSettings,
  'llmPostprocessTemperature' | 'llmRemoteThresholdChars' | 'llmRemoteTimeoutSec'
>;

type ModelField = keyof ModelDraft;

export class LlmModelSettingsModal extends Modal {
  private draft: ModelDraft;
  private readonly invalidFields = new Set<ModelField>();
  private saveButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private readonly dependencies: LlmModelSettingsModalDependencies,
  ) {
    super(app);
    this.draft = draftFromSettings(dependencies.getSettings());
  }

  override onOpen(): void {
    this.titleEl.setText('Model settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.invalidFields.clear();
    this.saveButton = null;
  }

  private render(): void {
    this.contentEl.empty();
    this.invalidFields.clear();
    this.saveButton = null;

    const settings = this.dependencies.getSettings();
    const presentation = resolveModelSettingsPresentation(settings);
    this.addNumberField('llmPostprocessTemperature', {
      desc:
        presentation.temperature.presetLabel === null
          ? 'Sampling variation. 0 is deterministic; higher values are more varied.'
          : `Managed by “${presentation.temperature.presetLabel}”. Edit that preset to change this value.`,
      disabled: presentation.temperature.presetLabel !== null,
      max: LLM_TEMPERATURE_MAX,
      min: 0,
      name: 'Temperature',
      step: 0.1,
      value:
        presentation.temperature.presetLabel !== null
          ? presentation.temperature.value
          : this.draft.llmPostprocessTemperature,
    });

    if (presentation.remoteThresholdChars !== null) {
      this.addNumberField('llmRemoteThresholdChars', {
        desc: 'Transcript length that sends Auto transforms to OpenRouter (characters).',
        integer: true,
        max: MAX_LLM_REMOTE_THRESHOLD_CHARS,
        min: MIN_LLM_REMOTE_THRESHOLD_CHARS,
        name: 'Remote routing threshold',
      });
    }

    if (presentation.remoteTimeoutSec !== null) {
      this.addNumberField('llmRemoteTimeoutSec', {
        desc: 'Stop waiting for OpenRouter after this many seconds. The original transcript is kept.',
        integer: true,
        max: MAX_LLM_REMOTE_TIMEOUT_SEC,
        min: MIN_LLM_REMOTE_TIMEOUT_SEC,
        name: 'Remote timeout',
      });
    }

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

  private addNumberField(
    key: ModelField,
    options: {
      desc: string;
      disabled?: boolean;
      integer?: boolean;
      max: number;
      min: number;
      name: string;
      step?: number;
      value?: number;
    },
  ): void {
    addValidatedNumberSetting(this.contentEl, {
      ...options,
      onChange: (value) => {
        this.draft = { ...this.draft, [key]: value };
      },
      onValidityChange: (valid) => {
        if (valid) {
          this.invalidFields.delete(key);
        } else {
          this.invalidFields.add(key);
        }
        this.saveButton?.setDisabled(this.invalidFields.size > 0);
      },
      value: options.value ?? this.draft[key],
    });
  }

  private async handleSave(): Promise<void> {
    if (this.invalidFields.size > 0) {
      return;
    }
    await this.dependencies.saveSettings({
      ...this.dependencies.getSettings(),
      ...this.draft,
    });
    this.dependencies.onSave?.();
    this.close();
  }
}

function draftFromSettings(settings: PluginSettings): ModelDraft {
  return {
    llmPostprocessTemperature: settings.llmPostprocessTemperature,
    llmRemoteThresholdChars: settings.llmRemoteThresholdChars,
    llmRemoteTimeoutSec: settings.llmRemoteTimeoutSec,
  };
}
