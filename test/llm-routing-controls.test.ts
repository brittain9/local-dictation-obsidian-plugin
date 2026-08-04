import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createProviderMock } = vi.hoisted(() => ({ createProviderMock: vi.fn() }));

vi.mock('../src/llm/provider-factory', () => {
  return { createProvider: createProviderMock };
});

import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import { LlmRoutingControls } from '../src/ui/llm-routing-controls';
import { Setting as MockSetting, TestElement } from './__mocks__/obsidian';
import { createFakeLlmProvider } from './fixtures/llm';

function createControls(overrides: Partial<PluginSettings> = {}, secret = '') {
  const show = vi.fn();
  const requestRerender = vi.fn();
  const persist = vi.fn(async () => {});
  const controls = new LlmRoutingControls({
    app: {} as App,
    feedback: { show },
    getSecret: () => secret,
    getSettings: () => ({ ...DEFAULT_PLUGIN_SETTINGS, ...overrides }),
    openModelSettings: vi.fn(),
    persist,
    requestRerender,
  });
  return { controls, persist, requestRerender, show };
}

beforeEach(() => {
  MockSetting.reset();
  createProviderMock.mockReset();
});

describe('LlmRoutingControls.render', () => {
  it('starts with one empty provider picker for an unconfigured installation', () => {
    const { controls } = createControls();

    controls.render(new TestElement() as unknown as HTMLElement, DEFAULT_PLUGIN_SETTINGS);

    const provider = MockSetting.named('Provider').onlyDropdown();
    expect(provider.selectEl.value).toBe('');
    expect(provider.selectEl.options.map((option) => option.label)).toEqual([
      'Choose a provider',
      'Ollama',
      'OpenRouter',
      'Custom endpoint',
    ]);
    expect(MockSetting.instances.map((setting) => setting.name)).not.toContain(
      'Use a different provider for large transcripts',
    );
  });

  it('reveals custom endpoint fields only when that provider is selected', () => {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmRoutingPolicy: { kind: 'fixed' as const, providerId: 'openai_compatible' as const },
    };
    const { controls } = createControls(settings);

    controls.render(new TestElement() as unknown as HTMLElement, settings);

    expect(MockSetting.instances.map((setting) => setting.name)).toEqual(
      expect.arrayContaining(['Provider', 'Base URL', 'API key', 'Model']),
    );
    expect(MockSetting.instances.map((setting) => setting.name)).not.toContain('Ollama model');
  });

  it('excludes the default provider from the large-transcript picker', () => {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmRoutingPolicy: {
        defaultProviderId: 'ollama' as const,
        kind: 'transcript_size' as const,
        largeTranscriptProviderId: 'openrouter' as const,
        thresholdChars: 6_000,
      },
    };
    const { controls } = createControls(settings);

    controls.render(new TestElement() as unknown as HTMLElement, settings);

    expect(
      MockSetting.named('Large-transcript provider')
        .onlyDropdown()
        .selectEl.options.map((option) => option.value),
    ).toEqual(['openrouter', 'openai_compatible']);
  });
});

describe('LlmRoutingControls.refreshActiveProviders', () => {
  it('refreshes only providers used by the active policy', async () => {
    createProviderMock.mockImplementation((providerId) =>
      createFakeLlmProvider({ id: providerId }),
    );
    const { controls } = createControls({
      llmRoutingPolicy: {
        defaultProviderId: 'ollama',
        kind: 'transcript_size',
        largeTranscriptProviderId: 'openai_compatible',
        thresholdChars: 1_000,
      },
      llmProviderConfigurations: {
        ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
        openai_compatible: {
          ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations.openai_compatible,
          baseUrl: 'http://localhost:1234/v1',
        },
      },
    });

    await controls.refreshActiveProviders();

    expect(createProviderMock).toHaveBeenCalledTimes(2);
    expect(createProviderMock.mock.calls.map(([providerId]) => providerId)).toEqual([
      'ollama',
      'openai_compatible',
    ]);
  });

  it('retries a provider whose previous model load failed', async () => {
    const listModels = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([{ displayName: 'llama3', id: 'llama3' }]);
    createProviderMock.mockReturnValue(createFakeLlmProvider({ listModels }));
    const { controls } = createControls({
      llmRoutingPolicy: { kind: 'fixed', providerId: 'ollama' },
    });

    await controls.refreshActiveProviders();
    await controls.refreshActiveProviders();

    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent forced Ollama refreshes', async () => {
    let resolveModels: ((models: ModelOption[]) => void) | undefined;
    type ModelOption = { displayName: string; id: string };
    const listModels = vi.fn(
      () =>
        new Promise<ModelOption[]>((resolve) => {
          resolveModels = resolve;
        }),
    );
    createProviderMock.mockReturnValue(createFakeLlmProvider({ listModels }));
    const { controls } = createControls({
      llmRoutingPolicy: { kind: 'fixed', providerId: 'ollama' },
    });

    const first = controls.refreshActiveProviders({ forceLocal: true });
    const second = controls.refreshActiveProviders({ forceLocal: true });
    await Promise.resolve();
    expect(listModels).toHaveBeenCalledTimes(1);

    resolveModels?.([{ displayName: 'llama3', id: 'llama3' }]);
    await Promise.all([first, second]);
  });
});

describe('LlmRoutingControls.testProvider', () => {
  const configurations = {
    ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
    openrouter: {
      model: 'anthropic/claude-sonnet-4.5',
      secretId: 'openrouter-secret',
    },
    openai_compatible: {
      baseUrl: 'http://localhost:1234/v1',
      model: 'local-model',
      secretId: 'custom-secret',
    },
  };

  it.each(['openrouter', 'openai_compatible'] as const)(
    'runs a minimal real completion for %s',
    async (providerId) => {
      const cleanup = vi.fn(async () => 'OK');
      createProviderMock.mockReturnValue(createFakeLlmProvider({ cleanup, id: providerId }));
      const { controls } = createControls({ llmProviderConfigurations: configurations }, 'secret');

      await expect(controls.testProvider(providerId)).resolves.toBeNull();
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({ model: configurations[providerId].model }),
      );
      expect(createProviderMock).toHaveBeenCalledWith(
        providerId,
        expect.objectContaining({
          configurations,
          networkTimeoutMs: DEFAULT_PLUGIN_SETTINGS.llmNetworkTimeoutSec * 1000,
        }),
      );
    },
  );

  it('reports an unconfigured model without calling the provider', async () => {
    const cleanup = vi.fn(async () => 'OK');
    createProviderMock.mockReturnValue(createFakeLlmProvider({ cleanup }));
    const { controls } = createControls({
      llmProviderConfigurations: {
        ...configurations,
        openrouter: { ...configurations.openrouter, model: '' },
      },
    });

    await expect(controls.testProvider('openrouter')).resolves.toContain('model is not configured');
    expect(cleanup).not.toHaveBeenCalled();
  });
});
