import type { PluginSettings } from '../settings/plugin-settings';
import { GeminiProvider } from './gemini-provider';
import { OllamaProvider } from './ollama-provider';
import { OpenRouterProvider } from './openrouter-provider';

export const LLM_PROVIDER_IDS = ['ollama', 'openrouter', 'gemini'] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export type ProviderErrorCode =
  | 'auth_invalid'
  | 'connection_failed'
  | 'http_error'
  | 'invalid_response'
  | 'rate_limited'
  | 'timeout'
  | 'unknown_model';

export type ProviderHealth =
  | { kind: 'unknown' }
  | { kind: 'unreachable' }
  | { kind: 'auth_invalid' }
  | { kind: 'rate_limited' }
  | { kind: 'no_models' }
  | { kind: 'ready'; modelCount: number };

export interface ModelOption {
  displayName: string;
  id: string;
}

export interface CleanupOptions {
  abortSignal?: AbortSignal;
  model: string;
  prompt: string;
  temperature: number;
  userMessage: string;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  cleanup(options: CleanupOptions): Promise<string>;
  listModels(): Promise<ModelOption[]>;
  probe(): Promise<ProviderHealth>;
}

export interface LocalLlmProvider extends LlmProvider {
  prewarmModel(modelId: string): Promise<void>;
}

export function isLocalLlmProvider(provider: LlmProvider): provider is LocalLlmProvider {
  return provider.id === 'ollama';
}

export interface LlmProviderModels {
  gemini: string;
  ollama: string;
  openrouter: string;
}

export interface LlmCleanupFailure {
  code: ProviderErrorCode;
  message: string;
  providerId: LlmProviderId;
}

export class ProviderError extends Error {
  readonly responseText?: string;
  readonly status?: number;

  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    options: { responseText?: string | undefined; status?: number | undefined } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    if (options.responseText !== undefined) {
      this.responseText = options.responseText;
    }
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export function createProvider(settings: PluginSettings): LlmProvider {
  switch (settings.llmProvider) {
    case 'ollama':
      return new OllamaProvider();
    case 'openrouter':
      return new OpenRouterProvider({ apiKey: settings.llmOpenRouterApiKey });
    case 'gemini':
      return new GeminiProvider({ apiKey: settings.llmGeminiApiKey });
  }
}

export function getActiveLlmModel(settings: PluginSettings): string {
  return settings.llmProviderModels[settings.llmProvider].trim();
}

export function withProviderModel(
  settings: PluginSettings,
  providerId: LlmProviderId,
  model: string,
): PluginSettings {
  return {
    ...settings,
    llmProviderModels: {
      ...settings.llmProviderModels,
      [providerId]: model.trim(),
    },
  };
}

export function withActiveProviderModel(settings: PluginSettings, model: string): PluginSettings {
  return withProviderModel(settings, settings.llmProvider, model);
}

export function formatLlmProviderName(providerId: LlmProviderId): string {
  switch (providerId) {
    case 'ollama':
      return 'Ollama';
    case 'openrouter':
      return 'OpenRouter';
    case 'gemini':
      return 'Gemini';
  }
}
