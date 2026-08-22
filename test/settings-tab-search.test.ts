import { Setting, type SettingDefinitionRender, type SettingGroup } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import {
  LocalSttSettingTab,
  renderAutomaticCopyFinalizedUtterancesSetting,
  renderReadAloudHighlightSetting,
} from '../src/settings/settings-tab';
import { type Setting as MockSetting, TestElement } from './__mocks__/obsidian';

describe('LocalSttSettingTab Obsidian 1.13 compatibility', () => {
  it('opts the composite settings UI out of declarative row rendering', () => {
    const tab = Object.create(LocalSttSettingTab.prototype) as LocalSttSettingTab;

    expect(tab.getSettingDefinitions()).toEqual([]);
  });

  it('models Obsidian suppressing display when a declarative definition is returned', () => {
    const container = new TestElement();
    const display = vi.fn();
    const definitions: SettingDefinitionRender[] = [
      {
        name: 'Speech Kit',
        render: (setting) => {
          setting.setName('Speech Kit');
        },
      },
    ];

    reconcileObsidian13Settings(container, definitions, display);

    expect(display).not.toHaveBeenCalled();
    expect(container.findByText('Speech Kit')).toBeDefined();
  });

  it('keeps the composite settings visible after Obsidian reconciles declarative rows', () => {
    const tab = Object.create(LocalSttSettingTab.prototype) as LocalSttSettingTab;
    const container = new TestElement();
    const renderSettings = vi.fn((host: TestElement) => {
      host.createDiv({ text: 'Microphone' });
    });
    Object.defineProperty(tab, 'renderSettings', { value: renderSettings });
    Object.defineProperty(tab, 'display', {
      value: () => renderSettings(container),
    });

    reconcileObsidian13Settings(container, tab.getSettingDefinitions(), () => {
      tab.display();
    });

    expect(container.findByText('Microphone')).toBeDefined();
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

  it('renders the enabled read-aloud highlight toggle and persists live changes', async () => {
    const persistOne = vi.fn(async () => {});
    const setting = renderReadAloudHighlightSetting(new TestElement() as unknown as HTMLElement, {
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      persistOne,
    }) as unknown as MockSetting;

    expect(setting.name).toBe('Highlight spoken text');
    expect(setting.descEl.textContent).toBe(
      'Highlight the current sentence or text chunk in the editor while Read Aloud is playing.',
    );
    expect(setting.onlyToggle().value).toBe(true);

    setting.onlyToggle().change(false);
    await vi.waitFor(() => {
      expect(persistOne).toHaveBeenCalledWith('highlightSpokenText', false);
    });
  });
});

function reconcileObsidian13Settings(
  container: TestElement,
  definitions: readonly SettingDefinitionRender[],
  display: () => void,
): void {
  if (definitions.length === 0) {
    display();
    return;
  }

  const rows = definitions.map((definition) => {
    const setting = new Setting(container as unknown as HTMLElement);
    setting.setName(definition.name);
    definition.render(setting, {} as SettingGroup);
    return setting.settingEl as unknown as TestElement;
  });

  // Obsidian 1.13.4 reasserts ownership of each framework-created row.
  container.setChildrenInPlace(rows);
}
