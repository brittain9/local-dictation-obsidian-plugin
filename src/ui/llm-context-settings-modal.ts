import type { App, ButtonComponent } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  LLM_NOTE_CONTEXT_CHARS_MAX,
  LLM_PRIOR_UTTERANCES_MAX,
  LLM_TOTAL_CONTEXT_CAP_MAX,
  type PluginSettings,
} from '../settings/plugin-settings';
import { resolveEffectiveTransformTiming } from './llm-preset-overrides';
import { addValidatedNumberSetting } from './validated-number-setting';

interface LlmContextSettingsModalDependencies {
  getSettings: () => PluginSettings;
  onSave?: () => void;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

type ContextDraft = Pick<
  PluginSettings,
  | 'llmPostprocessNoteContextChars'
  | 'llmPostprocessPriorUtterancesN'
  | 'llmPostprocessTotalContextCap'
>;

type ContextField = keyof ContextDraft;

export class LlmContextSettingsModal extends Modal {
  private draft: ContextDraft;
  private readonly invalidFields = new Set<ContextField>();
  private saveButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private readonly dependencies: LlmContextSettingsModalDependencies,
  ) {
    super(app);
    this.draft = draftFromSettings(dependencies.getSettings());
  }

  override onOpen(): void {
    this.titleEl.setText('Context settings');
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
      },
      onValidityChange: (valid) => {
        if (valid) {
          this.invalidFields.delete(key);
        } else {
          this.invalidFields.add(key);
        }
        this.saveButton?.setDisabled(this.invalidFields.size > 0);
      },
      value: this.draft[key],
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

function draftFromSettings(settings: PluginSettings): ContextDraft {
  return {
    llmPostprocessNoteContextChars: settings.llmPostprocessNoteContextChars,
    llmPostprocessPriorUtterancesN: settings.llmPostprocessPriorUtterancesN,
    llmPostprocessTotalContextCap: settings.llmPostprocessTotalContextCap,
  };
}
