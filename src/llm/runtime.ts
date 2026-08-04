import type { PluginSettings } from '../settings/plugin-settings';
import { getProviderModel } from './provider';
import { createProvider } from './provider-factory';
import { resolveLlmReadiness } from './readiness';
import { createLlmRouter, type LlmRouter } from './router';

export function createConfiguredLlmRouter(
  settings: PluginSettings,
  getSecret: (secretId: string) => string,
): LlmRouter | null {
  const readiness = resolveLlmReadiness({
    configurations: settings.llmProviderConfigurations,
    getSecret,
    policy: settings.llmRoutingPolicy,
  });
  if (!readiness.ready || settings.llmRoutingPolicy === null) {
    return null;
  }

  return createLlmRouter({
    policy: settings.llmRoutingPolicy,
    resolveProvider: (providerId) => ({
      model: getProviderModel(settings.llmProviderConfigurations, providerId),
      provider: createProvider(providerId, {
        configurations: settings.llmProviderConfigurations,
        getSecret,
        networkTimeoutMs: settings.llmNetworkTimeoutSec * 1000,
      }),
    }),
  });
}
