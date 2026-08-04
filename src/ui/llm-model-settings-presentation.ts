import { validateOpenAiCompatibleBaseUrl } from '../llm/openai-compatible-url';
import { formatLlmProviderName, type LlmProviderId } from '../llm/provider';
import { activeLlmProviderIds } from '../llm/routing-policy';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import { activePresetOverride } from './llm-preset-overrides';

export interface ModelSettingsPresentation {
  networkTimeoutSec: number | null;
  routingThresholdChars: number | null;
  temperature: {
    presetLabel: string | null;
    value: number;
  };
}

export function resolveModelSettingsPresentation(
  settings: PluginSettings,
): ModelSettingsPresentation {
  const temperatureOverride = activePresetOverride(settings, 'temperature');
  const temperature: ModelSettingsPresentation['temperature'] =
    typeof temperatureOverride?.value === 'number'
      ? { presetLabel: temperatureOverride.label, value: temperatureOverride.value }
      : { presetLabel: null, value: settings.llmPostprocessTemperature };
  const activeProviders = activeLlmProviderIds(settings.llmRoutingPolicy);
  const networkSettingsApply = activeProviders.some(
    (providerId) => providerId === 'openrouter' || providerId === 'openai_compatible',
  );

  return {
    networkTimeoutSec: networkSettingsApply ? settings.llmNetworkTimeoutSec : null,
    routingThresholdChars:
      settings.llmRoutingPolicy?.kind === 'transcript_size'
        ? settings.llmRoutingPolicy.thresholdChars
        : null,
    temperature,
  };
}

export function describeModelBehavior(settings: PluginSettings): string {
  const presentation = resolveModelSettingsPresentation(settings);
  const parts = [
    describeRouting(settings),
    t('llm.model.summary.temperature', { value: presentation.temperature.value }),
  ].filter((part) => part.length > 0);
  if (presentation.routingThresholdChars !== null) {
    parts.push(
      t('llm.model.summary.routingThreshold', {
        value: presentation.routingThresholdChars.toLocaleString(),
      }),
    );
  }
  if (presentation.networkTimeoutSec !== null) {
    parts.push(t('llm.model.summary.timeout', { value: presentation.networkTimeoutSec }));
  }
  return parts.join(' · ');
}

function describeRouting(settings: PluginSettings): string {
  const policy = settings.llmRoutingPolicy;
  if (policy === null) {
    return '';
  }
  if (policy.kind === 'fixed') {
    return t('llm.routing.summary.fixed', {
      provider: providerDisplayName(settings, policy.providerId),
    });
  }
  return t('llm.routing.summary.size', {
    defaultProvider: providerDisplayName(settings, policy.defaultProviderId),
    largeProvider: providerDisplayName(settings, policy.largeTranscriptProviderId),
    threshold: policy.thresholdChars.toLocaleString(),
  });
}

function providerDisplayName(settings: PluginSettings, providerId: LlmProviderId): string {
  if (providerId !== 'openai_compatible') {
    return formatLlmProviderName(providerId);
  }
  const validation = validateOpenAiCompatibleBaseUrl(
    settings.llmProviderConfigurations.openai_compatible.baseUrl,
  );
  if (!validation.valid) {
    return formatLlmProviderName(providerId);
  }
  return t('llm.provider.customHost', { host: new URL(validation.normalizedUrl).host });
}
