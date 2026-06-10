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
    ).toBe('Ollama model is not configured. Pick one under Where it runs.');
  });

  it('names the provider that rejected the selected model', () => {
    expect(
      formatCleanupFailureBanner({
        code: 'unknown_model',
        message: 'OpenRouter model was not found.',
        providerId: 'openrouter',
      }),
    ).toBe('OpenRouter model not found. Pick another under Where it runs.');
  });
});
