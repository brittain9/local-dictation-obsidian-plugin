export const LLM_PROVIDER_IDS = ['ollama', 'openrouter', 'openai_compatible'] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === 'string' && (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

export type LlmRoutingPolicy =
  | { kind: 'fixed'; providerId: LlmProviderId }
  | {
      defaultProviderId: LlmProviderId;
      kind: 'transcript_size';
      largeTranscriptProviderId: LlmProviderId;
      thresholdChars: number;
    };

export interface LlmProviderConfigurations {
  ollama: { model: string };
  openrouter: { model: string; secretId: string };
  openai_compatible: { baseUrl: string; model: string; secretId: string };
}

export type ProviderErrorCode =
  | 'aborted'
  | 'auth_invalid'
  | 'connection_failed'
  | 'http_error'
  | 'invalid_response'
  | 'model_not_configured'
  | 'permission_denied'
  | 'rate_limited'
  | 'timeout'
  | 'unknown_model';

export type ProviderHealth =
  | { kind: 'unknown' }
  | { kind: 'unreachable' }
  | { kind: 'auth_invalid' }
  | { kind: 'permission_denied' }
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

export function getProviderModel(
  configurations: LlmProviderConfigurations,
  providerId: LlmProviderId,
): string {
  return configurations[providerId].model.trim();
}

export function withProviderConfigurationModel(
  configurations: LlmProviderConfigurations,
  providerId: LlmProviderId,
  model: string,
): LlmProviderConfigurations {
  return {
    ...configurations,
    [providerId]: { ...configurations[providerId], model: model.trim() },
  };
}

export function withProviderSecretId(
  configurations: LlmProviderConfigurations,
  providerId: 'openrouter' | 'openai_compatible',
  secretId: string,
): LlmProviderConfigurations {
  return {
    ...configurations,
    [providerId]: { ...configurations[providerId], secretId: secretId.trim() },
  };
}

export function withOpenAiCompatibleBaseUrl(
  configurations: LlmProviderConfigurations,
  baseUrl: string,
): LlmProviderConfigurations {
  return {
    ...configurations,
    openai_compatible: {
      ...configurations.openai_compatible,
      baseUrl: baseUrl.trim().replace(/\/+$/u, ''),
    },
  };
}

export function formatLlmProviderName(providerId: LlmProviderId): string {
  switch (providerId) {
    case 'ollama':
      return 'Ollama';
    case 'openrouter':
      return 'OpenRouter';
    case 'openai_compatible':
      return 'Custom endpoint';
  }
}
