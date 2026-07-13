import type { PluginSettings } from '../settings/plugin-settings';
import { resolveEffectiveTransformTiming } from './llm-preset-overrides';

export function describeTimestampTransformInteraction(settings: PluginSettings): string | null {
  if (!settings.timestampsEnabled) {
    return null;
  }
  if (settings.timestampDensity === 'detailed') {
    return 'Detailed word or segment timing is available in raw transcript mode. A transform rewrites those words, so exact alignment is removed instead of showing inaccurate timestamps.';
  }
  return resolveEffectiveTransformTiming(settings) === 'per_utterance'
    ? 'After each phrase preserves timestamp boundaries.'
    : 'All at once may rewrite or remove timestamps, depending on the preset.';
}
