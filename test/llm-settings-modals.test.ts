import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { LlmContextSettingsModal } from '../src/ui/llm-context-settings-modal';
import { LlmModelSettingsModal } from '../src/ui/llm-model-settings-modal';
import { LlmTimingSettingsModal } from '../src/ui/llm-timing-settings-modal';
import { Setting as MockSetting } from './__mocks__/obsidian';
import { createUserPreset } from './fixtures/llm';

describe('LLM transform settings modals', () => {
  beforeEach(() => {
    MockSetting.reset();
  });

  it('does not persist a fractional minimum-word value', async () => {
    const saveSettings = vi.fn(async () => {});
    const modal = new LlmTimingSettingsModal({} as App, {
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      saveSettings,
    });

    modal.open();
    const minimumWordsSetting = MockSetting.named('Minimum words');
    const minimumWords = minimumWordsSetting.onlyText();
    minimumWords.change('7.5');

    expect(minimumWords.inputEl.validationMessage).toBe('Enter a whole number from 0 to 50.');
    expect(minimumWords.inputEl.attributes.get('aria-label')).toBe('Minimum words');
    expect(minimumWords.inputEl.attributes.get('aria-describedby')).toBe(
      minimumWordsSetting.descEl.id,
    );
    expect(minimumWords.inputEl.attributes.has('aria-invalid')).toBe(true);
    expect(minimumWordsSetting.descEl.attributes.get('aria-live')).toBe('polite');
    await Promise.resolve();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('persists a valid minimum-word value when it changes', async () => {
    let settings = DEFAULT_PLUGIN_SETTINGS;
    const saveSettings = vi.fn(async (next) => {
      settings = next;
    });
    const onSave = vi.fn();
    const modal = new LlmTimingSettingsModal({} as App, {
      getSettings: () => settings,
      onSave,
      saveSettings,
    });

    modal.open();
    MockSetting.named('Minimum words').onlyText().change('8');

    await vi.waitFor(() => {
      expect(settings.llmPostprocessSkipMinWords).toBe(8);
    });
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('uses preset-pinned timing to disable phrase-only context fields', async () => {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessActivePresetRef: 'builtin:tldr',
      llmPostprocessMode: 'per_utterance' as const,
    };
    let persistedSettings = settings;
    const saveSettings = vi.fn(async (next) => {
      persistedSettings = next;
    });
    const modal = new LlmContextSettingsModal({} as App, {
      getSettings: () => settings,
      saveSettings,
    });

    modal.open();
    expect(MockSetting.named('Previous phrases').onlyText().inputEl.disabled).toBe(true);
    expect(MockSetting.named('Context limit').onlyText().inputEl.disabled).toBe(true);
    MockSetting.named('Note context length').onlyText().change('9000');

    await vi.waitFor(() => {
      expect(persistedSettings.llmPostprocessNoteContextChars).toBe(9000);
    });
    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it('shows preset-owned numeric settings without allowing global edits', () => {
    const preset = createUserPreset({
      overrides: { minWords: 12, temperature: 1.2 },
    });
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessActivePresetRef: `user:${preset.id}`,
      llmPostprocessUserPresets: [preset],
    };

    new LlmTimingSettingsModal({} as App, {
      getSettings: () => settings,
      saveSettings: vi.fn(async () => {}),
    }).open();
    const minimumWords = MockSetting.named('Minimum words').onlyText().inputEl;
    expect(minimumWords.value).toBe('12');
    expect(minimumWords.disabled).toBe(true);

    MockSetting.reset();
    new LlmModelSettingsModal({} as App, {
      getSettings: () => settings,
      saveSettings: vi.fn(async () => {}),
    }).open();
    const temperature = MockSetting.named('Temperature').onlyText().inputEl;
    expect(temperature.value).toBe('1.2');
    expect(temperature.disabled).toBe(true);
  });

  it('persists each applicable size-routing model setting when it changes', async () => {
    let settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmRoutingPolicy: {
        defaultProviderId: 'ollama' as const,
        kind: 'transcript_size' as const,
        largeTranscriptProviderId: 'openrouter' as const,
        thresholdChars: 6_000,
      },
    };
    const saveSettings = vi.fn(async (next) => {
      settings = next;
    });
    const modal = new LlmModelSettingsModal({} as App, {
      getSettings: () => settings,
      saveSettings,
    });

    modal.open();
    MockSetting.named('Temperature').onlyText().change('0.8');
    MockSetting.named('Large transcript threshold').onlyText().change('7000');
    MockSetting.named('Network timeout').onlyText().change('45');

    await vi.waitFor(() => {
      expect(settings).toMatchObject({
        llmPostprocessTemperature: 0.8,
        llmNetworkTimeoutSec: 45,
        llmRoutingPolicy: expect.objectContaining({ thresholdChars: 7000 }),
      });
    });
    expect(saveSettings).toHaveBeenCalledTimes(3);
  });

  it('hides network and threshold settings for fixed Ollama routing', () => {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmRoutingPolicy: { kind: 'fixed' as const, providerId: 'ollama' as const },
    };

    new LlmModelSettingsModal({} as App, {
      getSettings: () => settings,
      saveSettings: vi.fn(async () => {}),
    }).open();

    const names = MockSetting.instances.map((setting) => setting.name);
    expect(names).not.toContain('Large transcript threshold');
    expect(names).not.toContain('Network timeout');
  });
});
