import {
  type LlmPresetOverrides,
  type LlmPresetTiming,
  resolveActivePresetEntry,
} from '../llm/presets';
import type { PluginSettings } from '../settings/plugin-settings';

type PresetOverrideSettings = Pick<
  PluginSettings,
  'llmPostprocessActivePresetRef' | 'llmPostprocessUserPresets'
>;

type EffectiveTimingSettings = Pick<
  PluginSettings,
  | 'llmPostprocessActivePresetRef'
  | 'llmPostprocessLastEnabledMode'
  | 'llmPostprocessMode'
  | 'llmPostprocessUserPresets'
>;

export function activePresetOverride(
  settings: PresetOverrideSettings,
  field: keyof LlmPresetOverrides,
): { label: string; value: number | boolean } | null {
  const { preset } = resolveActivePresetEntry(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );
  const value = preset.overrides?.[field];
  if (value === undefined) {
    return null;
  }
  return { label: preset.label, value };
}

export function resolveEffectiveTransformTiming(
  settings: EffectiveTimingSettings,
): LlmPresetTiming {
  const { preset } = resolveActivePresetEntry(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );
  if (preset.timing !== undefined) {
    return preset.timing;
  }
  return settings.llmPostprocessMode === 'off'
    ? settings.llmPostprocessLastEnabledMode
    : settings.llmPostprocessMode;
}
