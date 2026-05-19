import { describe, expect, it } from 'vitest';

import { resolveLlmNoteContextBudget } from '../src/llm/note-context';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';

function withLlmContext(overrides: Partial<PluginSettings>): PluginSettings {
  return { ...DEFAULT_PLUGIN_SETTINGS, ...overrides };
}

describe('resolveLlmNoteContextBudget', () => {
  it('returns 0 when useLlmNoteContext is off, even with a non-zero char setting', () => {
    const settings = withLlmContext({
      useLlmNoteContext: false,
      llmPostprocessNoteContextChars: 3000,
    });

    expect(resolveLlmNoteContextBudget(settings)).toBe(0);
  });

  it('returns the configured char budget when useLlmNoteContext is on', () => {
    const settings = withLlmContext({
      useLlmNoteContext: true,
      llmPostprocessNoteContextChars: 4200,
    });

    expect(resolveLlmNoteContextBudget(settings)).toBe(4200);
  });

  it('returns 0 when the toggle is on but the configured char budget is 0', () => {
    const settings = withLlmContext({
      useLlmNoteContext: true,
      llmPostprocessNoteContextChars: 0,
    });

    expect(resolveLlmNoteContextBudget(settings)).toBe(0);
  });
});
