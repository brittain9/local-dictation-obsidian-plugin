import { describe, expect, it, vi } from 'vitest';
import {
  type CleanupOptions,
  type LlmProvider,
  type LlmProviderId,
  ProviderError,
} from '../../src/llm/provider';
import { createLlmRouter } from '../../src/llm/router';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../../src/settings/plugin-settings';
import { createFakeLlmProvider } from '../fixtures/llm';

function settings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_PLUGIN_SETTINGS,
    llmProviderModels: { ollama: 'llama3.2:latest', openrouter: 'openai/gpt-4.1' },
    ...overrides,
  };
}

// Records which provider id the router constructed plus the model it passed to
// cleanup(), so size-based routing can be asserted end to end.
function routerWithSpy(
  pluginSettings: PluginSettings,
  cleanup: (options: CleanupOptions) => Promise<string> = async () => 'cleaned',
): {
  calls: Array<{ model: string; providerId: LlmProviderId }>;
  router: ReturnType<typeof createLlmRouter>;
} {
  const calls: Array<{ model: string; providerId: LlmProviderId }> = [];
  const router = createLlmRouter(
    pluginSettings,
    (providerId): LlmProvider =>
      createFakeLlmProvider({
        id: providerId,
        cleanup: vi.fn(async (options: CleanupOptions) => {
          calls.push({ model: options.model, providerId });
          return cleanup(options);
        }),
      }),
  );
  return { calls, router };
}

const cleanupArgs = (userMessage: string) => ({
  prompt: 'Clean it.',
  temperature: 0.2,
  transcriptChars: userMessage.length,
  userMessage,
});

describe('createLlmRouter', () => {
  it('routes local to Ollama regardless of size', async () => {
    const { calls, router } = routerWithSpy(settings({ llmRouting: 'local' }));

    const result = await router.cleanup(cleanupArgs('x'.repeat(50_000)));

    expect(result.providerId).toBe('ollama');
    expect(result.model).toBe('llama3.2:latest');
    expect(calls).toEqual([{ model: 'llama3.2:latest', providerId: 'ollama' }]);
  });

  it('routes remote to OpenRouter regardless of size', async () => {
    const { calls, router } = routerWithSpy(settings({ llmRouting: 'remote' }));

    const result = await router.cleanup(cleanupArgs('tiny'));

    expect(result.providerId).toBe('openrouter');
    expect(calls).toEqual([{ model: 'openai/gpt-4.1', providerId: 'openrouter' }]);
  });

  it.each([
    'remote',
    'auto',
  ] as const)('forces %s routing through Ollama when remote LLM features are disabled', async (llmRouting) => {
    const { calls, router } = routerWithSpy(
      settings({
        llmRemoteFeaturesEnabled: false,
        llmRemoteThresholdChars: 100,
        llmRouting,
      }),
    );

    const result = await router.cleanup(cleanupArgs('x'.repeat(1_000)));

    expect(result.providerId).toBe('ollama');
    expect(calls).toEqual([{ model: 'llama3.2:latest', providerId: 'ollama' }]);
  });

  it('re-checks remote availability when cleanup runs', async () => {
    let remoteEnabled = true;
    const pluginSettings = settings({ llmRouting: 'remote' });
    const calls: LlmProviderId[] = [];
    const router = createLlmRouter(
      pluginSettings,
      (providerId) =>
        createFakeLlmProvider({
          id: providerId,
          cleanup: vi.fn(async () => {
            calls.push(providerId);
            return 'cleaned';
          }),
        }),
      () => remoteEnabled,
    );

    remoteEnabled = false;
    expect(router.selectProviderId('private transcript'.length)).toBe('ollama');
    const result = await router.cleanup(cleanupArgs('private transcript'));

    expect(result.providerId).toBe('ollama');
    expect(calls).toEqual(['ollama']);
  });

  it.each([
    ['at the threshold stays local', 100, 'ollama'],
    ['one over the threshold escalates to remote', 101, 'openrouter'],
  ] as const)('auto %s', async (_label, chars, expected) => {
    const { router } = routerWithSpy(
      settings({ llmRemoteThresholdChars: 100, llmRouting: 'auto' }),
    );

    const result = await router.cleanup(cleanupArgs('x'.repeat(chars)));

    expect(result.providerId).toBe(expected);
  });

  it('throws model_not_configured when the routed provider has no configured model', async () => {
    const { router } = routerWithSpy(
      settings({ llmProviderModels: { ollama: '', openrouter: '' }, llmRouting: 'local' }),
    );

    await expect(router.cleanup(cleanupArgs('hi'))).rejects.toMatchObject({
      code: 'model_not_configured',
      name: 'ProviderError',
    } satisfies Partial<ProviderError>);
  });

  it('throws model_not_configured for the remote provider when auto escalates but no remote model is set', async () => {
    const { router } = routerWithSpy(
      settings({
        llmProviderModels: { ollama: 'llama3.2:latest', openrouter: '' },
        llmRemoteThresholdChars: 100,
        llmRouting: 'auto',
      }),
    );

    await expect(router.cleanup(cleanupArgs('x'.repeat(200)))).rejects.toMatchObject({
      code: 'model_not_configured',
      message: expect.stringContaining('OpenRouter'),
      name: 'ProviderError',
    } satisfies Partial<ProviderError>);
  });

  it('caps provider output from the transcript size, not the full message', async () => {
    const captured: CleanupOptions[] = [];
    const router = createLlmRouter(
      settings({ llmRouting: 'local' }),
      (providerId): LlmProvider =>
        createFakeLlmProvider({
          id: providerId,
          cleanup: vi.fn(async (options: CleanupOptions) => {
            captured.push(options);
            return 'cleaned';
          }),
        }),
    );

    await router.cleanup({
      prompt: 'Clean it.',
      temperature: 0.2,
      transcriptChars: 40_000,
      userMessage: `<note_context>${'x'.repeat(100_000)}</note_context>`,
    });

    // outputTokenBudget(40_000) = ceil(10_000 * 1.5); the 100k-char context
    // wrapper must not inflate the cap.
    expect(captured[0]?.maxOutputTokens).toBe(15_000);
  });

  it('attaches the routed provider id to errors thrown during cleanup', async () => {
    const { router } = routerWithSpy(settings({ llmRouting: 'remote' }), async () => {
      throw new ProviderError('boom', 'http_error');
    });

    await expect(router.cleanup(cleanupArgs('hi'))).rejects.toMatchObject({
      code: 'http_error',
      providerId: 'openrouter',
    });
  });

  it('attaches the provider id to model_not_configured errors', async () => {
    const { router } = routerWithSpy(
      settings({ llmProviderModels: { ollama: '', openrouter: '' }, llmRouting: 'local' }),
    );

    await expect(router.cleanup(cleanupArgs('hi'))).rejects.toMatchObject({
      code: 'model_not_configured',
      providerId: 'ollama',
    });
  });

  it('propagates the provider id and model on a successful cleanup', async () => {
    const { router } = routerWithSpy(settings({ llmRouting: 'remote' }), async () => '  spaced  ');

    await expect(router.cleanup(cleanupArgs('hi'))).resolves.toEqual({
      model: 'openai/gpt-4.1',
      providerId: 'openrouter',
      text: '  spaced  ',
    });
  });
});
