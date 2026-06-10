import http from 'node:http';

import { isRecord } from '../shared/type-guards';
import { CLEANUP_TIMEOUT_MS, MAX_RESPONSE_BYTES, PROBE_TIMEOUT_MS } from './http-shared';
import { outputTokenBudget } from './output-budget';

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
export const OLLAMA_KEEP_ALIVE = '30m';
const NON_CHAT_MODEL_PATTERN = /embed|embedding|bge|nomic|clip/i;

interface OllamaClientOptions {
  host?: string;
  port?: number;
}

interface OllamaRequestOptions extends OllamaClientOptions {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export interface OllamaModelOption {
  displayName: string;
  id: string;
}

export class OllamaClientError extends Error {
  readonly responseText?: string;
  readonly status?: number;

  constructor(
    message: string,
    public readonly code:
      | 'aborted'
      | 'connection_failed'
      | 'http_error'
      | 'invalid_response'
      | 'timeout',
    options: { responseText?: string | undefined; status?: number | undefined } = {},
  ) {
    super(message);
    this.name = 'OllamaClientError';
    if (options.responseText !== undefined) {
      this.responseText = options.responseText;
    }
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export interface OllamaClient {
  cleanup(options: OllamaCleanupOptions): Promise<string>;
  listOllamaModels(): Promise<OllamaModelOption[]>;
  prewarmModel(modelId: string): Promise<void>;
  probeOllama(): Promise<void>;
}

export interface OllamaCleanupOptions {
  abortSignal?: AbortSignal;
  model: string;
  prompt: string;
  temperature: number;
  userMessage: string;
}

export function createOllamaClient(options: OllamaClientOptions = {}): OllamaClient {
  const host = options.host ?? OLLAMA_HOST;
  const port = options.port ?? OLLAMA_PORT;

  return {
    cleanup: (cleanupOptions) => cleanup(cleanupOptions, { host, port }),
    listOllamaModels: () => listOllamaModels({ host, port }),
    prewarmModel: (modelId) => prewarmModel(modelId, { host, port }),
    probeOllama: () => probeOllama({ host, port }),
  };
}

async function probeOllama(options: OllamaClientOptions = {}): Promise<void> {
  const response = await requestJson('GET', '/api/version', undefined, options);

  if (!isRecord(response) || typeof response.version !== 'string') {
    throw new OllamaClientError('Ollama returned an invalid version response.', 'invalid_response');
  }
}

async function listOllamaModels(options: OllamaClientOptions = {}): Promise<OllamaModelOption[]> {
  const response = await requestJson('GET', '/api/tags', undefined, options);

  if (!isRecord(response) || !Array.isArray(response.models)) {
    throw new OllamaClientError('Ollama returned an invalid model list.', 'invalid_response');
  }

  return response.models
    .map((entry): OllamaModelOption => {
      if (!isRecord(entry) || typeof entry.model !== 'string' || typeof entry.name !== 'string') {
        throw new OllamaClientError('Ollama returned an invalid model entry.', 'invalid_response');
      }

      return { displayName: entry.name, id: entry.model };
    })
    .filter((model) => !NON_CHAT_MODEL_PATTERN.test(model.displayName))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

async function prewarmModel(modelId: string, options: OllamaClientOptions = {}): Promise<void> {
  try {
    await requestJson(
      'POST',
      '/api/chat',
      {
        keep_alive: OLLAMA_KEEP_ALIVE,
        messages: [{ content: 'ok', role: 'user' }],
        model: modelId,
        options: { num_predict: 1 },
        stream: false,
        think: false,
      },
      options,
    );
  } catch {
    // Best effort only; enabling the feature should not depend on pre-warm.
  }
}

async function cleanup(
  cleanupOptions: OllamaCleanupOptions,
  options: OllamaClientOptions = {},
): Promise<string> {
  const response = await requestJson(
    'POST',
    '/api/chat',
    {
      keep_alive: OLLAMA_KEEP_ALIVE,
      messages: [
        { content: cleanupOptions.prompt, role: 'system' },
        { content: cleanupOptions.userMessage, role: 'user' },
      ],
      model: cleanupOptions.model,
      // Size the output cap to the input so long batch cleanups aren't truncated,
      // matching the remote path (see output-budget).
      options: {
        num_predict: outputTokenBudget(cleanupOptions.userMessage.length),
        temperature: cleanupOptions.temperature,
      },
      stream: false,
      think: false,
    },
    {
      ...options,
      ...(cleanupOptions.abortSignal !== undefined
        ? { abortSignal: cleanupOptions.abortSignal }
        : {}),
      timeoutMs: CLEANUP_TIMEOUT_MS,
    },
  );

  if (!isRecord(response) || !isRecord(response.message)) {
    throw new OllamaClientError('Ollama returned an invalid chat response.', 'invalid_response');
  }

  if (typeof response.message.content !== 'string') {
    throw new OllamaClientError('Ollama returned an invalid chat message.', 'invalid_response');
  }

  if (response.done_reason === 'length') {
    throw new OllamaClientError(
      'Ollama stopped because the transformed text exceeded the output limit.',
      'invalid_response',
    );
  }

  return response.message.content.trim();
}

async function requestJson(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  options: OllamaRequestOptions = {},
): Promise<unknown> {
  const responseText = await requestText(method, path, body, options);

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new OllamaClientError(
      `Ollama returned malformed JSON: ${String(error)}`,
      'invalid_response',
    );
  }
}

function requestText(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  options: OllamaRequestOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      {
        headers:
          requestBody === undefined
            ? undefined
            : {
                'content-length': Buffer.byteLength(requestBody).toString(),
                'content-type': 'application/json',
              },
        host: options.host ?? OLLAMA_HOST,
        method,
        path,
        port: options.port ?? OLLAMA_PORT,
        signal: options.abortSignal,
        timeout: options.timeoutMs ?? PROBE_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let exceeded = false;

        response.on('data', (chunk: Buffer) => {
          if (exceeded) return;
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            exceeded = true;
            request.destroy(
              new OllamaClientError(
                `Ollama response exceeded ${MAX_RESPONSE_BYTES} bytes.`,
                'invalid_response',
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (exceeded) return;
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new OllamaClientError(`Ollama returned HTTP ${statusCode}.`, 'http_error', {
                responseText: Buffer.concat(chunks).toString('utf8'),
                status: statusCode,
              }),
            );
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new OllamaClientError('Ollama request timed out.', 'timeout'));
    });
    request.on('error', (error) => {
      if (options.abortSignal?.aborted === true) {
        reject(new OllamaClientError('Ollama request aborted.', 'aborted'));
        return;
      }

      reject(
        error instanceof OllamaClientError
          ? error
          : new OllamaClientError(`Failed to reach Ollama: ${error.message}`, 'connection_failed'),
      );
    });

    if (requestBody !== undefined) {
      request.write(requestBody);
    }
    request.end();
  });
}
