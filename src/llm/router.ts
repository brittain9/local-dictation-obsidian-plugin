import type { PluginSettings } from '../settings/plugin-settings';
import { outputTokenBudget } from './output-budget';
import {
  createProvider,
  formatLlmProviderName,
  getProviderModel,
  type LlmProvider,
  type LlmProviderId,
  ProviderError,
  selectRouteProviderId,
} from './provider';

export interface LlmRouterCleanupOptions {
  abortSignal?: AbortSignal;
  prompt: string;
  temperature: number;
  // Length of the dictated text being transformed, as opposed to
  // `userMessage`, which also carries note/prior context. This drives both
  // the output-token cap and the Auto routing decision below — routing on
  // `userMessage` would leak note context to OpenRouter for short
  // dictations that merely have a large note attached (#194).
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

// Routes each cleanup call to a provider by message size (see
// `selectRouteProviderId`), resolves that provider's configured model, and
// raises a typed `model_not_configured` error when it is missing so callers
// surface a cleanup failure (keep raw + banner) instead of a malformed request.
export function createLlmRouter(
  settings: PluginSettings,
  createProviderFn = createProvider,
  isRemoteFeaturesEnabled: () => boolean = () => settings.llmRemoteFeaturesEnabled,
  getOpenRouterApiKey: () => string = () => '',
): LlmRouter {
  // `isRemoteFeaturesEnabled` must read live state, not the snapshot captured in
  // `settings`, so the privacy kill switch takes effect mid-session; the default
  // exists only for tests that pass a fixed snapshot. Everything else here —
  // routing mode, auto threshold, model strings — deliberately stays frozen from
  // the session-start snapshot so a running session behaves predictably;
  // mid-session settings edits apply from the next session.
  const selectProviderId = (transcriptChars: number): LlmProviderId =>
    selectRouteProviderId(
      isRemoteFeaturesEnabled() ? settings.llmRouting : 'local',
      transcriptChars,
      settings.llmRemoteThresholdChars,
    );

  // The settings snapshot is frozen for the router's lifetime, so each provider
  // can be constructed once instead of per cleanup call.
  const providers = new Map<LlmProviderId, LlmProvider>();
  const providerFor = (providerId: LlmProviderId): LlmProvider => {
    const existing = providers.get(providerId);
    if (existing !== undefined) {
      return existing;
    }
    const created = createProviderFn(providerId, settings, getOpenRouterApiKey());
    providers.set(providerId, created);
    return created;
  };

  return {
    async cleanup(options) {
      const providerId = selectProviderId(options.transcriptChars);
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
        const text = await providerFor(providerId).cleanup({
          ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
          maxOutputTokens: outputTokenBudget(options.transcriptChars),
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
