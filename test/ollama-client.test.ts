import http from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createOllamaClient, type OllamaClientError } from '../src/llm/ollama-client';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe('Ollama client', () => {
  it('probes /api/version successfully', async () => {
    const { port } = await startServer((_request, response) => {
      response.end(JSON.stringify({ version: '0.5.0' }));
    });

    await expect(createOllamaClient({ port }).probeOllama()).resolves.toBeUndefined();
  });

  it('lists chat models filtered and sorted by display name', async () => {
    const { port } = await startServer((_request, response) => {
      response.end(
        JSON.stringify({
          models: [
            { model: 'zeta:latest', name: 'Zeta' },
            { model: 'nomic-embed-text:latest', name: 'nomic embed text' },
            { model: 'alpha:latest', name: 'Alpha' },
            { model: 'bge-large:latest', name: 'BGE Large' },
          ],
        }),
      );
    });

    await expect(createOllamaClient({ port }).listOllamaModels()).resolves.toEqual([
      { displayName: 'Alpha', id: 'alpha:latest' },
      { displayName: 'Zeta', id: 'zeta:latest' },
    ]);
  });

  it('surfaces malformed JSON and HTTP failures as typed errors', async () => {
    const malformed = await startServer((_request, response) => {
      response.end('{not json');
    });
    const failing = await startServer((_request, response) => {
      response.statusCode = 500;
      response.end('nope');
    });

    await expect(createOllamaClient({ port: malformed.port }).probeOllama()).rejects.toMatchObject({
      code: 'invalid_response',
      name: 'OllamaClientError',
    } satisfies Partial<OllamaClientError>);
    await expect(createOllamaClient({ port: failing.port }).probeOllama()).rejects.toMatchObject({
      code: 'http_error',
      name: 'OllamaClientError',
    } satisfies Partial<OllamaClientError>);
  });

  it('prewarms with one-token chat request and tolerates non-2xx responses', async () => {
    const bodies: unknown[] = [];
    const { port } = await startServer(async (request, response) => {
      bodies.push(JSON.parse(await readBody(request)));
      response.statusCode = 503;
      response.end('busy');
    });

    await expect(
      createOllamaClient({ port }).prewarmModel('llama3.2:latest'),
    ).resolves.toBeUndefined();
    expect(bodies).toEqual([
      {
        keep_alive: '30m',
        messages: [{ content: 'ok', role: 'user' }],
        model: 'llama3.2:latest',
        options: { num_predict: 1 },
        stream: false,
        think: false,
      },
    ]);
  });

  it('cleanup posts the expected chat payload and parses message content', async () => {
    const bodies: unknown[] = [];
    const { port } = await startServer(async (request, response) => {
      bodies.push(JSON.parse(await readBody(request)));
      response.end(JSON.stringify({ message: { content: '  Cleaned text.  ' } }));
    });

    await expect(
      createOllamaClient({ port }).cleanup({
        model: 'llama3.2:latest',
        prompt: 'Clean this.',
        temperature: 0.2,
        userMessage: '<session_transcript>raw</session_transcript>',
      }),
    ).resolves.toBe('Cleaned text.');
    expect(bodies).toEqual([
      {
        keep_alive: '30m',
        messages: [
          { content: 'Clean this.', role: 'system' },
          { content: '<session_transcript>raw</session_transcript>', role: 'user' },
        ],
        model: 'llama3.2:latest',
        options: { num_predict: 4096, temperature: 0.2 },
        stream: false,
        think: false,
      },
    ]);
  });

  it('rejects truncated cleanup output instead of returning partial text', async () => {
    const { port } = await startServer((_request, response) => {
      response.end(
        JSON.stringify({ done_reason: 'length', message: { content: 'Partial cleaned text' } }),
      );
    });

    await expect(
      createOllamaClient({ port }).cleanup({
        model: 'llama3.2:latest',
        prompt: 'Clean this.',
        temperature: 0.2,
        userMessage: '<session_transcript>raw</session_transcript>',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      name: 'OllamaClientError',
    } satisfies Partial<OllamaClientError>);
  });

  it('cleanup aborts via the supplied signal', async () => {
    const { port } = await startServer((_request, _response) => {
      // Keep the request open until the client aborts.
    });
    const controller = new AbortController();
    const promise = createOllamaClient({ port }).cleanup({
      abortSignal: controller.signal,
      model: 'llama3.2:latest',
      prompt: 'Clean this.',
      temperature: 0.2,
      userMessage: 'raw',
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: 'connection_failed',
      name: 'OllamaClientError',
    } satisfies Partial<OllamaClientError>);
  });
});

async function startServer(
  handler: http.RequestListener,
): Promise<{ port: number; server: http.Server }> {
  const server = http.createServer(handler);
  servers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected TCP server address.');
  }

  return { port: address.port, server };
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}
