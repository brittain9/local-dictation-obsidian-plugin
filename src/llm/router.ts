import { outputTokenBudget } from './output-budget';
import {
  formatLlmProviderName,
  type LlmProvider,
  type LlmProviderId,
  type LlmRoutingPolicy,
  ProviderError,
} from './provider';
import { selectLlmProviderId } from './routing-policy';

export interface LlmRouterCleanupOptions {
  abortSignal?: AbortSignal;
  prompt: string;
  temperature: number;
  // The routing policy and output budget use dictated text only. The rendered
  // message may also contain note and prior-utterance context.
  transcriptChars: number;
  userMessage: string;
}

export interface LlmRouterCleanupResult {
  model: string;
  providerId: LlmProviderId;
  text: string;
}

export interface LlmRouter {
  cleanup(options: LlmRouterCleanupOptions): Promise<LlmRouterCleanupResult>;
  selectProviderId(transcriptChars: number): LlmProviderId;
}

export interface LlmProviderBinding {
  model: string;
  provider: LlmProvider;
}

export function createLlmRouter(options: {
  policy: LlmRoutingPolicy;
  resolveProvider: (providerId: LlmProviderId) => LlmProviderBinding;
}): LlmRouter {
  const bindings = new Map<LlmProviderId, LlmProviderBinding>();
  const bindingFor = (providerId: LlmProviderId): LlmProviderBinding => {
    const existing = bindings.get(providerId);
    if (existing !== undefined) {
      return existing;
    }
    const created = options.resolveProvider(providerId);
    bindings.set(providerId, created);
    return created;
  };
  const selectProviderId = (transcriptChars: number): LlmProviderId =>
    selectLlmProviderId(options.policy, transcriptChars);

  return {
    async cleanup(cleanupOptions) {
      const providerId = selectProviderId(cleanupOptions.transcriptChars);
      const binding = bindingFor(providerId);
      const model = binding.model.trim();
      if (model.length === 0) {
        const error = new ProviderError(
          `${formatLlmProviderName(providerId)} model is not configured.`,
          'model_not_configured',
        );
        error.providerId = providerId;
        throw error;
      }

      try {
        const text = await binding.provider.cleanup({
          ...(cleanupOptions.abortSignal === undefined
            ? {}
            : { abortSignal: cleanupOptions.abortSignal }),
          maxOutputTokens: outputTokenBudget(cleanupOptions.transcriptChars),
          model,
          prompt: cleanupOptions.prompt,
          temperature: cleanupOptions.temperature,
          userMessage: cleanupOptions.userMessage,
        });
        return { model, providerId, text };
      } catch (error) {
        if (error instanceof ProviderError && error.providerId === undefined) {
          error.providerId = providerId;
        }
        throw error;
      }
    },
    selectProviderId,
  };
}
