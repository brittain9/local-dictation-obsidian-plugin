import type { PluginSettings } from '../settings/plugin-settings';
import {
  createProvider,
  formatLlmProviderName,
  getProviderModel,
  type LlmProviderId,
  ProviderError,
  selectRouteProviderId,
} from './provider';

export interface LlmRouterCleanupOptions {
  abortSignal?: AbortSignal;
  prompt: string;
  temperature: number;
  userMessage: string;
}

export interface LlmRouterCleanupResult {
  model: string;
  providerId: LlmProviderId;
  text: string;
}

export interface LlmRouter {
  cleanup(options: LlmRouterCleanupOptions): Promise<LlmRouterCleanupResult>;
  selectProviderId(userMessageChars: number): LlmProviderId;
}

// Routes each cleanup call to a provider by message size (see
// `selectRouteProviderId`), resolves that provider's configured model, and
// raises a typed `model_not_configured` error when it is missing so callers
// surface a cleanup failure (keep raw + banner) instead of a malformed request.
export function createLlmRouter(
  settings: PluginSettings,
  createProviderFn = createProvider,
  isRemoteFeaturesEnabled: () => boolean = () => settings.llmRemoteFeaturesEnabled,
): LlmRouter {
  // `isRemoteFeaturesEnabled` must read live state, not the snapshot captured in
  // `settings`, so the kill switch takes effect mid-session; the default exists
  // only for tests that pass a fixed snapshot.
  const selectProviderId = (userMessageChars: number): LlmProviderId =>
    selectRouteProviderId(
      isRemoteFeaturesEnabled() ? settings.llmRouting : 'local',
      userMessageChars,
      settings.llmRemoteThresholdChars,
    );

  return {
    async cleanup(options) {
      const providerId = selectProviderId(options.userMessage.length);
      const model = getProviderModel(settings, providerId);
      if (model.length === 0) {
        const error = new ProviderError(
          `${formatLlmProviderName(providerId)} model is not configured.`,
          'model_not_configured',
        );
        error.providerId = providerId;
        throw error;
      }

      try {
        const text = await createProviderFn(providerId, settings).cleanup({
          ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
          model,
          prompt: options.prompt,
          temperature: options.temperature,
          userMessage: options.userMessage,
        });

        return { model, providerId, text };
      } catch (error) {
        // Attribute the failure to the provider this call actually used; the
        // caller's earlier selectProviderId result can be stale if the remote
        // kill switch flipped in between.
        if (error instanceof ProviderError && error.providerId === undefined) {
          error.providerId = providerId;
        }
        throw error;
      }
    },
    selectProviderId,
  };
}
