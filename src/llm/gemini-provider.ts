import { isRecord } from '../shared/type-guards';
import { fetchJson, PROBE_TIMEOUT_MS } from './http-shared';
import type { CleanupOptions, LlmProvider, ModelOption, ProviderHealth } from './provider';
import { ProviderError } from './provider';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_OUTPUT_TOKENS = 512;

interface GeminiProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? GEMINI_API_BASE_URL;
  }

  async cleanup(options: CleanupOptions): Promise<string> {
    if (this.apiKey.length === 0) {
      throw new ProviderError('Gemini API key is not configured.', 'auth_invalid');
    }

    try {
      const response = await fetchJson(
        this.modelUrl(options.model, ':generateContent'),
        {
          body: JSON.stringify({
            contents: [{ parts: [{ text: options.userMessage }], role: 'user' }],
            generationConfig: {
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              temperature: options.temperature,
            },
            systemInstruction: { parts: [{ text: options.prompt }] },
          }),
          headers: this.authHeaders({ 'content-type': 'application/json' }),
          method: 'POST',
        },
        { abortSignal: options.abortSignal },
      );

      return parseGenerateContent(response);
    } catch (error) {
      throw mapGeminiError(error);
    }
  }

  async listModels(): Promise<ModelOption[]> {
    if (this.apiKey.length === 0) {
      throw new ProviderError('Gemini API key is not configured.', 'auth_invalid');
    }

    try {
      const response = await fetchJson(
        `${this.baseUrl}/models`,
        { headers: this.authHeaders() },
        {
          timeoutMs: PROBE_TIMEOUT_MS,
        },
      );
      return parseModels(response);
    } catch (error) {
      throw mapGeminiError(error);
    }
  }

  async probe(): Promise<ProviderHealth> {
    try {
      const models = await this.listModels();
      return models.length === 0
        ? { kind: 'no_models' }
        : { kind: 'ready', modelCount: models.length };
    } catch (error) {
      const mapped = mapGeminiError(error);
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
  }

  private modelUrl(model: string, methodSuffix: string): string {
    return `${this.baseUrl}/models/${encodeURIComponent(normalizeModelId(model))}${methodSuffix}`;
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { ...extra, 'x-goog-api-key': this.apiKey };
  }
}

function parseModels(response: unknown): ModelOption[] {
  if (!isRecord(response) || !Array.isArray(response.models)) {
    throw new ProviderError('Gemini returned an invalid model list.', 'invalid_response');
  }

  return response.models
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter(
      (entry) =>
        Array.isArray(entry.supportedGenerationMethods) &&
        entry.supportedGenerationMethods.includes('generateContent'),
    )
    .map((entry): ModelOption => {
      if (typeof entry.name !== 'string') {
        throw new ProviderError('Gemini returned an invalid model entry.', 'invalid_response');
      }
      const id = normalizeModelId(entry.name);
      return {
        displayName:
          typeof entry.displayName === 'string' && entry.displayName.length > 0
            ? entry.displayName
            : id,
        id,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function parseGenerateContent(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.candidates)) {
    throw new ProviderError('Gemini returned an invalid generation response.', 'invalid_response');
  }

  const candidate = response.candidates[0];
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.content) ||
    !Array.isArray(candidate.content.parts)
  ) {
    throw new ProviderError('Gemini returned an invalid generation candidate.', 'invalid_response');
  }

  const content = candidate.content.parts
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (content.length === 0) {
    throw new ProviderError('Gemini returned empty generated content.', 'invalid_response');
  }

  return content;
}

function normalizeModelId(model: string): string {
  return model.trim().replace(/^models\//u, '');
}

function mapGeminiError(error: unknown): ProviderError {
  if (!(error instanceof ProviderError)) {
    return new ProviderError(
      error instanceof Error ? error.message : String(error),
      'connection_failed',
    );
  }

  if (error.code !== 'http_error') {
    return error;
  }

  if (
    error.status === 401 ||
    error.status === 403 ||
    (error.status === 400 && /API_KEY_INVALID|API key not valid/i.test(error.responseText ?? ''))
  ) {
    return new ProviderError('Gemini API key rejected.', 'auth_invalid', {
      responseText: error.responseText,
      status: error.status,
    });
  }
  if (error.status === 404) {
    return new ProviderError('Gemini model was not found.', 'unknown_model', {
      responseText: error.responseText,
      status: error.status,
    });
  }
  if (error.status === 429) {
    return new ProviderError('Gemini rate limit hit.', 'rate_limited', {
      responseText: error.responseText,
      status: error.status,
    });
  }

  return error;
}
