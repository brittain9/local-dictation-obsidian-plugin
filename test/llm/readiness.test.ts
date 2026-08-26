import { describe, expect, it } from 'vitest';

import { resolveLlmReadiness } from '../../src/llm/readiness';
import { DEFAULT_PLUGIN_SETTINGS } from '../../src/settings/plugin-settings';

describe('resolveLlmReadiness', () => {
  it('requires an explicit provider policy', () => {
    expect(
      resolveLlmReadiness({
        configurations: DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
        getSecret: () => '',
        policy: null,
      }),
    ).toMatchObject({ issue: { code: 'provider_missing' }, ready: false });
  });

  it('requires a model on every active routing leg', () => {
    expect(
      resolveLlmReadiness({
        configurations: DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
        getSecret: () => '',
        policy: { kind: 'fixed', providerId: 'ollama' },
      }),
    ).toMatchObject({ issue: { code: 'model_missing', providerId: 'ollama' }, ready: false });
  });

  it('requires OpenRouter authentication but permits an unauthenticated custom endpoint', () => {
    const configurations = {
      ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
      openrouter: { model: 'remote-model', secretId: 'openrouter-key' },
      openai_compatible: {
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        secretId: '',
      },
    };

    expect(
      resolveLlmReadiness({
        configurations,
        getSecret: () => '',
        policy: { kind: 'fixed', providerId: 'openrouter' },
      }),
    ).toMatchObject({ issue: { code: 'api_key_missing' }, ready: false });
    expect(
      resolveLlmReadiness({
        configurations,
        getSecret: () => '',
        policy: { kind: 'fixed', providerId: 'openai_compatible' },
      }),
    ).toEqual({ ready: true });
  });

  it('rejects an invalid custom endpoint URL before runtime construction', () => {
    expect(
      resolveLlmReadiness({
        configurations: {
          ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
          openai_compatible: { baseUrl: 'localhost:1234', model: 'model', secretId: '' },
        },
        getSecret: () => '',
        policy: { kind: 'fixed', providerId: 'openai_compatible' },
      }),
    ).toMatchObject({ issue: { code: 'base_url_invalid' }, ready: false });
  });
});
