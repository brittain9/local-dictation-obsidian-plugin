import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import { addValidatedNumberSetting } from '../ui/validated-number-setting';
import { ModalSettingsAutoSaver, type ModalSettingsPersistence } from './modal-settings-auto-saver';
import {
  DEFAULT_PLUGIN_SETTINGS,
  MAX_SMART_PARAGRAPH_PAUSE_MS,
  MIN_SMART_PARAGRAPH_PAUSE_MS,
  normalizeSmartParagraphPauseSettings,
  type PluginSettings,
  type SmartParagraphPauseSettings,
} from './plugin-settings';

type SmartParagraphSettingsModalDependencies = ModalSettingsPersistence;

const MIN_PAUSE_SECONDS = MIN_SMART_PARAGRAPH_PAUSE_MS / 1000;
const MAX_PAUSE_SECONDS = MAX_SMART_PARAGRAPH_PAUSE_MS / 1000;

export class SmartParagraphSettingsModal extends Modal {
  private readonly autoSaver: ModalSettingsAutoSaver;
  private draft: SmartParagraphPauseSettings;

  constructor(app: App, deps: SmartParagraphSettingsModalDependencies) {
    super(app);
    this.autoSaver = new ModalSettingsAutoSaver(deps);
    this.draft = draftFromSettings(deps.getSettings());
  }

  override onOpen(): void {
    this.titleEl.setText('Smart paragraph settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();

    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Smart paragraphs turn longer pauses into line or paragraph breaks. These values apply only when transcript formatting is set to Smart paragraphs.',
    });

    this.addSecondsSetting({
      desc: `Seconds before a single line break (${MIN_PAUSE_SECONDS}-${MAX_PAUSE_SECONDS}).`,
      name: 'Line break pause',
      onChange: (value) => {
        this.draft = { ...this.draft, lineBreakPauseMs: value };
        void this.persistDraft();
      },
      value: this.draft.lineBreakPauseMs,
    });

    this.addSecondsSetting({
      desc: `Seconds before a paragraph break (${MIN_PAUSE_SECONDS}-${MAX_PAUSE_SECONDS}).`,
      name: 'Paragraph pause',
      onChange: (value) => {
        this.draft = { ...this.draft, paragraphPauseMs: value };
        void this.persistDraft();
      },
      value: this.draft.paragraphPauseMs,
    });

    new Setting(this.contentEl).addButton((button) => {
      button.setButtonText('Reset').onClick(async () => {
        this.draft = {
          lineBreakPauseMs: DEFAULT_PLUGIN_SETTINGS.smartParagraphLineBreakPauseMs,
          paragraphPauseMs: DEFAULT_PLUGIN_SETTINGS.smartParagraphParagraphPauseMs,
        };
        this.render();
        await this.persistDraft();
      });
    });
  }

  private addSecondsSetting(options: {
    desc: string;
    name: string;
    onChange: (value: number) => void;
    value: number;
  }): void {
    addValidatedNumberSetting(this.contentEl, {
      desc: options.desc,
      max: MAX_PAUSE_SECONDS,
      min: MIN_PAUSE_SECONDS,
      name: options.name,
      onChange: (value) => {
        options.onChange(Math.round(value * 1000));
      },
      onValidityChange: () => {},
      step: 0.1,
      value: options.value / 1000,
    });
  }

  private persistDraft(): Promise<void> {
    const normalized = normalizeSmartParagraphPauseSettings(this.draft);

    return this.autoSaver.persist({
      smartParagraphLineBreakPauseMs: normalized.lineBreakPauseMs,
      smartParagraphParagraphPauseMs: normalized.paragraphPauseMs,
    });
  }
}

function draftFromSettings(settings: PluginSettings): SmartParagraphPauseSettings {
  return {
    lineBreakPauseMs: settings.smartParagraphLineBreakPauseMs,
    paragraphPauseMs: settings.smartParagraphParagraphPauseMs,
  };
}
