import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_OPENROUTER_SECRET_ID,
  getOpenRouterApiKey,
  loadPluginSettings,
} from '../src/settings/openrouter-secret-storage';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';

describe('OpenRouter secret storage', () => {
  it('moves a legacy plaintext key into Secret Storage and requests sanitized persistence', () => {
    const setSecret = vi.fn();
    const getSecret = vi.fn(() => null);

    const result = loadPluginSettings(
      {
        llmOpenRouterApiKey: ' sk-or-legacy ',
        llmProviderModels: { ollama: '', openrouter: 'openai/gpt-4.1' },
      },
      { setSecret, getSecret },
    );

    expect(setSecret).toHaveBeenCalledWith(DEFAULT_OPENROUTER_SECRET_ID, 'sk-or-legacy');
    expect(result).toMatchObject({
      settings: {
        llmOpenRouterSecretId: DEFAULT_OPENROUTER_SECRET_ID,
        llmProviderModels: { ollama: '', openrouter: 'openai/gpt-4.1' },
      },
      shouldPersist: true,
    });
    expect(result.settings).not.toHaveProperty('llmOpenRouterApiKey');
  });

  it('keeps an existing selected secret ID during migration', () => {
    const setSecret = vi.fn();
    const getSecret = vi.fn(() => null);

    const result = loadPluginSettings(
      {
        llmOpenRouterApiKey: 'sk-or-legacy',
        llmOpenRouterSecretId: 'my-openrouter-key',
      },
      { setSecret, getSecret },
    );

    expect(setSecret).toHaveBeenCalledWith('my-openrouter-key', 'sk-or-legacy');
    expect(result.settings.llmOpenRouterSecretId).toBe('my-openrouter-key');
  });

  it('does not overwrite a newer stored secret when the legacy field reappears', () => {
    const setSecret = vi.fn();
    const getSecret = vi.fn(() => 'sk-or-current');

    const result = loadPluginSettings(
      {
        llmOpenRouterApiKey: 'sk-or-stale',
        llmOpenRouterSecretId: DEFAULT_OPENROUTER_SECRET_ID,
      },
      { setSecret, getSecret },
    );

    expect(getSecret).toHaveBeenCalledWith(DEFAULT_OPENROUTER_SECRET_ID);
    expect(setSecret).not.toHaveBeenCalled();
    // The newer key survives, and the stale plaintext field is still stripped.
    expect(result.shouldPersist).toBe(true);
    expect(result.settings).not.toHaveProperty('llmOpenRouterApiKey');
    expect(result.settings.llmOpenRouterSecretId).toBe(DEFAULT_OPENROUTER_SECRET_ID);
  });

  it('does not request a settings rewrite when no legacy field exists', () => {
    const setSecret = vi.fn();
    const getSecret = vi.fn(() => null);

    const result = loadPluginSettings(
      { llmOpenRouterSecretId: 'my-openrouter-key' },
      { setSecret, getSecret },
    );

    expect(setSecret).not.toHaveBeenCalled();
    expect(result.shouldPersist).toBe(false);
  });

  it('propagates Secret Storage failures before plaintext settings can be rewritten', () => {
    const error = new Error('secret storage unavailable');

    expect(() =>
      loadPluginSettings(
        { llmOpenRouterApiKey: 'sk-or-legacy' },
        {
          getSecret: () => null,
          setSecret: () => {
            throw error;
          },
        },
      ),
    ).toThrow(error);
  });

  it('resolves the selected secret without putting key material in settings', () => {
    const getSecret = vi.fn(() => ' sk-or-secure ');
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmOpenRouterSecretId: 'my-openrouter-key',
    };

    expect(getOpenRouterApiKey(settings, { getSecret })).toBe('sk-or-secure');
    expect(getSecret).toHaveBeenCalledWith('my-openrouter-key');
    expect(settings).not.toHaveProperty('llmOpenRouterApiKey');
  });

  it('does not query Secret Storage when no secret is selected', () => {
    const getSecret = vi.fn(() => 'unexpected');

    expect(getOpenRouterApiKey(DEFAULT_PLUGIN_SETTINGS, { getSecret })).toBe('');
    expect(getSecret).not.toHaveBeenCalled();
  });
});
