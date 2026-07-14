import type { App, ButtonComponent, TextComponent } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import {
  DEFAULT_PLUGIN_SETTINGS,
  isTimestampClock,
  isTimestampDensity,
  MAX_TIMESTAMP_SPARSE_INTERVAL_MS,
  MIN_TIMESTAMP_SPARSE_INTERVAL_MS,
  type PluginSettings,
  type TimestampClock,
  type TimestampDensity,
  validateTimestampIntervalSeconds,
} from './plugin-settings';
import type { DropdownOption } from './setting-helpers';

interface TimestampSettingsModalDependencies {
  getSettings: () => PluginSettings;
  onSave?: () => void;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

interface TimestampSettingsDraft {
  clock: TimestampClock;
  density: TimestampDensity;
  sessionHeader: boolean;
  sparseIntervalSeconds: string;
}

const TIMESTAMP_CLOCK_OPTIONS: ReadonlyArray<DropdownOption<TimestampClock>> = [
  { label: 'Elapsed', value: 'elapsed' },
  { label: 'Wall clock', value: 'wallclock' },
];

const TIMESTAMP_DENSITY_OPTIONS: ReadonlyArray<DropdownOption<TimestampDensity>> = [
  { label: 'At intervals', value: 'sparse' },
  { label: 'Every phrase', value: 'every_utterance' },
  { label: 'At paragraph breaks', value: 'paragraph' },
];

const MIN_INTERVAL_SECONDS = MIN_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
const MAX_INTERVAL_SECONDS = MAX_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
const INTERVAL_DESCRIPTION = `Seconds between timestamp landmarks (${MIN_INTERVAL_SECONDS}-${MAX_INTERVAL_SECONDS}).`;
let nextIntervalDescriptionId = 0;

export class TimestampSettingsModal extends Modal {
  private draft: TimestampSettingsDraft;
  private readonly intervalDescriptionId =
    `local-dictation-timestamp-interval-description-${++nextIntervalDescriptionId}`;
  private intervalInput: TextComponent | null = null;
  private intervalSetting: Setting | null = null;
  private frequencySetting: Setting | null = null;
  private saveButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private readonly deps: TimestampSettingsModalDependencies,
  ) {
    super(app);
    this.draft = draftFromSettings(deps.getSettings());
  }

  override onOpen(): void {
    this.titleEl.setText('Timestamp settings');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.intervalInput = null;
    this.intervalSetting = null;
    this.frequencySetting = null;
    this.saveButton = null;
  }

  private render(): void {
    this.contentEl.empty();
    this.intervalInput = null;
    this.intervalSetting = null;
    this.frequencySetting = null;
    this.saveButton = null;

    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Choose landmarks at intervals, phrase boundaries, or Smart paragraph breaks.',
    });

    new Setting(this.contentEl)
      .setName('Session header')
      .setDesc('Start each timestamped session with [YYYY-MM-DD HH:MM].')
      .addToggle((toggle) => {
        toggle.setValue(this.draft.sessionHeader);
        toggle.onChange((value) => {
          this.draft = { ...this.draft, sessionHeader: value };
        });
      });

    new Setting(this.contentEl)
      .setName('Reference clock')
      .setDesc('Elapsed time since dictation started, or local wall-clock time.')
      .addDropdown((dropdown) => {
        for (const option of TIMESTAMP_CLOCK_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(this.draft.clock);
        dropdown.onChange((value) => {
          if (!isTimestampClock(value)) return;
          this.draft = { ...this.draft, clock: value };
        });
      });

    this.frequencySetting = new Setting(this.contentEl)
      .setName('Frequency')
      .setDesc('Choose how often timestamps appear.')
      .addDropdown((dropdown) => {
        for (const option of TIMESTAMP_DENSITY_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(this.draft.density);
        dropdown.onChange((value) => {
          if (!isTimestampDensity(value)) return;
          this.draft = { ...this.draft, density: value };
          this.refreshIntervalState();
        });
      });

    this.intervalSetting = new Setting(this.contentEl)
      .setName('Interval')
      .setDesc(INTERVAL_DESCRIPTION)
      .addText((text) => {
        this.intervalInput = text;
        text.inputEl.type = 'number';
        text.inputEl.min = String(MIN_INTERVAL_SECONDS);
        text.inputEl.max = String(MAX_INTERVAL_SECONDS);
        text.inputEl.step = '1';
        text.inputEl.setAttribute('aria-label', 'Interval');
        text.inputEl.setAttribute('aria-describedby', this.intervalDescriptionId);
        text.setValue(this.draft.sparseIntervalSeconds);
        text.onChange((value) => {
          this.draft = { ...this.draft, sparseIntervalSeconds: value };
          this.refreshIntervalState();
        });
      });
    this.intervalSetting.descEl.id = this.intervalDescriptionId;
    this.intervalSetting.descEl.setAttribute('aria-live', 'polite');

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText('Reset').onClick(() => {
          this.draft = draftFromSettings(DEFAULT_PLUGIN_SETTINGS);
          this.render();
        });
      })
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

    this.refreshIntervalState();
  }

  private refreshIntervalState(): void {
    const intervalIsActive = this.draft.density === 'sparse';
    const validation = validateTimestampIntervalSeconds(this.draft.sparseIntervalSeconds);
    const paragraphFormattingUnavailable =
      this.draft.density === 'paragraph' &&
      this.deps.getSettings().transcriptFormatting !== 'smart';

    this.frequencySetting?.setDesc(
      this.draft.density === 'sparse'
        ? 'Add readable landmarks at the configured interval.'
        : this.draft.density === 'every_utterance'
          ? 'Add a timestamp before each model-timed segment when available, otherwise at each voice-detected phrase.'
          : paragraphFormattingUnavailable
            ? 'Requires Smart paragraphs formatting.'
            : 'Add a timestamp at the start of the session and at each Smart paragraph break.',
    );
    this.frequencySetting?.descEl.toggleClass(
      'local-dictation-status--warning',
      paragraphFormattingUnavailable,
    );

    this.intervalInput?.setDisabled(!intervalIsActive);
    this.intervalInput?.inputEl.setCustomValidity(
      intervalIsActive && !validation.valid ? validation.message : '',
    );
    this.intervalInput?.inputEl.toggleAttribute(
      'aria-invalid',
      intervalIsActive && !validation.valid,
    );
    this.intervalSetting?.setDesc(
      intervalIsActive && !validation.valid
        ? validation.message
        : intervalIsActive
          ? INTERVAL_DESCRIPTION
          : 'Used only when frequency is set to At intervals.',
    );
    this.saveButton?.setDisabled(intervalIsActive && !validation.valid);
  }

  private async handleSave(): Promise<void> {
    const currentSettings = this.deps.getSettings();
    const interval = validateTimestampIntervalSeconds(this.draft.sparseIntervalSeconds);
    if (this.draft.density === 'sparse' && !interval.valid) {
      this.refreshIntervalState();
      return;
    }

    await this.deps.saveSettings({
      ...currentSettings,
      timestampClock: this.draft.clock,
      timestampDensity: this.draft.density,
      timestampSessionHeader: this.draft.sessionHeader,
      timestampSparseIntervalMs: interval.valid
        ? interval.milliseconds
        : currentSettings.timestampSparseIntervalMs,
    });
    this.deps.onSave?.();
    this.close();
  }
}

function draftFromSettings(settings: PluginSettings): TimestampSettingsDraft {
  return {
    clock: settings.timestampClock,
    density: settings.timestampDensity,
    sessionHeader: settings.timestampSessionHeader,
    sparseIntervalSeconds: String(Math.round(settings.timestampSparseIntervalMs / 1000)),
  };
}
