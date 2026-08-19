import { selectedModelEquals } from '../models/model-management-types';
import type { PluginSettings } from '../settings/plugin-settings';

export function didReadAloudSettingsChange(
  previous: PluginSettings,
  next: PluginSettings,
): boolean {
  return (
    previous.ttsSpeed !== next.ttsSpeed ||
    previous.readAloudLanguage !== next.readAloudLanguage ||
    previous.selectedTtsVoice !== next.selectedTtsVoice ||
    !nullableSelectionsEqual(previous.selectedTtsModel, next.selectedTtsModel)
  );
}

export function resolveReadAloudVoiceId(
  selectedVoice: string | null,
  defaultVoice: string | undefined,
): string | null {
  return selectedVoice ?? defaultVoice ?? null;
}

function nullableSelectionsEqual(
  left: PluginSettings['selectedTtsModel'],
  right: PluginSettings['selectedTtsModel'],
): boolean {
  if (left === null || right === null) return left === right;
  return selectedModelEquals(left, right);
}
