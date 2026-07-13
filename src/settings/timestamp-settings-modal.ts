import type { App, ButtonComponent, TextComponent } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import type { ModelFamilyCapabilitiesRecord } from '../models/model-management-types';
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
import { timestampCapabilityPresentation } from './timestamp-capability';

interface TimestampSettingsModalDependencies {
  getModelCapabilities: () => ModelFamilyCapabilitiesRecord | null;
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
];

const MIN_INTERVAL_SECONDS = MIN_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
const MAX_INTERVAL_SECONDS = MAX_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
const INTERVAL_DESCRIPTION = `Seconds between timestamp landmarks (${MIN_INTERVAL_SECONDS}-${MAX_INTERVAL_SECONDS}).`;

export class TimestampSettingsModal extends Modal {
  private draft: TimestampSettingsDraft;
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
      text: 'Interval and phrase timestamps work with every model. Detailed timing uses engine-provided words or segments when available and falls back safely to phrase timing.',
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

    const capability = timestampCapabilityPresentation(this.deps.getModelCapabilities());
    this.frequencySetting = new Setting(this.contentEl)
      .setName('Frequency')
      .setDesc('Choose how often timestamps appear.')
      .addDropdown((dropdown) => {
        for (const option of TIMESTAMP_DENSITY_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.addOption('detailed', capability.detailedOptionLabel);
        const detailedOption = [...dropdown.selectEl.options].find(
          (option) => option.value === 'detailed',
        );
        if (detailedOption !== undefined && capability.support === 'unavailable') {
          detailedOption.disabled = true;
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
        text.setValue(this.draft.sparseIntervalSeconds);
        text.onChange((value) => {
          this.draft = { ...this.draft, sparseIntervalSeconds: value };
          this.refreshIntervalState();
        });
      });

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
    const capability = timestampCapabilityPresentation(this.deps.getModelCapabilities());

    this.frequencySetting?.setDesc(
      this.draft.density === 'sparse'
        ? 'Add readable landmarks at the configured interval.'
        : this.draft.density === 'every_utterance'
          ? 'Add one timestamp at every voice-detected phrase boundary.'
          : capability.detailedDescription,
    );

    this.intervalInput?.setDisabled(!intervalIsActive);
    this.intervalInput?.inputEl.setCustomValidity(
      intervalIsActive && !validation.valid ? validation.message : '',
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
