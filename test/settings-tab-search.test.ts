import type { SettingDefinition } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import {
  LocalSttSettingTab,
  renderAutomaticCopyFinalizedUtterancesSetting,
} from '../src/settings/settings-tab';
import { type Setting as MockSetting, TestElement } from './__mocks__/obsidian';

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
        'Microphone',
        'Automatically copy finalized utterances',
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

  it('renders a default-off automatic-copy toggle with explicit clipboard replacement copy', async () => {
    const persistOne = vi.fn(async () => {});
    const setting = renderAutomaticCopyFinalizedUtterancesSetting(
      new TestElement() as unknown as HTMLElement,
      {
        getSettings: () => DEFAULT_PLUGIN_SETTINGS,
        persistOne,
      },
    ) as unknown as MockSetting;

    expect(setting.name).toBe('Automatically copy finalized utterances');
    expect(setting.descEl.textContent).toBe('Each finalized phrase replaces the system clipboard.');
    expect(setting.onlyToggle().value).toBe(false);

    setting.onlyToggle().change(true);

    await vi.waitFor(() => {
      expect(persistOne).toHaveBeenCalledWith('autoCopyFinalizedUtterances', true);
    });
  });
});
