import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_RESPONSE_BYTES } from '../../src/llm/http-shared';
import { OpenRouterProvider } from '../../src/llm/openrouter-provider';
import type { ProviderError } from '../../src/llm/provider';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenRouterProvider', () => {
  it('posts the OpenAI-compatible cleanup request and parses message content', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({ choices: [{ message: { content: '  Cleaned text.  ' } }] }),
    );
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      baseUrl: 'https://openrouter.test/api/v1',
    });

    await expect(
      provider.cleanup({
        model: 'anthropic/claude-sonnet-4.5',
        prompt: 'Clean it.',
        temperature: 0.2,
        userMessage: '<utterance>raw</utterance>',
      }),
    ).resolves.toBe('Cleaned text.');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.test/api/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer sk-or-test',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      max_tokens: 4096,
      messages: [
        { content: 'Clean it.', role: 'system' },
        { content: '<utterance>raw</utterance>', role: 'user' },
      ],
      model: 'anthropic/claude-sonnet-4.5',
      stream: false,
      temperature: 0.2,
    });
  });

  it('scales max_tokens with the input so a long transcript is not capped at the floor', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      baseUrl: 'https://openrouter.test/api/v1',
    });

    await provider.cleanup({
      model: 'anthropic/claude-sonnet-4.5',
      prompt: 'Clean it.',
      temperature: 0.2,
      userMessage: 'x'.repeat(40_000),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body)).max_tokens).toBe(15_000);
  });

  it('rejects truncated responses instead of returning partial transformed text', async () => {
    mockFetch(async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'length',
            message: { content: 'Partial transformed text' },
          },
        ],
      }),
    );

    await expect(cleanup()).rejects.toMatchObject({
      code: 'invalid_response',
      name: 'ProviderError',
    } satisfies Partial<ProviderError>);
  });

  it('lists text models with pricing and drops audio/image models', async () => {
    mockFetch(async () =>
      jsonResponse({
        data: [
          {
            id: 'z/model',
            name: 'Zed',
            pricing: { completion: '0.000015', prompt: '0.000003' },
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          },
          // No architecture data: kept rather than hidden.
          { id: 'a/model' },
          // Vision chat: image input but text output -> kept.
          {
            id: 'm/vision',
            name: 'Multi',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          },
          // Emits audio -> dropped.
          {
            id: 'x/audio',
            name: 'Audible',
            architecture: {
              input_modalities: ['text', 'audio'],
              output_modalities: ['text', 'audio'],
            },
          },
        ],
      }),
    );

    await expect(
      new OpenRouterProvider({
        apiKey: '',
        baseUrl: 'https://openrouter.test/api/v1',
      }).listModels(),
    ).resolves.toEqual([
      { displayName: 'a/model', id: 'a/model' },
      { displayName: 'Multi', id: 'm/vision' },
      { displayName: 'Zed', id: 'z/model', pricing: { input: 3, output: 15 } },
    ]);
  });

  it.each([
    { body: { error: 'bad key' }, code: 'auth_invalid', status: 401 },
    { body: { error: 'slow down' }, code: 'rate_limited', status: 429 },
    { body: { error: 'model not found' }, code: 'unknown_model', status: 404 },
  ] as const)('maps HTTP $status to $code', async ({ body, code, status }) => {
    mockFetch(async () => jsonResponse(body, status));

    await expect(cleanup()).rejects.toMatchObject({
      code,
      name: 'ProviderError',
    } satisfies Partial<ProviderError>);
  });

  it('maps network failures to connection_failed', async () => {
    mockFetch(async () => {
      throw new TypeError('socket closed');
    });

    await expect(cleanup()).rejects.toMatchObject({
      code: 'connection_failed',
      name: 'ProviderError',
    } satisfies Partial<ProviderError>);
  });

  it('maps cleanup timeout to timeout', async () => {
    vi.useFakeTimers();
    mockFetch((_url, init) => rejectWhenAborted(init));

    const promise = cleanup();
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'timeout',
      name: 'ProviderError',
    } satisfies Partial<ProviderError>);
    await vi.advanceTimersByTimeAsync(60_000);

    await assertion;
  });

  it('propagates caller abort signals', async () => {
    mockFetch((_url, init) => rejectWhenAborted(init));
    const controller = new AbortController();

    const promise = cleanup(controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: 'connection_failed',
      name: 'ProviderError',
    } satisfies Partial<ProviderError>);
  });

  it('enforces the shared response byte cap', async () => {
    mockFetch(
      async () =>
        new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), {
          status: 200,
        }),
    );

    await expect(cleanup()).rejects.toMatchObject({
      code: 'invalid_response',
      name: 'ProviderError',
    } satisfies Partial<ProviderError>);
  });
});

function cleanup(abortSignal?: AbortSignal): Promise<string> {
  return new OpenRouterProvider({
    apiKey: 'sk-or-test',
    baseUrl: 'https://openrouter.test/api/v1',
  }).cleanup({
    ...(abortSignal !== undefined ? { abortSignal } : {}),
    model: 'anthropic/claude-sonnet-4.5',
    prompt: 'Clean it.',
    temperature: 0.2,
    userMessage: 'raw',
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function mockFetch(
  implementation: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function rejectWhenAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}
