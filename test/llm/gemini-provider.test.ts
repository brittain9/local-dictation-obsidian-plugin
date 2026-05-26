import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from '../../src/llm/gemini-provider';
import { MAX_RESPONSE_BYTES } from '../../src/llm/http-shared';
import type { ProviderError } from '../../src/llm/provider';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GeminiProvider', () => {
  it('posts the native generateContent request and parses text parts', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: '  Cleaned ' }, { text: 'text.  ' }] } }],
      }),
    );

    await expect(cleanup()).resolves.toBe('Cleaned text.');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://gemini.test/v1beta/models/gemini-2.5-flash:generateContent');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-goog-api-key': 'AIza-test',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [{ parts: [{ text: '<utterance>raw</utterance>' }], role: 'user' }],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.2,
      },
      systemInstruction: { parts: [{ text: 'Clean it.' }] },
    });
  });

  it('lists only models that support generateContent', async () => {
    mockFetch(async () =>
      jsonResponse({
        models: [
          {
            displayName: 'Embedding',
            name: 'models/text-embedding-004',
            supportedGenerationMethods: ['embedContent'],
          },
          {
            displayName: 'Flash',
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }),
    );

    await expect(
      new GeminiProvider({
        apiKey: 'AIza-test',
        baseUrl: 'https://gemini.test/v1beta',
      }).listModels(),
    ).resolves.toEqual([{ displayName: 'Flash', id: 'gemini-2.5-flash' }]);
  });

  it.each([
    {
      body: { error: { status: 'API_KEY_INVALID' } },
      code: 'auth_invalid',
      status: 400,
    },
    { body: { error: { message: 'missing model' } }, code: 'unknown_model', status: 404 },
    { body: { error: { message: 'quota' } }, code: 'rate_limited', status: 429 },
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
  return new GeminiProvider({
    apiKey: 'AIza-test',
    baseUrl: 'https://gemini.test/v1beta',
  }).cleanup({
    ...(abortSignal !== undefined ? { abortSignal } : {}),
    model: 'models/gemini-2.5-flash',
    prompt: 'Clean it.',
    temperature: 0.2,
    userMessage: '<utterance>raw</utterance>',
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
