import type { PluginSettings } from '../settings/plugin-settings';
import { activePresetOverride } from './llm-preset-overrides';

export interface ModelSettingsPresentation {
  remoteThresholdChars: number | null;
  remoteTimeoutSec: number | null;
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
  const remoteSettingsApply = settings.llmRemoteFeaturesEnabled;

  return {
    remoteThresholdChars:
      remoteSettingsApply && settings.llmRouting === 'auto'
        ? settings.llmRemoteThresholdChars
        : null,
    remoteTimeoutSec:
      remoteSettingsApply && settings.llmRouting !== 'local' ? settings.llmRemoteTimeoutSec : null,
    temperature,
  };
}

export function describeModelBehavior(settings: PluginSettings): string {
  const presentation = resolveModelSettingsPresentation(settings);
  const parts = [`Temperature ${presentation.temperature.value}`];
  if (presentation.remoteThresholdChars !== null) {
    parts.push(`Remote at ${presentation.remoteThresholdChars.toLocaleString()}+ chars`);
  }
  if (presentation.remoteTimeoutSec !== null) {
    parts.push(`${presentation.remoteTimeoutSec}s timeout`);
  }
  return parts.join(' · ');
}
