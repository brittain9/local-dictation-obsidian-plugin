import { describe, expect, it, vi } from 'vitest';

import {
  type CleanupOptions,
  type LlmProviderId,
  type LlmRoutingPolicy,
  ProviderError,
} from '../../src/llm/provider';
import { createLlmRouter } from '../../src/llm/router';
import { createFakeLlmProvider } from '../fixtures/llm';

const MODELS: Record<LlmProviderId, string> = {
  ollama: 'llama3.2:latest',
  openrouter: 'openai/gpt-4.1',
  openai_compatible: 'local-model',
};

function routerWithSpy(
  policy: LlmRoutingPolicy,
  options: {
    cleanup?: (cleanupOptions: CleanupOptions) => Promise<string>;
    models?: Partial<Record<LlmProviderId, string>>;
  } = {},
) {
  const calls: Array<{ model: string; providerId: LlmProviderId }> = [];
  const resolveProvider = vi.fn((providerId: LlmProviderId) => ({
    model: options.models?.[providerId] ?? MODELS[providerId],
    provider: createFakeLlmProvider({
      id: providerId,
      cleanup: vi.fn(async (cleanupOptions: CleanupOptions) => {
        calls.push({ model: cleanupOptions.model, providerId });
        return options.cleanup?.(cleanupOptions) ?? 'cleaned';
      }),
    }),
  }));
  return { calls, resolveProvider, router: createLlmRouter({ policy, resolveProvider }) };
}

const cleanupArgs = (userMessage: string) => ({
  prompt: 'Clean it.',
  temperature: 0.2,
  transcriptChars: userMessage.length,
  userMessage,
});

describe('createLlmRouter', () => {
  it.each([
    ['ollama', 'llama3.2:latest'],
    ['openrouter', 'openai/gpt-4.1'],
    ['openai_compatible', 'local-model'],
  ] as const)(
    'routes a fixed %s policy regardless of transcript size',
    async (providerId, model) => {
      const { calls, router } = routerWithSpy({ kind: 'fixed', providerId });

      const result = await router.cleanup(cleanupArgs('x'.repeat(50_000)));

      expect(result).toMatchObject({ model, providerId });
      expect(calls).toEqual([{ model, providerId }]);
    },
  );

  it.each([
    ['at the threshold uses the default', 100, 'ollama'],
    ['one over uses the large-transcript provider', 101, 'openrouter'],
  ] as const)('%s', async (_label, transcriptChars, expected) => {
    const { router } = routerWithSpy({
      defaultProviderId: 'ollama',
      kind: 'transcript_size',
      largeTranscriptProviderId: 'openrouter',
      thresholdChars: 100,
    });

    await expect(
      router.cleanup({ ...cleanupArgs('rendered message'), transcriptChars }),
    ).resolves.toMatchObject({ providerId: expected });
  });

  it('routes on dictated transcript length rather than rendered note context', async () => {
    const { router } = routerWithSpy({
      defaultProviderId: 'ollama',
      kind: 'transcript_size',
      largeTranscriptProviderId: 'openai_compatible',
      thresholdChars: 100,
    });

    const result = await router.cleanup({
      prompt: 'Clean it.',
      temperature: 0.2,
      transcriptChars: 20,
      userMessage: `<note_context>${'x'.repeat(1_000)}</note_context>short transcript`,
    });

    expect(result.providerId).toBe('ollama');
  });

  it('lazily constructs and caches only providers selected by requests', async () => {
    const { resolveProvider, router } = routerWithSpy({
      defaultProviderId: 'ollama',
      kind: 'transcript_size',
      largeTranscriptProviderId: 'openrouter',
      thresholdChars: 100,
    });

    await router.cleanup({ ...cleanupArgs('short'), transcriptChars: 10 });
    await router.cleanup({ ...cleanupArgs('short again'), transcriptChars: 10 });

    expect(resolveProvider).toHaveBeenCalledTimes(1);
    expect(resolveProvider).toHaveBeenCalledWith('ollama');
  });

  it('throws an attributed model_not_configured error before issuing a request', async () => {
    const { calls, router } = routerWithSpy(
      { kind: 'fixed', providerId: 'openai_compatible' },
      { models: { openai_compatible: '' } },
    );

    await expect(router.cleanup(cleanupArgs('hi'))).rejects.toMatchObject({
      code: 'model_not_configured',
      providerId: 'openai_compatible',
    });
    expect(calls).toEqual([]);
  });

  it('caps output from transcript size rather than rendered context size', async () => {
    const captured: CleanupOptions[] = [];
    const { router } = routerWithSpy(
      { kind: 'fixed', providerId: 'ollama' },
      {
        cleanup: async (options) => {
          captured.push(options);
          return 'cleaned';
        },
      },
    );

    await router.cleanup({
      prompt: 'Clean it.',
      temperature: 0.2,
      transcriptChars: 40_000,
      userMessage: `<note_context>${'x'.repeat(100_000)}</note_context>`,
    });

    expect(captured[0]?.maxOutputTokens).toBe(15_000);
  });

  it('attributes provider errors to the selected routing leg', async () => {
    const { router } = routerWithSpy(
      { kind: 'fixed', providerId: 'openrouter' },
      {
        cleanup: async () => {
          throw new ProviderError('boom', 'http_error');
        },
      },
    );

    await expect(router.cleanup(cleanupArgs('hi'))).rejects.toMatchObject({
      code: 'http_error',
      providerId: 'openrouter',
    });
  });
});
