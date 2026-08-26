import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import { resolveEffectiveTransformTiming } from './llm-preset-overrides';

export function describeTimestampTransformInteraction(settings: PluginSettings): string | null {
  if (!settings.timestampsEnabled) {
    return null;
  }
  return resolveEffectiveTransformTiming(settings) === 'per_utterance'
    ? t('llm.timing.timestamps.perUtterance')
    : t('llm.timing.timestamps.batch');
}
