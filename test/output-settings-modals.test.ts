import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiarizationSettingsModal } from '../src/settings/diarization-settings-modal';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import { TimestampSettingsModal } from '../src/settings/timestamp-settings-modal';
import { Setting as MockSetting } from './__mocks__/obsidian';

describe('transcript output settings modals', () => {
  beforeEach(() => {
    MockSetting.reset();
  });

  it('announces an invalid timestamp interval and blocks saving it', async () => {
    const saveSettings = vi.fn(async () => {});
    new TimestampSettingsModal({} as App, {
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      saveSettings,
    }).open();

    const intervalSetting = MockSetting.named('Interval');
    const interval = intervalSetting.onlyText();
    interval.change('2.5');

    expect(interval.inputEl.validationMessage).toBe('Enter a whole number from 10 to 600 seconds.');
    expect(interval.inputEl.attributes.get('aria-label')).toBe('Interval');
    expect(interval.inputEl.attributes.get('aria-describedby')).toBe(intervalSetting.descEl.id);
    expect(interval.inputEl.attributes.has('aria-invalid')).toBe(true);
    expect(intervalSetting.descEl.attributes.get('aria-live')).toBe('polite');
    expect(MockSetting.buttonNamed('Save').disabled).toBe(true);

    await MockSetting.buttonNamed('Save').click();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('renders fixed frequency choices and persists a merged draft', async () => {
    let settings: PluginSettings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      timestampSparseIntervalMs: 45_000,
    };
    const saveSettings = vi.fn(async (next: PluginSettings) => {
      settings = next;
    });
    const onSave = vi.fn();
    new TimestampSettingsModal({} as App, {
      getSettings: () => settings,
      onSave,
      saveSettings,
    }).open();

    const frequency = MockSetting.named('Frequency').onlyDropdown();
    expect(frequency.selectEl.options).toEqual([
      { disabled: false, label: 'At intervals', value: 'sparse' },
      { disabled: false, label: 'Every phrase', value: 'every_utterance' },
      { disabled: false, label: 'At paragraph breaks', value: 'paragraph' },
    ]);
    frequency.change('paragraph');
    MockSetting.named('Reference clock').onlyDropdown().change('wallclock');
    MockSetting.named('Session header').onlyToggle().change(false);
    expect(MockSetting.named('Interval').onlyText().inputEl.disabled).toBe(true);

    // Settings may change elsewhere while the modal is open. Saving should
    // merge the draft onto the latest authoritative object.
    const concurrentSettings = { ...settings, developerMode: true };
    settings = concurrentSettings;
    await MockSetting.buttonNamed('Save').click();

    expect(saveSettings).toHaveBeenCalledWith({
      ...concurrentSettings,
      timestampClock: 'wallclock',
      timestampDensity: 'paragraph',
      timestampSessionHeader: false,
    });
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('disables speaker-limit editing while speaker labels are off', () => {
    new DiarizationSettingsModal({} as App, {
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      saveSettings: vi.fn(async () => {}),
    }).open();

    const maximumSpeakers = MockSetting.named('Maximum speakers');
    expect(maximumSpeakers.onlyDropdown().selectEl.disabled).toBe(true);
    expect(maximumSpeakers.descEl.textContent).toContain('Enable speaker labels');
  });

  it('persists an enabled speaker limit through the modal boundary', async () => {
    const settings = { ...DEFAULT_PLUGIN_SETTINGS, diarizationEnabled: true };
    const saveSettings = vi.fn(async () => {});
    const onSave = vi.fn();
    new DiarizationSettingsModal({} as App, {
      getSettings: () => settings,
      onSave,
      saveSettings,
    }).open();

    const maximumSpeakers = MockSetting.named('Maximum speakers').onlyDropdown();
    expect(maximumSpeakers.selectEl.disabled).toBe(false);
    maximumSpeakers.change('4');
    await MockSetting.buttonNamed('Save').click();

    expect(saveSettings).toHaveBeenCalledWith({ ...settings, diarizationMaxSpeakers: 4 });
    expect(onSave).toHaveBeenCalledOnce();
  });
});
