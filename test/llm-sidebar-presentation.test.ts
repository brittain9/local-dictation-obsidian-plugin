import { describe, expect, it } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { resolveLlmSidebarPresentation } from '../src/ui/llm-sidebar-presentation';
import { createUserPreset } from './fixtures/llm';

describe('LLM sidebar presentation', () => {
  it('explains the unavailable state instead of leaving a detached view blank', () => {
    const presentation = resolveLlmSidebarPresentation({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmFeaturesEnabled: false,
    });

    expect(presentation).toMatchObject({
      emptyState: { title: 'LLM features are unavailable' },
      state: 'unavailable',
      statusLabel: 'Unavailable',
    });
  });

  it('identifies raw transcript behavior when transformation is off', () => {
    const presentation = resolveLlmSidebarPresentation({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmFeaturesEnabled: true,
      llmPostprocessMode: 'off',
    });

    expect(presentation).toMatchObject({
      emptyState: { title: 'Raw transcript mode' },
      state: 'off',
      statusLabel: 'Off',
      summary: 'Raw transcript',
    });
  });

  it('summarizes the active preset with the selected transform timing', () => {
    const preset = createUserPreset({ label: 'Concise meeting notes' });
    const presentation = resolveLlmSidebarPresentation({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmFeaturesEnabled: true,
      llmPostprocessActivePresetRef: `user:${preset.id}`,
      llmPostprocessMode: 'per_utterance',
      llmPostprocessUserPresets: [preset],
    });

    expect(presentation).toEqual({
      emptyState: null,
      state: 'active',
      statusLabel: 'On',
      summary: 'Concise meeting notes · Runs after each phrase',
    });
  });

  it('reports preset-pinned timing instead of the stored global mode', () => {
    const preset = createUserPreset({ label: 'Session summary', timing: 'batch' });
    const presentation = resolveLlmSidebarPresentation({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmFeaturesEnabled: true,
      llmPostprocessActivePresetRef: `user:${preset.id}`,
      llmPostprocessMode: 'per_utterance',
      llmPostprocessUserPresets: [preset],
    });

    expect(presentation.summary).toBe('Session summary · Runs once on stop');
  });
});
