import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_OPENROUTER_SECRET_ID,
  getLlmProviderSecret,
  loadPluginSettings,
} from '../src/settings/openrouter-secret-storage';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';

describe('LLM Secret Storage integration', () => {
  it('moves a legacy plaintext OpenRouter key and requests sanitized persistence', () => {
    const setSecret = vi.fn();
    const getSecret = vi.fn(() => null);

    const result = loadPluginSettings(
      {
        llmOpenRouterApiKey: ' sk-or-legacy ',
        llmProviderModels: { ollama: '', openrouter: 'openai/gpt-4.1' },
      },
      { getSecret, setSecret },
    );

    expect(setSecret).toHaveBeenCalledWith(DEFAULT_OPENROUTER_SECRET_ID, 'sk-or-legacy');
    expect(result.settings.llmProviderConfigurations.openrouter).toEqual({
      model: 'openai/gpt-4.1',
      secretId: DEFAULT_OPENROUTER_SECRET_ID,
    });
    expect(result.shouldPersist).toBe(true);
    expect(result.settings).not.toHaveProperty('llmOpenRouterApiKey');
  });

  it('keeps an existing selected OpenRouter secret ID during migration', () => {
    const setSecret = vi.fn();
    const result = loadPluginSettings(
      { llmOpenRouterApiKey: 'sk-or-legacy', llmOpenRouterSecretId: 'my-openrouter-key' },
      { getSecret: () => null, setSecret },
    );

    expect(setSecret).toHaveBeenCalledWith('my-openrouter-key', 'sk-or-legacy');
    expect(result.settings.llmProviderConfigurations.openrouter.secretId).toBe('my-openrouter-key');
  });

  it('does not overwrite a newer stored secret when plaintext reappears', () => {
    const setSecret = vi.fn();
    const result = loadPluginSettings(
      {
        llmOpenRouterApiKey: 'sk-or-stale',
        llmOpenRouterSecretId: DEFAULT_OPENROUTER_SECRET_ID,
      },
      { getSecret: () => 'sk-or-current', setSecret },
    );

    expect(setSecret).not.toHaveBeenCalled();
    expect(result.shouldPersist).toBe(true);
  });

  it('requests one normalized rewrite for settings schemas before version 8', () => {
    const result = loadPluginSettings(
      { schemaVersion: 6 },
      { getSecret: () => null, setSecret: vi.fn() },
    );

    expect(result.settings.schemaVersion).toBe(8);
    expect(result.shouldPersist).toBe(true);
  });

  it('does not rewrite already-normalized schema 8 settings', () => {
    const result = loadPluginSettings(DEFAULT_PLUGIN_SETTINGS, {
      getSecret: () => null,
      setSecret: vi.fn(),
    });

    expect(result.shouldPersist).toBe(false);
  });

  it.each([
    ['openrouter', 'openrouter-secret'],
    ['openai_compatible', 'custom-secret'],
  ] as const)(
    'resolves the selected %s secret without persisting key material',
    (providerId, secretId) => {
      const getSecret = vi.fn(() => ' secure-value ');
      const settings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        llmProviderConfigurations: {
          ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
          [providerId]: {
            ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations[providerId],
            secretId,
          },
        },
      };

      expect(getLlmProviderSecret(settings, providerId, { getSecret })).toBe('secure-value');
      expect(getSecret).toHaveBeenCalledWith(secretId);
    },
  );

  it('never queries Secret Storage for Ollama', () => {
    const getSecret = vi.fn(() => 'unexpected');

    expect(getLlmProviderSecret(DEFAULT_PLUGIN_SETTINGS, 'ollama', { getSecret })).toBe('');
    expect(getSecret).not.toHaveBeenCalled();
  });
});
