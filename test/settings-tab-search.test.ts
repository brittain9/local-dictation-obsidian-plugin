import { Setting, type SettingDefinitionRender, type SettingGroup } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { LocalSttSettingTab } from '../src/settings/settings-tab';
import { TestElement } from './__mocks__/obsidian';

describe('LocalSttSettingTab Obsidian 1.13 compatibility', () => {
  it('opts the composite settings UI out of declarative row rendering', () => {
    const tab = Object.create(LocalSttSettingTab.prototype) as LocalSttSettingTab;

    expect(tab.getSettingDefinitions()).toEqual([]);
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

    const definitions = tab.getSettingDefinitions();
    if (definitions.length === 0) {
      tab.display();
    } else {
      const rows = definitions.map((definition) => {
        const setting = new Setting(container as unknown as HTMLElement);
        const rendered = definition as SettingDefinitionRender;
        setting.setName(rendered.name);
        rendered.render(setting, {} as SettingGroup);
        return setting.settingEl as unknown as TestElement;
      });

      // Obsidian 1.13.4 reasserts ownership of each framework-created row
      // after custom render callbacks complete.
      container.setChildrenInPlace(rows);
    }

    expect(container.findByText('Microphone')).toBeDefined();
  });
});
