import { ProviderError } from './provider';

export const CLEANUP_TIMEOUT_MS = 60_000;
export const PROBE_TIMEOUT_MS = 3_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

interface FetchJsonOptions {
  abortSignal?: AbortSignal | undefined;
  maxBytes?: number;
  timeoutMs?: number;
}

export async function fetchJson(
  url: string,
  init: RequestInit = {},
  options: FetchJsonOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? CLEANUP_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  let timeoutFired = false;

  const timeoutId = setTimeout(() => {
    timeoutFired = true;
    controller.abort();
  }, timeoutMs);

  const abortFromCaller = (): void => {
    controller.abort();
  };

  if (options.abortSignal?.aborted === true) {
    controller.abort();
  } else {
    options.abortSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const responseText = await readResponseText(response, maxBytes);

    if (!response.ok) {
      throw new ProviderError(`Provider returned HTTP ${response.status}.`, 'http_error', {
        responseText,
        status: response.status,
      });
    }

    try {
      return JSON.parse(responseText);
    } catch (error) {
      throw new ProviderError(
        `Provider returned malformed JSON: ${String(error)}`,
        'invalid_response',
      );
    }
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    if (timeoutFired) {
      throw new ProviderError(`Provider request timed out after ${timeoutMs}ms.`, 'timeout');
    }
    if (options.abortSignal?.aborted === true) {
      throw new ProviderError('Provider request aborted.', 'connection_failed');
    }
    throw new ProviderError(`Failed to reach provider: ${formatError(error)}`, 'connection_failed');
  } finally {
    clearTimeout(timeoutId);
    options.abortSignal?.removeEventListener('abort', abortFromCaller);
  }
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ProviderError(
          `Provider response exceeded ${maxBytes} bytes.`,
          'invalid_response',
        );
      }

      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
