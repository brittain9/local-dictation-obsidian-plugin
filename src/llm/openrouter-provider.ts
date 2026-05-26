import { isRecord } from '../shared/type-guards';
import { fetchJson, PROBE_TIMEOUT_MS } from './http-shared';
import type { CleanupOptions, LlmProvider, ModelOption, ProviderHealth } from './provider';
import { ProviderError } from './provider';

const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_TOKENS = 512;

interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

export class OpenRouterProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? OPENROUTER_API_BASE_URL;
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
            max_tokens: MAX_TOKENS,
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
        { abortSignal: options.abortSignal },
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

    try {
      await fetchJson(
        `${this.baseUrl}/key`,
        { headers: { authorization: `Bearer ${this.apiKey}` } },
        { timeoutMs: PROBE_TIMEOUT_MS },
      );
    } catch (error) {
      const mapped = mapOpenRouterError(error);
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

    try {
      const models = await this.listModels();
      return models.length === 0
        ? { kind: 'no_models' }
        : { kind: 'ready', modelCount: models.length };
    } catch (error) {
      const mapped = mapOpenRouterError(error);
      return mapped.code === 'connection_failed' || mapped.code === 'timeout'
        ? { kind: 'unreachable' }
        : { kind: 'unknown' };
    }
  }
}

function parseModels(response: unknown): ModelOption[] {
  if (!isRecord(response) || !Array.isArray(response.data)) {
    throw new ProviderError('OpenRouter returned an invalid model list.', 'invalid_response');
  }

  return response.data
    .map((entry): ModelOption => {
      if (!isRecord(entry) || typeof entry.id !== 'string') {
        throw new ProviderError('OpenRouter returned an invalid model entry.', 'invalid_response');
      }

      return {
        displayName:
          typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id,
        id: entry.id,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function parseChatContent(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new ProviderError('OpenRouter returned an invalid chat response.', 'invalid_response');
  }

  const choice = response.choices[0];
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== 'string'
  ) {
    throw new ProviderError('OpenRouter returned an invalid chat message.', 'invalid_response');
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
