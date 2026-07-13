import type { PluginSettings } from '../settings/plugin-settings';
import { activePresetOverride } from './llm-preset-overrides';

export function describeModelBehavior(settings: PluginSettings): string {
  const temperatureOverride = activePresetOverride(settings, 'temperature');
  const temperature =
    typeof temperatureOverride?.value === 'number'
      ? temperatureOverride.value
      : settings.llmPostprocessTemperature;
  const parts = [`Temperature ${temperature}`];
  if (settings.llmRemoteFeaturesEnabled && settings.llmRouting === 'auto') {
    parts.push(`Remote at ${settings.llmRemoteThresholdChars.toLocaleString()}+ chars`);
  }
  if (settings.llmRemoteFeaturesEnabled && settings.llmRouting !== 'local') {
    parts.push(`${settings.llmRemoteTimeoutSec}s timeout`);
  }
  return parts.join(' · ');
}
