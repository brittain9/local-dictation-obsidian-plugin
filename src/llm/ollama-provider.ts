import { createOllamaClient, type OllamaClient, OllamaClientError } from './ollama-client';
import type { CleanupOptions, LocalLlmProvider, ModelOption, ProviderHealth } from './provider';
import { ProviderError } from './provider';

export class OllamaProvider implements LocalLlmProvider {
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
    return new ProviderError(error.message, error.code);
  }

  return new ProviderError(
    error instanceof Error ? error.message : String(error),
    'connection_failed',
  );
}
