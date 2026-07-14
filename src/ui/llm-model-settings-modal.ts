import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  ModalSettingsAutoSaver,
  type ModalSettingsPersistence,
} from '../settings/modal-settings-auto-saver';
import {
  DEFAULT_PLUGIN_SETTINGS,
  LLM_TEMPERATURE_MAX,
  MAX_LLM_REMOTE_THRESHOLD_CHARS,
  MAX_LLM_REMOTE_TIMEOUT_SEC,
  MIN_LLM_REMOTE_THRESHOLD_CHARS,
  MIN_LLM_REMOTE_TIMEOUT_SEC,
  type PluginSettings,
} from '../settings/plugin-settings';
import { resolveModelSettingsPresentation } from './llm-model-settings-presentation';
import { addValidatedNumberSetting } from './validated-number-setting';

type LlmModelSettingsModalDependencies = ModalSettingsPersistence;

type ModelDraft = Pick<
  PluginSettings,
  'llmPostprocessTemperature' | 'llmRemoteThresholdChars' | 'llmRemoteTimeoutSec'
>;

type ModelField = keyof ModelDraft;

export class LlmModelSettingsModal extends Modal {
  private readonly autoSaver: ModalSettingsAutoSaver;
  private draft: ModelDraft;

  constructor(
    app: App,
    private readonly dependencies: LlmModelSettingsModalDependencies,
  ) {
    super(app);
    this.autoSaver = new ModalSettingsAutoSaver(dependencies);
    this.draft = draftFromSettings(dependencies.getSettings());
  }

  override onOpen(): void {
    this.titleEl.setText('Model settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();

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

    new Setting(this.contentEl).addButton((button) => {
      button.setButtonText('Reset').onClick(async () => {
        this.draft = draftFromSettings(DEFAULT_PLUGIN_SETTINGS);
        this.render();
        await this.autoSaver.persist(this.draft);
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
        void this.autoSaver.persist({ [key]: value });
      },
      value: options.value ?? this.draft[key],
    });
  }
}

function draftFromSettings(settings: PluginSettings): ModelDraft {
  return {
    llmPostprocessTemperature: settings.llmPostprocessTemperature,
    llmRemoteThresholdChars: settings.llmRemoteThresholdChars,
    llmRemoteTimeoutSec: settings.llmRemoteTimeoutSec,
  };
}
