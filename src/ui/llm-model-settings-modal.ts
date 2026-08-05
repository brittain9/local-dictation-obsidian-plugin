import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  ModalSettingsAutoSaver,
  type ModalSettingsPersistence,
} from '../settings/modal-settings-auto-saver';
import {
  DEFAULT_PLUGIN_SETTINGS,
  LLM_TEMPERATURE_MAX,
  MAX_LLM_NETWORK_TIMEOUT_SEC,
  MIN_LLM_NETWORK_TIMEOUT_SEC,
  type PluginSettings,
} from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import { resolveModelSettingsPresentation } from './llm-model-settings-presentation';
import { addValidatedNumberSetting } from './validated-number-setting';

type LlmModelSettingsModalDependencies = ModalSettingsPersistence;

interface ModelDraft {
  llmNetworkTimeoutSec: number;
  llmPostprocessTemperature: number;
}

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
    this.setTitle(t('llm.model.title'));
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
          ? t('llm.model.temperature.description')
          : t('llm.managedByPreset', { preset: presentation.temperature.presetLabel }),
      disabled: presentation.temperature.presetLabel !== null,
      max: LLM_TEMPERATURE_MAX,
      min: 0,
      name: t('llm.model.temperature.name'),
      step: 0.1,
      value:
        presentation.temperature.presetLabel !== null
          ? presentation.temperature.value
          : this.draft.llmPostprocessTemperature,
    });

    if (presentation.networkTimeoutSec !== null) {
      this.addNumberField('llmNetworkTimeoutSec', {
        desc: t('llm.model.networkTimeout.description'),
        integer: true,
        max: MAX_LLM_NETWORK_TIMEOUT_SEC,
        min: MIN_LLM_NETWORK_TIMEOUT_SEC,
        name: t('llm.model.networkTimeout.name'),
      });
    }

    new Setting(this.contentEl).addButton((button) => {
      button.setButtonText(t('common.reset')).onClick(async () => {
        this.draft = {
          llmNetworkTimeoutSec: DEFAULT_PLUGIN_SETTINGS.llmNetworkTimeoutSec,
          llmPostprocessTemperature: DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature,
        };
        this.render();
        await this.autoSaver.persist({
          llmNetworkTimeoutSec: this.draft.llmNetworkTimeoutSec,
          llmPostprocessTemperature: this.draft.llmPostprocessTemperature,
        });
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
        void this.persistField(key, value);
      },
      value: options.value ?? this.draft[key],
    });
  }

  private persistField(key: ModelField, value: number): Promise<void> {
    if (key === 'llmNetworkTimeoutSec') {
      return this.autoSaver.persist({ llmNetworkTimeoutSec: value });
    }
    return this.autoSaver.persist({ llmPostprocessTemperature: value });
  }
}

function draftFromSettings(settings: PluginSettings): ModelDraft {
  return {
    llmNetworkTimeoutSec: settings.llmNetworkTimeoutSec,
    llmPostprocessTemperature: settings.llmPostprocessTemperature,
  };
}
