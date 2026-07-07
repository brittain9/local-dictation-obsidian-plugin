import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  DEFAULT_PLUGIN_SETTINGS,
  MAX_SMART_PARAGRAPH_PAUSE_MS,
  MIN_SMART_PARAGRAPH_PAUSE_MS,
  normalizeSmartParagraphPauseSettings,
  type PluginSettings,
  type SmartParagraphPauseSettings,
} from './plugin-settings';

interface SmartParagraphSettingsModalDependencies {
  getSettings: () => PluginSettings;
  onSave?: () => void;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

const MIN_PAUSE_SECONDS = MIN_SMART_PARAGRAPH_PAUSE_MS / 1000;
const MAX_PAUSE_SECONDS = MAX_SMART_PARAGRAPH_PAUSE_MS / 1000;

export class SmartParagraphSettingsModal extends Modal {
  private draft: SmartParagraphPauseSettings;

  constructor(
    app: App,
    private readonly deps: SmartParagraphSettingsModalDependencies,
  ) {
    super(app);
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

    this.addSecondsSetting({
      desc: `Seconds before a single line break (${MIN_PAUSE_SECONDS}-${MAX_PAUSE_SECONDS}).`,
      name: 'Line break pause',
      onChange: (value) => {
        this.draft = { ...this.draft, lineBreakPauseMs: value };
      },
      value: this.draft.lineBreakPauseMs,
    });

    this.addSecondsSetting({
      desc: `Seconds before a paragraph break (${MIN_PAUSE_SECONDS}-${MAX_PAUSE_SECONDS}).`,
      name: 'Paragraph pause',
      onChange: (value) => {
        this.draft = { ...this.draft, paragraphPauseMs: value };
      },
      value: this.draft.paragraphPauseMs,
    });

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText('Reset').onClick(() => {
          this.draft = {
            lineBreakPauseMs: DEFAULT_PLUGIN_SETTINGS.smartParagraphLineBreakPauseMs,
            paragraphPauseMs: DEFAULT_PLUGIN_SETTINGS.smartParagraphParagraphPauseMs,
          };
          this.render();
        });
      })
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
  }

  private addSecondsSetting(options: {
    desc: string;
    name: string;
    onChange: (value: number) => void;
    value: number;
  }): void {
    new Setting(this.contentEl)
      .setName(options.name)
      .setDesc(options.desc)
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = String(MIN_PAUSE_SECONDS);
        text.inputEl.max = String(MAX_PAUSE_SECONDS);
        text.inputEl.step = '0.1';
        text.setValue(formatSeconds(options.value));
        text.onChange((value) => {
          const pauseMs = parseSecondsToMs(value);
          if (pauseMs === null) return;
          options.onChange(pauseMs);
        });
      });
  }

  private async handleSave(): Promise<void> {
    const normalized = normalizeSmartParagraphPauseSettings(this.draft);

    await this.deps.saveSettings({
      ...this.deps.getSettings(),
      smartParagraphLineBreakPauseMs: normalized.lineBreakPauseMs,
      smartParagraphParagraphPauseMs: normalized.paragraphPauseMs,
    });
    this.deps.onSave?.();
    this.close();
  }
}

function draftFromSettings(settings: PluginSettings): SmartParagraphPauseSettings {
  return {
    lineBreakPauseMs: settings.smartParagraphLineBreakPauseMs,
    paragraphPauseMs: settings.smartParagraphParagraphPauseMs,
  };
}

function parseSecondsToMs(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds)) {
    return null;
  }

  return Math.round(seconds * 1000);
}

function formatSeconds(milliseconds: number): string {
  return (milliseconds / 1000).toString();
}
