import type { PluginSettings } from '../settings/plugin-settings';

export function resolveLlmNoteContextBudget(settings: PluginSettings): number {
  return settings.useLlmNoteContext ? settings.llmPostprocessNoteContextChars : 0;
}
