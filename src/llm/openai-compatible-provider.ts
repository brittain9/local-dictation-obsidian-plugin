import { formatErrorMessage } from '../shared/format-utils';
import { isRecord } from '../shared/type-guards';
import { PROBE_TIMEOUT_MS } from './http-shared';
import { OpenAiChatClient } from './openai-chat-client';
import {
  type OpenAiCompatibleBaseUrlValidation,
  validateOpenAiCompatibleBaseUrl,
} from './openai-compatible-url';
import type { CleanupOptions, LlmProvider, ModelOption, ProviderHealth } from './provider';
import { ProviderError } from './provider';

interface OpenAiCompatibleProviderOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = 'openai_compatible' as const;
  private readonly client: OpenAiChatClient;

  constructor(options: OpenAiCompatibleProviderOptions) {
    const validation = validateOpenAiCompatibleBaseUrl(options.baseUrl);
    if (!validation.valid) {
      throw new ProviderError(baseUrlValidationMessage(validation.code), 'connection_failed');
    }
    this.client = new OpenAiChatClient({
      apiKey: options.apiKey,
      baseUrl: validation.normalizedUrl,
      providerName: 'Custom endpoint',
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  async cleanup(options: CleanupOptions): Promise<string> {
    try {
      return await this.client.chatCompletion(options);
    } catch (error) {
      throw mapOpenAiCompatibleError(error);
    }
  }

  async listModels(): Promise<ModelOption[]> {
    try {
      const response = await this.client.getJson('/models', { timeoutMs: PROBE_TIMEOUT_MS });
      return parseModels(response);
    } catch (error) {
      throw mapOpenAiCompatibleError(error);
    }
  }

  async probe(): Promise<ProviderHealth> {
    try {
      const models = await this.listModels();
      return models.length === 0
        ? { kind: 'no_models' }
        : { kind: 'ready', modelCount: models.length };
    } catch (error) {
      const mapped = mapOpenAiCompatibleError(error);
      switch (mapped.code) {
        case 'auth_invalid':
          return { kind: 'auth_invalid' };
        case 'permission_denied':
          return { kind: 'permission_denied' };
        case 'rate_limited':
          return { kind: 'rate_limited' };
        case 'connection_failed':
        case 'timeout':
          return { kind: 'unreachable' };
        default:
          return { kind: 'unknown' };
      }
    }
  }
}

function baseUrlValidationMessage(
  code: Exclude<OpenAiCompatibleBaseUrlValidation, { valid: true }>['code'],
): string {
  switch (code) {
    case 'empty':
      return 'OpenAI-compatible base URL is not configured.';
    case 'not_absolute':
      return 'OpenAI-compatible base URL is not absolute.';
    case 'scheme':
      return 'OpenAI-compatible base URL must use HTTP or HTTPS.';
    case 'credentials':
      return 'OpenAI-compatible base URL cannot contain credentials.';
    case 'query_or_fragment':
      return 'OpenAI-compatible base URL cannot contain a query string or fragment.';
  }
}

function parseModels(response: unknown): ModelOption[] {
  if (!isRecord(response) || !Array.isArray(response.data)) {
    throw new ProviderError('Custom endpoint returned an invalid model list.', 'invalid_response');
  }
  return response.data
    .map((entry): ModelOption | null => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.trim().length === 0) {
        return null;
      }
      const id = entry.id.trim();
      return { displayName: id, id };
    })
    .filter((model): model is ModelOption => model !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function mapOpenAiCompatibleError(error: unknown): ProviderError {
  if (!(error instanceof ProviderError)) {
    return new ProviderError(formatErrorMessage(error), 'connection_failed');
  }
  if (error.code !== 'http_error') {
    return error;
  }

  const details = { responseText: error.responseText, status: error.status };
  if (error.status === 401) {
    return new ProviderError('Custom endpoint API key rejected.', 'auth_invalid', details);
  }
  if (error.status === 403) {
    return new ProviderError('Custom endpoint denied access.', 'permission_denied', details);
  }
  if (error.status === 429) {
    return new ProviderError('Custom endpoint rate limit hit.', 'rate_limited', details);
  }
  if (error.status === 404 && /model/i.test(error.responseText ?? error.message)) {
    return new ProviderError('Custom endpoint model was not found.', 'unknown_model', details);
  }
  return error;
}
