import { isRecord } from '../shared/type-guards';
import { CLEANUP_TIMEOUT_MS, fetchJson, PROBE_TIMEOUT_MS } from './http-shared';
import type {
  CleanupOptions,
  LlmProvider,
  ModelOption,
  ModelPricing,
  ProviderHealth,
} from './provider';
import { ProviderError } from './provider';

const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class OpenRouterProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? OPENROUTER_API_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? CLEANUP_TIMEOUT_MS;
  }

  async cleanup(options: CleanupOptions): Promise<string> {
    if (this.apiKey.length === 0) {
      throw new ProviderError('OpenRouter API key is not configured.', 'auth_invalid');
    }

    try {
      const response = await fetchJson(
        `${this.baseUrl}/chat/completions`,
        {
          body: JSON.stringify({
            // OpenRouter's portable output-token cap is `max_tokens`; the newer
            // `max_completion_tokens` isn't honored by every proxied provider.
            max_tokens: options.maxOutputTokens,
            messages: [
              { content: options.prompt, role: 'system' },
              { content: options.userMessage, role: 'user' },
            ],
            model: options.model,
            stream: false,
            temperature: options.temperature,
          }),
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          method: 'POST',
        },
        { abortSignal: options.abortSignal, timeoutMs: this.timeoutMs },
      );

      return parseChatContent(response);
    } catch (error) {
      throw mapOpenRouterError(error);
    }
  }

  async listModels(): Promise<ModelOption[]> {
    try {
      const response = await fetchJson(`${this.baseUrl}/models`, undefined, {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      return parseModels(response);
    } catch (error) {
      throw mapOpenRouterError(error);
    }
  }

  async probe(): Promise<ProviderHealth> {
    if (this.apiKey.length === 0) {
      return { kind: 'auth_invalid' };
    }

    // The key check and model fetch are independent; run them in parallel so
    // the worst-case status latency is one probe timeout instead of two.
    const [keyResult, modelsResult] = await Promise.allSettled([
      fetchJson(
        `${this.baseUrl}/key`,
        { headers: { authorization: `Bearer ${this.apiKey}` } },
        { timeoutMs: PROBE_TIMEOUT_MS },
      ),
      this.listModels(),
    ]);

    if (keyResult.status === 'rejected') {
      const mapped = mapOpenRouterError(keyResult.reason);
      switch (mapped.code) {
        case 'auth_invalid':
          return { kind: 'auth_invalid' };
        case 'rate_limited':
          return { kind: 'rate_limited' };
        case 'connection_failed':
        case 'timeout':
          return { kind: 'unreachable' };
        default:
          return { kind: 'unknown' };
      }
    }

    if (modelsResult.status === 'rejected') {
      const mapped = mapOpenRouterError(modelsResult.reason);
      return mapped.code === 'connection_failed' || mapped.code === 'timeout'
        ? { kind: 'unreachable' }
        : { kind: 'unknown' };
    }

    return modelsResult.value.length === 0
      ? { kind: 'no_models' }
      : { kind: 'ready', modelCount: modelsResult.value.length };
  }
}

function parseModels(response: unknown): ModelOption[] {
  if (!isRecord(response) || !Array.isArray(response.data)) {
    throw new ProviderError('OpenRouter returned an invalid model list.', 'invalid_response');
  }

  return response.data
    .map((entry): ModelOption | null => {
      // Skip a malformed entry rather than failing the whole catalog — one bad
      // model in OpenRouter's evolving list shouldn't blank the picker.
      if (!isRecord(entry) || typeof entry.id !== 'string') {
        return null;
      }

      // OpenRouter lists "~author/...-latest" alias entries that redirect to the
      // newest model in a family, but they expose no servable endpoints and 404 on
      // chat/completions, so they must never appear in the picker.
      if (entry.id.startsWith('~')) {
        return null;
      }

      // The transform only sends and expects text, so drop models that emit audio
      // or images (e.g. TTS / image generation).
      if (!isTextModel(entry)) {
        return null;
      }

      const pricing = parsePricing(entry.pricing);
      return {
        displayName:
          typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id,
        id: entry.id,
        ...(pricing !== null ? { pricing } : {}),
      };
    })
    .filter((model): model is ModelOption => model !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

// Keep text-in / text-out chat models. Multimodal models that accept images or
// audio but answer in text (e.g. vision chat) are kept; models that emit audio or
// images are dropped. Unknown modality data is kept rather than hidden.
function isTextModel(entry: Record<string, unknown>): boolean {
  if (!isRecord(entry.architecture)) {
    return true;
  }
  const { inputs, outputs } = readModalities(entry.architecture);
  // Empty modality arrays mean "unspecified", same as a missing field: keep.
  const acceptsText = inputs === null || inputs.length === 0 || inputs.includes('text');
  const textOnlyOutput =
    outputs === null || outputs.length === 0 || outputs.every((modality) => modality === 'text');
  return acceptsText && textOnlyOutput;
}

function readModalities(architecture: Record<string, unknown>): {
  inputs: string[] | null;
  outputs: string[] | null;
} {
  const inputs = toStringArray(architecture.input_modalities);
  const outputs = toStringArray(architecture.output_modalities);
  if (inputs !== null || outputs !== null) {
    return { inputs, outputs };
  }
  // Legacy single-field form, e.g. "text+image->text".
  if (typeof architecture.modality === 'string') {
    const [input, output] = architecture.modality.split('->');
    return {
      inputs: input === undefined ? null : splitModalityPart(input),
      outputs: output === undefined ? null : splitModalityPart(output),
    };
  }
  return { inputs: null, outputs: null };
}

function splitModalityPart(part: string): string[] {
  return part
    .split('+')
    .map((modality) => modality.trim())
    .filter((modality) => modality.length > 0);
}

function toStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

// OpenRouter prices are USD per token; convert to per-1M-token figures for the
// price-tier badge. Returns null when prompt/completion pricing is absent or
// malformed so the UI omits the tag rather than implying "free".
function parsePricing(value: unknown): ModelPricing | null {
  if (!isRecord(value)) {
    return null;
  }
  const input = toPerMillionUsd(value.prompt);
  const output = toPerMillionUsd(value.completion);
  if (input === null || output === null) {
    return null;
  }
  return { input, output };
}

function toPerMillionUsd(raw: unknown): number | null {
  const perToken =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(perToken) || perToken < 0) {
    return null;
  }
  return perToken * 1_000_000;
}

function parseChatContent(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new ProviderError('OpenRouter returned an invalid chat response.', 'invalid_response');
  }

  const choice: unknown = response.choices[0];
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== 'string'
  ) {
    throw new ProviderError('OpenRouter returned an invalid chat message.', 'invalid_response');
  }
  if (choice.finish_reason === 'length') {
    throw new ProviderError(
      'OpenRouter stopped because the transformed text exceeded the output limit.',
      'invalid_response',
    );
  }

  const content = choice.message.content.trim();
  if (content.length === 0) {
    throw new ProviderError('OpenRouter returned an empty chat message.', 'invalid_response');
  }
  return content;
}

function mapOpenRouterError(error: unknown): ProviderError {
  if (!(error instanceof ProviderError)) {
    return new ProviderError(
      error instanceof Error ? error.message : String(error),
      'connection_failed',
    );
  }

  if (error.code !== 'http_error') {
    return error;
  }

  if (error.status === 401) {
    return new ProviderError('OpenRouter API key rejected.', 'auth_invalid', {
      responseText: error.responseText,
      status: error.status,
    });
  }
  if (error.status === 429) {
    return new ProviderError('OpenRouter rate limit hit.', 'rate_limited', {
      responseText: error.responseText,
      status: error.status,
    });
  }
  if (error.status === 404 && /model/i.test(error.responseText ?? error.message)) {
    return new ProviderError('OpenRouter model was not found.', 'unknown_model', {
      responseText: error.responseText,
      status: error.status,
    });
  }

  return error;
}
