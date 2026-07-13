import type { PluginSettingsMutation } from './llm-preset-state';
import {
  DEFAULT_LLM_ACTIVE_PRESET_REF,
  type PluginSettings,
  resetLlmPostprocessDefaults,
} from './plugin-settings';

interface LlmTransformationResetDependencies {
  mutateSettings: (mutation: PluginSettingsMutation) => Promise<void>;
}

export async function restoreLlmTransformationDefaults(
  dependencies: LlmTransformationResetDependencies,
): Promise<void> {
  await dependencies.mutateSettings((settings: Readonly<PluginSettings>) => ({
    ...resetLlmPostprocessDefaults(settings),
    llmPostprocessActivePresetRef: DEFAULT_LLM_ACTIVE_PRESET_REF,
  }));
}
