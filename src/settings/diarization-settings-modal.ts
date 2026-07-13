import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  DEFAULT_PLUGIN_SETTINGS,
  MAX_DIARIZATION_MAX_SPEAKERS,
  MIN_DIARIZATION_MAX_SPEAKERS,
  type PluginSettings,
} from './plugin-settings';

interface DiarizationSettingsModalDependencies {
  getSettings: () => PluginSettings;
  onSave?: () => void;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

export class DiarizationSettingsModal extends Modal {
  private maxSpeakers: number | null;

  constructor(
    app: App,
    private readonly deps: DiarizationSettingsModalDependencies,
  ) {
    super(app);
    this.maxSpeakers = deps.getSettings().diarizationMaxSpeakers;
  }

  override onOpen(): void {
    this.titleEl.setText('Speaker label settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();

    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Speaker labels run on-device after each voice-detected phrase. They require a batch transcription model.',
    });

    new Setting(this.contentEl)
      .setName('Maximum speakers')
      .setDesc(
        'Automatic determines the speaker count. Set a limit only if extra speaker labels appear.',
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('auto', 'Automatic');
        for (
          let count = MIN_DIARIZATION_MAX_SPEAKERS;
          count <= MAX_DIARIZATION_MAX_SPEAKERS;
          count += 1
        ) {
          dropdown.addOption(String(count), String(count));
        }
        dropdown.setValue(this.maxSpeakers?.toString() ?? 'auto');
        dropdown.onChange((value) => {
          if (value === 'auto') {
            this.maxSpeakers = null;
            return;
          }

          const parsed = Number(value);
          if (
            Number.isInteger(parsed) &&
            parsed >= MIN_DIARIZATION_MAX_SPEAKERS &&
            parsed <= MAX_DIARIZATION_MAX_SPEAKERS
          ) {
            this.maxSpeakers = parsed;
          }
        });
      });

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText('Reset').onClick(() => {
          this.maxSpeakers = DEFAULT_PLUGIN_SETTINGS.diarizationMaxSpeakers;
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

  private async handleSave(): Promise<void> {
    await this.deps.saveSettings({
      ...this.deps.getSettings(),
      diarizationMaxSpeakers: this.maxSpeakers,
    });
    this.deps.onSave?.();
    this.close();
  }
}
