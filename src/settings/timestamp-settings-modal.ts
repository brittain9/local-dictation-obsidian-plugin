import type { App, TextComponent } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import { t } from '../shared/i18n';
import { ModalSettingsAutoSaver, type ModalSettingsPersistence } from './modal-settings-auto-saver';
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

type TimestampSettingsModalDependencies = ModalSettingsPersistence;

interface TimestampSettingsDraft {
  clock: TimestampClock;
  density: TimestampDensity;
  sessionHeader: boolean;
  sparseIntervalSeconds: string;
}

const TIMESTAMP_CLOCK_OPTIONS: ReadonlyArray<DropdownOption<TimestampClock>> = [
  { label: t('settings.timestamps.clock.elapsed'), value: 'elapsed' },
  { label: t('settings.timestamps.clock.wallClock'), value: 'wallclock' },
];

const TIMESTAMP_DENSITY_OPTIONS: ReadonlyArray<DropdownOption<TimestampDensity>> = [
  { label: t('settings.timestamps.frequency.atIntervals'), value: 'sparse' },
  { label: t('settings.timestamps.frequency.everyPhrase'), value: 'every_utterance' },
  { label: t('settings.timestamps.frequency.atParagraphBreaks'), value: 'paragraph' },
];

const MIN_INTERVAL_SECONDS = MIN_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
const MAX_INTERVAL_SECONDS = MAX_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
const INTERVAL_DESCRIPTION = t('settings.timestamps.interval.desc', {
  max: MAX_INTERVAL_SECONDS,
  min: MIN_INTERVAL_SECONDS,
});
let nextIntervalDescriptionId = 0;

export class TimestampSettingsModal extends Modal {
  private readonly autoSaver: ModalSettingsAutoSaver;
  private draft: TimestampSettingsDraft;
  private readonly intervalDescriptionId =
    `local-dictation-timestamp-interval-description-${++nextIntervalDescriptionId}`;
  private intervalInput: TextComponent | null = null;
  private intervalSetting: Setting | null = null;
  private frequencySetting: Setting | null = null;

  constructor(
    app: App,
    private readonly deps: TimestampSettingsModalDependencies,
  ) {
    super(app);
    this.autoSaver = new ModalSettingsAutoSaver(deps);
    this.draft = draftFromSettings(deps.getSettings());
  }

  override onOpen(): void {
    this.setTitle(t('settings.timestamps.modal.title'));
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.intervalInput = null;
    this.intervalSetting = null;
    this.frequencySetting = null;
  }

  private render(): void {
    this.contentEl.empty();
    this.intervalInput = null;
    this.intervalSetting = null;
    this.frequencySetting = null;

    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: t('settings.timestamps.modal.intro'),
    });

    new Setting(this.contentEl)
      .setName(t('settings.timestamps.sessionHeader.name'))
      .setDesc(t('settings.timestamps.sessionHeader.desc'))
      .addToggle((toggle) => {
        toggle.setValue(this.draft.sessionHeader);
        toggle.onChange((value) => {
          this.draft = { ...this.draft, sessionHeader: value };
          void this.autoSaver.persist({ timestampSessionHeader: value });
        });
      });

    new Setting(this.contentEl)
      .setName(t('settings.timestamps.referenceClock.name'))
      .setDesc(t('settings.timestamps.referenceClock.desc'))
      .addDropdown((dropdown) => {
        for (const option of TIMESTAMP_CLOCK_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(this.draft.clock);
        dropdown.onChange((value) => {
          if (!isTimestampClock(value)) return;
          this.draft = { ...this.draft, clock: value };
          void this.autoSaver.persist({ timestampClock: value });
        });
      });

    this.frequencySetting = new Setting(this.contentEl)
      .setName(t('settings.timestamps.frequency.name'))
      .setDesc(t('settings.timestamps.frequency.desc'))
      .addDropdown((dropdown) => {
        for (const option of TIMESTAMP_DENSITY_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(this.draft.density);
        dropdown.onChange((value) => {
          if (!isTimestampDensity(value)) return;
          this.draft = { ...this.draft, density: value };
          this.refreshIntervalState();
          void this.autoSaver.persist({ timestampDensity: value });
        });
      });

    this.intervalSetting = new Setting(this.contentEl)
      .setName(t('settings.timestamps.interval.name'))
      .setDesc(INTERVAL_DESCRIPTION)
      .addText((text) => {
        this.intervalInput = text;
        text.inputEl.type = 'number';
        text.inputEl.min = String(MIN_INTERVAL_SECONDS);
        text.inputEl.max = String(MAX_INTERVAL_SECONDS);
        text.inputEl.step = '1';
        text.inputEl.setAttribute('aria-label', t('settings.timestamps.interval.name'));
        text.inputEl.setAttribute('aria-describedby', this.intervalDescriptionId);
        text.setValue(this.draft.sparseIntervalSeconds);
        text.onChange((value) => {
          this.draft = { ...this.draft, sparseIntervalSeconds: value };
          this.refreshIntervalState();
          const interval = validateTimestampIntervalSeconds(value);
          if (interval.valid) {
            void this.autoSaver.persist({ timestampSparseIntervalMs: interval.milliseconds });
          }
        });
      });
    this.intervalSetting.descEl.id = this.intervalDescriptionId;
    this.intervalSetting.descEl.setAttribute('aria-live', 'polite');

    new Setting(this.contentEl).addButton((button) => {
      button.setButtonText(t('common.reset')).onClick(async () => {
        this.draft = draftFromSettings(DEFAULT_PLUGIN_SETTINGS);
        this.render();
        await this.autoSaver.persist({
          timestampClock: DEFAULT_PLUGIN_SETTINGS.timestampClock,
          timestampDensity: DEFAULT_PLUGIN_SETTINGS.timestampDensity,
          timestampSessionHeader: DEFAULT_PLUGIN_SETTINGS.timestampSessionHeader,
          timestampSparseIntervalMs: DEFAULT_PLUGIN_SETTINGS.timestampSparseIntervalMs,
        });
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
        ? t('settings.timestamps.frequency.sparseDesc')
        : this.draft.density === 'every_utterance'
          ? t('settings.timestamps.frequency.everyPhraseDesc')
          : paragraphFormattingUnavailable
            ? t('settings.timestamps.frequency.paragraphUnavailableDesc')
            : t('settings.timestamps.frequency.paragraphDesc'),
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
          : t('settings.timestamps.interval.inactiveDesc'),
    );
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
