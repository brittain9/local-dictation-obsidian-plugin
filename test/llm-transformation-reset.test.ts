import { describe, expect, it, vi } from 'vitest';

import { LlmPresetStateStore } from '../src/settings/llm-preset-state';
import { restoreLlmTransformationDefaults } from '../src/settings/llm-transformation-reset';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import { createUserPreset } from './fixtures/llm';

function createStore(
  initial: PluginSettings,
  persist: (settings: PluginSettings) => Promise<void> = async () => {},
) {
  let current = initial;
  const commit = vi.fn(async (settings: PluginSettings) => {
    await persist(settings);
    current = settings;
  });
  const store = new LlmPresetStateStore({
    commit,
    getSettings: () => current,
    loadData: async () => current,
    onExternalChange: vi.fn(),
    warn: vi.fn(),
  });
  return { commit, getSettings: () => current, store };
}

describe('restoreLlmTransformationDefaults', () => {
  it('persists the preset and editable-setting reset atomically through the real store', async () => {
    const preset = createUserPreset({ id: 'keep' });
    const fixture = createStore({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessActivePresetRef: 'user:keep',
      llmPostprocessMode: 'off',
      llmPostprocessTemperature: 1.5,
      llmPostprocessUserPresets: [preset],
    });

    await restoreLlmTransformationDefaults({
      mutateSettings: (mutation) => fixture.store.mutateSettings(mutation),
    });

    expect(fixture.commit).toHaveBeenCalledOnce();
    expect(fixture.getSettings()).toMatchObject({
      llmPostprocessActivePresetRef: 'builtin:clean-up',
      llmPostprocessMode: 'off',
      llmPostprocessTemperature: DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature,
      llmPostprocessUserPresets: [preset],
    });
  });

  it('rejects a failed reset without blocking a later atomic retry', async () => {
    const persistenceError = new Error('data.json is read-only');
    let attempts = 0;
    const fixture = createStore(
      { ...DEFAULT_PLUGIN_SETTINGS, llmPostprocessTemperature: 1.5 },
      async () => {
        attempts += 1;
        if (attempts === 1) throw persistenceError;
      },
    );
    const restore = () =>
      restoreLlmTransformationDefaults({
        mutateSettings: (mutation) => fixture.store.mutateSettings(mutation),
      });

    await expect(restore()).rejects.toBe(persistenceError);
    await expect(restore()).resolves.toBeUndefined();

    expect(fixture.commit).toHaveBeenCalledTimes(2);
    expect(fixture.getSettings().llmPostprocessTemperature).toBe(
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature,
    );
  });
});
