import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  ModalSettingsAutoSaver,
  type ModalSettingsPersistence,
} from '../settings/modal-settings-auto-saver';
import {
  DEFAULT_PLUGIN_SETTINGS,
  LLM_NOTE_CONTEXT_CHARS_MAX,
  LLM_PRIOR_UTTERANCES_MAX,
  LLM_TOTAL_CONTEXT_CAP_MAX,
  type PluginSettings,
} from '../settings/plugin-settings';
import { resolveEffectiveTransformTiming } from './llm-preset-overrides';
import { addValidatedNumberSetting } from './validated-number-setting';

type LlmContextSettingsModalDependencies = ModalSettingsPersistence;

type ContextDraft = Pick<
  PluginSettings,
  | 'llmPostprocessNoteContextChars'
  | 'llmPostprocessPriorUtterancesN'
  | 'llmPostprocessTotalContextCap'
>;

type ContextField = keyof ContextDraft;

export class LlmContextSettingsModal extends Modal {
  private readonly autoSaver: ModalSettingsAutoSaver;
  private draft: ContextDraft;

  constructor(
    app: App,
    private readonly dependencies: LlmContextSettingsModalDependencies,
  ) {
    super(app);
    this.autoSaver = new ModalSettingsAutoSaver(dependencies);
    this.draft = draftFromSettings(dependencies.getSettings());
  }

  override onOpen(): void {
    this.titleEl.setText('Context settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();

    const afterEachPhrase =
      resolveEffectiveTransformTiming(this.dependencies.getSettings()) === 'per_utterance';
    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'More context can improve terminology, but may increase local latency or OpenRouter cost.',
    });

    this.addNumberField('llmPostprocessNoteContextChars', {
      desc: 'Maximum characters taken from the current note above the cursor.',
      integer: true,
      max: LLM_NOTE_CONTEXT_CHARS_MAX,
      min: 0,
      name: 'Note context length',
    });
    this.addNumberField('llmPostprocessPriorUtterancesN', {
      desc: afterEachPhrase
        ? 'Recent dictated phrases included as conversation history.'
        : 'Used only when Run transform is set to After each phrase.',
      disabled: !afterEachPhrase,
      integer: true,
      max: LLM_PRIOR_UTTERANCES_MAX,
      min: 0,
      name: 'Previous phrases',
    });
    this.addNumberField('llmPostprocessTotalContextCap', {
      desc: afterEachPhrase
        ? 'Maximum combined characters from note context and previous phrases.'
        : 'Used only when Run transform is set to After each phrase.',
      disabled: !afterEachPhrase,
      integer: true,
      max: LLM_TOTAL_CONTEXT_CAP_MAX,
      min: 0,
      name: 'Context limit',
    });

    new Setting(this.contentEl).addButton((button) => {
      button.setButtonText('Reset').onClick(async () => {
        this.draft = draftFromSettings(DEFAULT_PLUGIN_SETTINGS);
        this.render();
        await this.autoSaver.persist(this.draft);
      });
    });
  }

  private addNumberField(
    key: ContextField,
    options: {
      desc: string;
      disabled?: boolean;
      integer?: boolean;
      max: number;
      min: number;
      name: string;
      step?: number;
    },
  ): void {
    addValidatedNumberSetting(this.contentEl, {
      ...options,
      onChange: (value) => {
        this.draft = { ...this.draft, [key]: value };
        void this.autoSaver.persist({ [key]: value });
      },
      value: this.draft[key],
    });
  }
}

function draftFromSettings(settings: PluginSettings): ContextDraft {
  return {
    llmPostprocessNoteContextChars: settings.llmPostprocessNoteContextChars,
    llmPostprocessPriorUtterancesN: settings.llmPostprocessPriorUtterancesN,
    llmPostprocessTotalContextCap: settings.llmPostprocessTotalContextCap,
  };
}
