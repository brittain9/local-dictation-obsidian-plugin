import { formatErrorMessage } from '../shared/format-utils';
import { createOllamaClient, type OllamaClient, OllamaClientError } from './ollama-client';
import type { CleanupOptions, LlmProvider, ModelOption, ProviderHealth } from './provider';
import { ProviderError } from './provider';

export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;

  constructor(private readonly client: OllamaClient = createOllamaClient()) {}

  async cleanup(options: CleanupOptions): Promise<string> {
    try {
      return await this.client.cleanup(options);
    } catch (error) {
      throw mapOllamaError(error);
    }
  }

  async listModels(): Promise<ModelOption[]> {
    try {
      return await this.client.listOllamaModels();
    } catch (error) {
      throw mapOllamaError(error);
    }
  }

  async prewarmModel(modelId: string): Promise<void> {
    await this.client.prewarmModel(modelId);
  }

  async probe(): Promise<ProviderHealth> {
    try {
      const models = await this.client.listOllamaModels();
      return models.length === 0
        ? { kind: 'no_models' }
        : { kind: 'ready', modelCount: models.length };
    } catch (error) {
      const mapped = mapOllamaError(error);
      return mapped.code === 'connection_failed' || mapped.code === 'timeout'
        ? { kind: 'unreachable' }
        : { kind: 'unknown' };
    }
  }
}

function mapOllamaError(error: unknown): ProviderError {
  if (error instanceof OllamaClientError) {
    // Ollama reports a missing/unpulled model as a 404 from /api/chat; surface
    // it as unknown_model so the UI names the real problem (mirrors OpenRouter).
    if (
      error.code === 'http_error' &&
      error.status === 404 &&
      /model/i.test(error.responseText ?? error.message)
    ) {
      return new ProviderError('Ollama model was not found.', 'unknown_model');
    }
    return new ProviderError(error.message, error.code);
  }

  return new ProviderError(formatErrorMessage(error), 'connection_failed');
}
