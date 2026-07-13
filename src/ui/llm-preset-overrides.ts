import { type LlmPresetOverrides, resolveActivePresetEntry } from '../llm/presets';
import type { PluginSettings } from '../settings/plugin-settings';

type PresetOverrideSettings = Pick<
  PluginSettings,
  'llmPostprocessActivePresetRef' | 'llmPostprocessUserPresets'
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
