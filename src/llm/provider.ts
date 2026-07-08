import type { PluginSettings } from '../settings/plugin-settings';
import { OllamaProvider } from './ollama-provider';
import { OpenRouterProvider } from './openrouter-provider';

export const LLM_PROVIDER_IDS = ['ollama', 'openrouter'] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export const LLM_ROUTINGS = ['local', 'remote', 'auto'] as const;

export type LlmRouting = (typeof LLM_ROUTINGS)[number];

export function isLlmRouting(value: unknown): value is LlmRouting {
  return typeof value === 'string' && (LLM_ROUTINGS as readonly string[]).includes(value);
}

export type ProviderErrorCode =
  | 'aborted'
  | 'auth_invalid'
  | 'connection_failed'
  | 'http_error'
  | 'invalid_response'
  | 'model_not_configured'
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

export interface ModelPricing {
  /** USD per 1M prompt (input) tokens. */
  input: number;
  /** USD per 1M completion (output) tokens. */
  output: number;
}

export interface ModelOption {
  displayName: string;
  id: string;
  pricing?: ModelPricing;
}

export interface CleanupOptions {
  abortSignal?: AbortSignal;
  /** Output-token cap computed by the router (see output-budget). */
  maxOutputTokens: number;
  model: string;
  prompt: string;
  temperature: number;
  userMessage: string;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  cleanup(options: CleanupOptions): Promise<string>;
  listModels(): Promise<ModelOption[]>;
  /** Best-effort warm-up; only local providers (Ollama) implement it. */
  prewarmModel?(modelId: string): Promise<void>;
  probe(): Promise<ProviderHealth>;
}

export type LlmProviderModels = Record<LlmProviderId, string>;

export interface LlmCleanupFailure {
  code: ProviderErrorCode;
  message: string;
  providerId: LlmProviderId;
}

export class ProviderError extends Error {
  readonly responseText?: string;
  readonly status?: number;
  // Set by the router so failures are attributed to the provider that was
  // actually routed to, even if routing inputs changed mid-call.
  providerId?: LlmProviderId;

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

export function createProvider(
  providerId: LlmProviderId,
  settings: PluginSettings,
  openRouterApiKey = '',
): LlmProvider {
  switch (providerId) {
    case 'ollama':
      return new OllamaProvider();
    case 'openrouter':
      return new OpenRouterProvider({
        apiKey: openRouterApiKey,
        timeoutMs: settings.llmRemoteTimeoutSec * 1000,
      });
  }
}

export function getProviderModel(settings: PluginSettings, providerId: LlmProviderId): string {
  return settings.llmProviderModels[providerId].trim();
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

// Pure size-based routing: 'local' always picks Ollama, 'remote' always picks
// OpenRouter, and 'auto' escalates to OpenRouter once the *transcript*
// exceeds the configured character threshold (local models choke on large
// contexts). This deliberately ignores the full prompt/user-message size,
// which also carries note/prior-utterance context: the UI promises that Auto
// only sends large transcripts to OpenRouter, and a short dictation must not
// escalate just because it happens to have a large note attached.
export function selectRouteProviderId(
  routing: LlmRouting,
  transcriptChars: number,
  thresholdChars: number,
): LlmProviderId {
  switch (routing) {
    case 'local':
      return 'ollama';
    case 'remote':
      return 'openrouter';
    case 'auto':
      return transcriptChars <= thresholdChars ? 'ollama' : 'openrouter';
  }
}

export function formatLlmProviderName(providerId: LlmProviderId): string {
  switch (providerId) {
    case 'ollama':
      return 'Ollama';
    case 'openrouter':
      return 'OpenRouter';
  }
}
