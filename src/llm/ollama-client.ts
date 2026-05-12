import http from 'node:http';

import { isRecord } from '../shared/type-guards';

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const PREFLIGHT_TIMEOUT_MS = 3_000;
const NON_CHAT_MODEL_PATTERN = /embed|embedding|bge|nomic|clip/i;

interface OllamaClientOptions {
  host?: string;
  port?: number;
}

export interface OllamaModelOption {
  displayName: string;
  id: string;
}

export class OllamaClientError extends Error {
  constructor(
    message: string,
    public readonly code: 'connection_failed' | 'http_error' | 'invalid_response' | 'timeout',
  ) {
    super(message);
    this.name = 'OllamaClientError';
  }
}

export interface OllamaClient {
  listOllamaModels(): Promise<OllamaModelOption[]>;
  prewarmModel(modelId: string, keepAlive: string): Promise<void>;
  probeOllama(): Promise<void>;
}

export function createOllamaClient(options: OllamaClientOptions = {}): OllamaClient {
  const host = options.host ?? OLLAMA_HOST;
  const port = options.port ?? OLLAMA_PORT;

  return {
    listOllamaModels: () => listOllamaModels({ host, port }),
    prewarmModel: (modelId, keepAlive) => prewarmModel(modelId, keepAlive, { host, port }),
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

async function prewarmModel(
  modelId: string,
  keepAlive: string,
  options: OllamaClientOptions = {},
): Promise<void> {
  try {
    await requestJson(
      'POST',
      '/api/chat',
      {
        keep_alive: keepAlive,
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

async function requestJson(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  options: OllamaClientOptions = {},
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
  options: OllamaClientOptions = {},
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
        timeout: PREFLIGHT_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new OllamaClientError(`Ollama returned HTTP ${statusCode}.`, 'http_error'));
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
