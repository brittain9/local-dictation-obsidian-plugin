import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_RESPONSE_BYTES } from '../../src/llm/http-shared';
import { OpenAiCompatibleProvider } from '../../src/llm/openai-compatible-provider';
import { validateOpenAiCompatibleBaseUrl } from '../../src/llm/openai-compatible-url';
import type { ProviderError } from '../../src/llm/provider';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validateOpenAiCompatibleBaseUrl', () => {
  it.each([
    ['', false],
    ['localhost:1234/v1', false],
    ['ftp://localhost/v1', false],
    ['https://user:password@example.com/v1', false],
    ['https://example.com/v1?key=value', false],
    ['https://example.com/v1#models', false],
    ['http://localhost:1234/v1/', true],
  ] as const)('validates %s', (value, valid) => {
    expect(validateOpenAiCompatibleBaseUrl(value).valid).toBe(valid);
  });

  it('normalizes whitespace and trailing slashes without adding a version path', () => {
    expect(validateOpenAiCompatibleBaseUrl(' https://example.com/openai/ ')).toEqual({
      normalizedUrl: 'https://example.com/openai',
      valid: true,
    });
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('posts the Chat Completions subset to the exact configured base path', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({ choices: [{ message: { content: '  Cleaned text.  ' } }] }),
    );
    const endpoint = provider({ apiKey: '', baseUrl: ' http://localhost:1234/v1/ ' });

    await expect(endpoint.cleanup(cleanupOptions())).resolves.toBe('Cleaned text.');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(init?.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(String(init?.body))).toEqual({
      max_tokens: 4096,
      messages: [
        { content: 'Clean it.', role: 'system' },
        { content: '<utterance>raw</utterance>', role: 'user' },
      ],
      model: 'local-model',
      stream: false,
      temperature: 0.2,
    });
  });

  it('sends optional bearer authentication when configured', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );

    await provider({ apiKey: ' secret ' }).cleanup(cleanupOptions());

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer secret',
    });
  });

  it('discovers model IDs while skipping malformed entries', async () => {
    mockFetch(async () =>
      jsonResponse({ data: [{ id: 'z-model' }, null, { id: '' }, { id: 'a-model' }] }),
    );

    await expect(provider().listModels()).resolves.toEqual([
      { displayName: 'a-model', id: 'a-model' },
      { displayName: 'z-model', id: 'z-model' },
    ]);
  });

  it.each([
    { code: 'auth_invalid', status: 401 },
    { code: 'permission_denied', status: 403 },
    { code: 'unknown_model', status: 404 },
    { code: 'rate_limited', status: 429 },
  ] as const)('maps HTTP $status to $code', async ({ code, status }) => {
    mockFetch(async () => jsonResponse({ error: 'model access error' }, status));

    await expect(provider().cleanup(cleanupOptions())).rejects.toMatchObject({
      code,
      name: 'ProviderError',
      status,
    } satisfies Partial<ProviderError>);
  });

  it.each([
    [{ choices: [] }, 'invalid_response'],
    [{ choices: [{ message: { content: '' } }] }, 'invalid_response'],
    [
      { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
      'invalid_response',
    ],
  ] as const)('rejects malformed, empty, or truncated chat output', async (body, code) => {
    mockFetch(async () => jsonResponse(body));

    await expect(provider().cleanup(cleanupOptions())).rejects.toMatchObject({ code });
  });

  it('honors caller abort signals', async () => {
    mockFetch((_url, init) => rejectWhenAborted(init));
    const controller = new AbortController();
    const promise = provider().cleanup({ ...cleanupOptions(), abortSignal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: 'aborted' });
  });

  it('honors the configured network timeout', async () => {
    vi.useFakeTimers();
    mockFetch((_url, init) => rejectWhenAborted(init));
    const promise = provider({ timeoutMs: 5_000 }).cleanup(cleanupOptions());
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });

    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
  });

  it('enforces the shared response byte cap', async () => {
    mockFetch(async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), { status: 200 }));

    await expect(provider().cleanup(cleanupOptions())).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

function provider(
  overrides: Partial<ConstructorParameters<typeof OpenAiCompatibleProvider>[0]> = {},
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    apiKey: '',
    baseUrl: 'https://example.com/v1',
    ...overrides,
  });
}

function cleanupOptions() {
  return {
    maxOutputTokens: 4096,
    model: 'local-model',
    prompt: 'Clean it.',
    temperature: 0.2,
    userMessage: '<utterance>raw</utterance>',
  };
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
