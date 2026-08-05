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
      'OpenAI-compatible',
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

  it('keeps the large-transcript threshold beside the routing controls', async () => {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmRoutingPolicy: {
        defaultProviderId: 'ollama' as const,
        kind: 'transcript_size' as const,
        largeTranscriptProviderId: 'openrouter' as const,
        thresholdChars: 6_000,
      },
    };
    const { controls, persist } = createControls(settings);

    controls.render(new TestElement() as unknown as HTMLElement, settings);
    MockSetting.named('Large transcript threshold').onlyText().change('7000');

    await vi.waitFor(() => {
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({
          llmRoutingPolicy: expect.objectContaining({ thresholdChars: 7_000 }),
        }),
        { rerender: false },
      );
    });
  });

  it('places advanced settings after the provider model fields', () => {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmRoutingPolicy: { kind: 'fixed' as const, providerId: 'ollama' as const },
    };
    const { controls } = createControls(settings);

    controls.render(new TestElement() as unknown as HTMLElement, settings);

    const names = MockSetting.instances.map((setting) => setting.name);
    expect(names.indexOf('Advanced settings')).toBeGreaterThan(names.indexOf('Ollama model'));
  });

  it('renders discovered OpenAI-compatible models as visible input options', async () => {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmProviderConfigurations: {
        ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
        openai_compatible: {
          ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations.openai_compatible,
          baseUrl: 'http://127.0.0.1:1234/v1',
        },
      },
      llmRoutingPolicy: {
        kind: 'fixed' as const,
        providerId: 'openai_compatible' as const,
      },
    };
    createProviderMock.mockReturnValue(
      createFakeLlmProvider({
        id: 'openai_compatible',
        listModels: vi.fn(async () => [{ displayName: 'Bonsai 27B', id: 'prism-ml/bonsai-27b' }]),
      }),
    );
    const { controls } = createControls(settings);

    await controls.refreshActiveProviders();
    controls.render(new TestElement() as unknown as HTMLElement, settings);

    const model = MockSetting.named('Model');
    expect(model.settingEl.classList.contains('local-dictation-model-setting')).toBe(true);
    const listId = model.onlyText().inputEl.attributes.get('list');
    expect(listId).toBe('local-dictation-openai-compatible-models');
    const datalist = model.controlEl.querySelector('datalist');
    expect(datalist?.attributes.get('id')).toBe(listId);
    expect(datalist?.children.map((option) => option.attributes.get('value'))).toEqual([
      'prism-ml/bonsai-27b',
    ]);
  });

  it('offers an explicit working refresh action for OpenAI-compatible models', async () => {
    const listModels = vi.fn(async () => [{ displayName: 'Gemma', id: 'gemma' }]);
    createProviderMock.mockReturnValue(
      createFakeLlmProvider({ id: 'openai_compatible', listModels }),
    );
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmProviderConfigurations: {
        ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
        openai_compatible: {
          ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations.openai_compatible,
          baseUrl: 'http://127.0.0.1:1234/v1',
        },
      },
      llmRoutingPolicy: {
        kind: 'fixed' as const,
        providerId: 'openai_compatible' as const,
      },
    };
    const { controls } = createControls(settings);

    await controls.refreshActiveProviders();
    controls.render(new TestElement() as unknown as HTMLElement, settings);

    const buttons = MockSetting.named('Model').extraButtonComponents;
    expect(buttons.map((button) => button.icon)).toEqual(['refresh-cw', 'plug-zap']);

    await buttons[0]?.click();
    await vi.waitFor(() => {
      expect(listModels).toHaveBeenCalledTimes(2);
    });
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

  it('refreshes a cached loopback OpenAI-compatible catalog after app focus returns', async () => {
    const listModels = vi
      .fn()
      .mockResolvedValueOnce([{ displayName: 'Bonsai 27B', id: 'prism-ml/bonsai-27b' }])
      .mockResolvedValueOnce([{ displayName: 'Gemma 4 E2B', id: 'google/gemma-4-e2b' }]);
    createProviderMock.mockReturnValue(
      createFakeLlmProvider({ id: 'openai_compatible', listModels }),
    );
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmProviderConfigurations: {
        ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
        openai_compatible: {
          ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations.openai_compatible,
          baseUrl: 'http://127.0.0.1:1234/v1',
        },
      },
      llmRoutingPolicy: {
        kind: 'fixed' as const,
        providerId: 'openai_compatible' as const,
      },
    };
    const { controls } = createControls(settings);

    await controls.refreshActiveProviders();
    await controls.refreshActiveProviders({ forceLocal: true });
    controls.render(new TestElement() as unknown as HTMLElement, settings);

    expect(listModels).toHaveBeenCalledTimes(2);
    const datalist = MockSetting.named('Model').controlEl.querySelector('datalist');
    expect(datalist?.children.map((option) => option.attributes.get('value'))).toEqual([
      'google/gemma-4-e2b',
    ]);
  });

  it('keeps a cached remote OpenAI-compatible catalog after app focus returns', async () => {
    const listModels = vi.fn(async () => [{ displayName: 'Remote model', id: 'remote-model' }]);
    createProviderMock.mockReturnValue(
      createFakeLlmProvider({ id: 'openai_compatible', listModels }),
    );
    const { controls } = createControls({
      llmProviderConfigurations: {
        ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
        openai_compatible: {
          ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations.openai_compatible,
          baseUrl: 'https://models.example.com/v1',
        },
      },
      llmRoutingPolicy: {
        kind: 'fixed',
        providerId: 'openai_compatible',
      },
    });

    await controls.refreshActiveProviders();
    await controls.refreshActiveProviders({ forceLocal: true });

    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent forced loopback OpenAI-compatible refreshes', async () => {
    let resolveModels: ((models: ModelOption[]) => void) | undefined;
    type ModelOption = { displayName: string; id: string };
    const listModels = vi.fn(
      () =>
        new Promise<ModelOption[]>((resolve) => {
          resolveModels = resolve;
        }),
    );
    createProviderMock.mockReturnValue(
      createFakeLlmProvider({ id: 'openai_compatible', listModels }),
    );
    const { controls } = createControls({
      llmProviderConfigurations: {
        ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations,
        openai_compatible: {
          ...DEFAULT_PLUGIN_SETTINGS.llmProviderConfigurations.openai_compatible,
          baseUrl: 'http://localhost:1234/v1',
        },
      },
      llmRoutingPolicy: {
        kind: 'fixed',
        providerId: 'openai_compatible',
      },
    });

    const first = controls.refreshActiveProviders({ forceLocal: true });
    const second = controls.refreshActiveProviders({ forceLocal: true });
    await Promise.resolve();
    expect(listModels).toHaveBeenCalledTimes(1);

    resolveModels?.([{ displayName: 'Gemma', id: 'gemma' }]);
    await Promise.all([first, second]);
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
        expect.objectContaining({
          maxOutputTokens: 16,
          model: configurations[providerId].model,
        }),
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

  it('shows that a connection test is running while the provider is pending', async () => {
    let resolveCleanup: ((value: string) => void) | undefined;
    const cleanup = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveCleanup = resolve;
        }),
    );
    createProviderMock.mockReturnValue(createFakeLlmProvider({ cleanup, id: 'openai_compatible' }));
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      llmProviderConfigurations: configurations,
      llmRoutingPolicy: {
        kind: 'fixed' as const,
        providerId: 'openai_compatible' as const,
      },
    };
    const { controls } = createControls(settings, 'secret');
    controls.render(new TestElement() as unknown as HTMLElement, settings);
    const button = MockSetting.named('Model').extraButtonComponents.find(
      (candidate) => candidate.icon === 'plug-zap',
    );
    if (button === undefined) throw new Error('Connection test button missing');

    await button.click();

    expect(button.disabled).toBe(true);
    expect(button.icon).toBe('loader-circle');
    expect(button.tooltip).toBe('Testing connection…');
    expect(
      button.extraSettingsEl.classList.contains('local-dictation-connection-test--loading'),
    ).toBe(true);

    resolveCleanup?.('OK');
    await vi.waitFor(() => {
      expect(button.disabled).toBe(false);
    });
    expect(button.icon).toBe('check');
  });
});
