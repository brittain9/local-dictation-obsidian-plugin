import type { SettingDefinition } from 'obsidian';
import { describe, expect, it } from 'vitest';

import { LocalSttSettingTab } from '../src/settings/settings-tab';

describe('LocalSttSettingTab settings search', () => {
  it('publishes localized search metadata for the composite settings UI', () => {
    const tab = Object.create(LocalSttSettingTab.prototype) as LocalSttSettingTab;

    const definitions = tab.getSettingDefinitions();

    expect(definitions).toHaveLength(1);
    const definition = definitions[0] as SettingDefinition;
    expect(definition.name).toBe('Local Dictation');
    expect(definition.aliases).toEqual(
      expect.arrayContaining([
        'Manage models',
        'Speech-to-text model',
        'Text-to-speech model',
        'Translation model',
        'Default target language',
        'Microphone',
        'Transcript formatting',
        'Use timestamps',
        'Enable LLM features',
        'Hardware acceleration',
        'CPU sidecar',
        'Developer mode',
      ]),
    );
    expect(definition.render).toBeTypeOf('function');
  });
});
