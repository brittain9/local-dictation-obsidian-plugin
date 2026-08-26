import { activeLlmProviderIds } from '../llm/routing-policy';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import { activePresetOverride } from './llm-preset-overrides';

export interface ModelSettingsPresentation {
  networkTimeoutSec: number | null;
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
    temperature,
  };
}

export function describeAdvancedModelSettings(settings: PluginSettings): string {
  const presentation = resolveModelSettingsPresentation(settings);
  const temperatureKey =
    settings.llmRoutingPolicy?.kind === 'transcript_size'
      ? 'llm.model.summary.temperatureShared'
      : 'llm.model.summary.temperature';
  const parts = [t(temperatureKey, { value: presentation.temperature.value })];
  if (presentation.networkTimeoutSec !== null) {
    parts.push(t('llm.model.summary.timeout', { value: presentation.networkTimeoutSec }));
  }
  return parts.join(' · ');
}
