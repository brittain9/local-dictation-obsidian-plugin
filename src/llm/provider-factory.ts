import { OllamaProvider } from './ollama-provider';
import { OpenAiCompatibleProvider } from './openai-compatible-provider';
import { OpenRouterProvider } from './openrouter-provider';
import type { LlmProvider, LlmProviderConfigurations, LlmProviderId } from './provider';

export interface CreateProviderOptions {
  configurations: LlmProviderConfigurations;
  getSecret: (secretId: string) => string;
  networkTimeoutMs: number;
}

export function createProvider(
  providerId: LlmProviderId,
  options: CreateProviderOptions,
): LlmProvider {
  switch (providerId) {
    case 'ollama':
      return new OllamaProvider();
    case 'openrouter':
      return new OpenRouterProvider({
        apiKey: options.getSecret(options.configurations.openrouter.secretId),
        timeoutMs: options.networkTimeoutMs,
      });
    case 'openai_compatible':
      return new OpenAiCompatibleProvider({
        apiKey: options.getSecret(options.configurations.openai_compatible.secretId),
        baseUrl: options.configurations.openai_compatible.baseUrl,
        timeoutMs: options.networkTimeoutMs,
      });
  }
}
