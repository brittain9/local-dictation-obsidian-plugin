import { isRecord } from '../shared/type-guards';
import { CLEANUP_TIMEOUT_MS, fetchJson, PROBE_TIMEOUT_MS } from './http-shared';
import { ProviderError } from './provider';

interface OpenAiChatClientOptions {
  apiKey: string;
  baseUrl: string;
  providerName: string;
  timeoutMs?: number;
}

interface JsonRequestOptions {
  abortSignal?: AbortSignal;
  includeAuthorization?: boolean;
  timeoutMs?: number;
}

export class OpenAiChatClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly providerName: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAiChatClientOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.providerName = options.providerName;
    this.timeoutMs = options.timeoutMs ?? CLEANUP_TIMEOUT_MS;
  }

  async chatCompletion(options: {
    abortSignal?: AbortSignal;
    maxOutputTokens: number;
    model: string;
    prompt: string;
    temperature: number;
    userMessage: string;
  }): Promise<string> {
    const response = await this.requestJson(
      '/chat/completions',
      {
        body: JSON.stringify({
          max_tokens: options.maxOutputTokens,
          messages: [
            { content: options.prompt, role: 'system' },
            { content: options.userMessage, role: 'user' },
          ],
          model: options.model,
          stream: false,
          temperature: options.temperature,
        }),
        method: 'POST',
      },
      options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal },
    );
    return parseChatContent(response, this.providerName);
  }

  async getJson(
    path: string,
    options: JsonRequestOptions = { timeoutMs: PROBE_TIMEOUT_MS },
  ): Promise<unknown> {
    return this.requestJson(path, {}, options);
  }

  private requestJson(
    path: string,
    init: RequestInit,
    options: JsonRequestOptions,
  ): Promise<unknown> {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    if (init.body !== undefined && init.body !== null) {
      headers['content-type'] = 'application/json';
    }
    if (options.includeAuthorization !== false && this.apiKey.length > 0) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    return fetchJson(
      `${this.baseUrl}${path}`,
      { ...init, headers },
      {
        ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
      },
    );
  }
}

function parseChatContent(response: unknown, providerName: string): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new ProviderError(
      `${providerName} returned an invalid chat response.`,
      'invalid_response',
    );
  }

  const choice: unknown = response.choices[0];
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== 'string'
  ) {
    throw new ProviderError(
      `${providerName} returned an invalid chat message.`,
      'invalid_response',
    );
  }
  if (choice.finish_reason === 'length') {
    throw new ProviderError(
      `${providerName} stopped because the transformed text exceeded the output limit.`,
      'invalid_response',
    );
  }

  const content = choice.message.content.trim();
  if (content.length === 0) {
    throw new ProviderError(`${providerName} returned an empty chat message.`, 'invalid_response');
  }
  return content;
}
