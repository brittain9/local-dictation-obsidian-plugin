import { describe, expect, it } from 'vitest';

import { formatCleanupFailureBanner } from '../../src/ui/llm-provider-ui';

describe('formatCleanupFailureBanner', () => {
  it('names the provider whose model is not configured', () => {
    expect(
      formatCleanupFailureBanner({
        code: 'model_not_configured',
        message: 'Ollama model is not configured.',
        providerId: 'ollama',
      }),
    ).toBe('Ollama model is not configured. Choose one under Model.');
  });

  it('names the provider that rejected the selected model', () => {
    expect(
      formatCleanupFailureBanner({
        code: 'unknown_model',
        message: 'OpenRouter model was not found.',
        providerId: 'openrouter',
      }),
    ).toBe('OpenRouter model not found. Choose another under Model.');
  });

  it('explains the possible credential and access causes of a permission denial', () => {
    expect(
      formatCleanupFailureBanner({
        code: 'permission_denied',
        message: 'OpenAI-compatible endpoint denied access.',
        providerId: 'openai_compatible',
      }),
    ).toBe(
      'OpenAI-compatible denied access. Check credentials, account permissions, or model access.',
    );
  });
});
