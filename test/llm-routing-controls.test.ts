import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

const { createProviderMock } = vi.hoisted(() => ({ createProviderMock: vi.fn() }));

vi.mock('../src/llm/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm/provider')>();
  return { ...actual, createProvider: createProviderMock };
});

import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import { LlmRoutingControls } from '../src/ui/llm-routing-controls';
import { createFakeLlmProvider } from './fixtures/llm';

function createControls(overrides: Partial<PluginSettings> = {}) {
  const requestRerender = vi.fn();
  const controls = new LlmRoutingControls({
    app: {} as App,
    getSettings: () => ({ ...DEFAULT_PLUGIN_SETTINGS, ...overrides }),
    persist: vi.fn(async () => {}),
    requestRerender,
  });
  return { controls, requestRerender };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('LlmRoutingControls.refreshActiveProviders', () => {
  it('retries a provider whose previous load failed', async () => {
    const listModels = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue([{ displayName: 'llama3', id: 'llama3' }]);
    createProviderMock.mockReturnValue(createFakeLlmProvider({ listModels }));
    const { controls } = createControls();

    // Initial load while Ollama is down.
    controls.refreshActiveProviders();
    await flushAsyncWork();
    expect(listModels).toHaveBeenCalledTimes(1);

    // The user starts Ollama, then refocuses the window.
    controls.refreshActiveProviders();
    await flushAsyncWork();
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('does not refetch a provider that already loaded successfully', async () => {
    const listModels = vi.fn().mockResolvedValue([{ displayName: 'llama3', id: 'llama3' }]);
    createProviderMock.mockReturnValue(createFakeLlmProvider({ listModels }));
    const { controls } = createControls();

    controls.refreshActiveProviders();
    await flushAsyncWork();

    controls.refreshActiveProviders();
    await flushAsyncWork();
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it('force-refreshes a healthy Ollama catalog after window focus', async () => {
    const listModels = vi.fn().mockResolvedValue([{ displayName: 'llama3', id: 'llama3' }]);
    createProviderMock.mockReturnValue(createFakeLlmProvider({ listModels }));
    const { controls } = createControls();

    await controls.refreshActiveProviders();
    await controls.refreshActiveProviders({ forceLocal: true });

    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('does not refetch a healthy OpenRouter catalog during local focus refresh', async () => {
    const listModels = vi
      .fn()
      .mockResolvedValue([{ displayName: 'Claude', id: 'anthropic/claude-sonnet-4.5' }]);
    createProviderMock.mockReturnValue(createFakeLlmProvider({ listModels }));
    const { controls } = createControls({ llmRouting: 'remote' });

    await controls.refreshActiveProviders();
    await controls.refreshActiveProviders({ forceLocal: true });

    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent forced local refreshes', async () => {
    let resolveModels: ((models: Array<{ displayName: string; id: string }>) => void) | undefined;
    const listModels = vi.fn(
      () =>
        new Promise<Array<{ displayName: string; id: string }>>((resolve) => {
          resolveModels = resolve;
        }),
    );
    createProviderMock.mockReturnValue(createFakeLlmProvider({ listModels }));
    const { controls } = createControls();

    const first = controls.refreshActiveProviders({ forceLocal: true });
    const second = controls.refreshActiveProviders({ forceLocal: true });
    await flushAsyncWork();
    expect(listModels).toHaveBeenCalledTimes(1);

    resolveModels?.([{ displayName: 'llama3', id: 'llama3' }]);
    await Promise.all([first, second]);
  });
});

describe('LlmRoutingControls.testOpenRouter', () => {
  const configured = {
    llmOpenRouterApiKey: 'sk-or-test',
    llmProviderModels: { ollama: '', openrouter: 'anthropic/claude-sonnet-4.5' },
  };

  it('returns null when a minimal completion succeeds with the selected model', async () => {
    const cleanup = vi.fn(async () => 'OK');
    createProviderMock.mockReturnValue(createFakeLlmProvider({ cleanup }));
    const { controls } = createControls(configured);

    await expect(controls.testOpenRouter()).resolves.toBeNull();
    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-sonnet-4.5' }),
    );
  });

  it('returns the specific failure message when the provider rejects the model', async () => {
    const { ProviderError } = await import('../src/llm/provider');
    const cleanup = vi.fn(async () => {
      throw new ProviderError('OpenRouter model was not found.', 'unknown_model');
    });
    createProviderMock.mockReturnValue(createFakeLlmProvider({ cleanup }));
    const { controls } = createControls(configured);

    await expect(controls.testOpenRouter()).resolves.toBe(
      'OpenRouter model not found. Pick another under Where it runs.',
    );
  });

  it('reports an unconfigured model without calling the provider', async () => {
    const cleanup = vi.fn(async () => 'OK');
    createProviderMock.mockReturnValue(createFakeLlmProvider({ cleanup }));
    const { controls } = createControls({
      ...configured,
      llmProviderModels: { ollama: '', openrouter: '' },
    });

    await expect(controls.testOpenRouter()).resolves.toBe(
      'OpenRouter model is not configured. Pick one under Where it runs.',
    );
    expect(cleanup).not.toHaveBeenCalled();
  });
});
