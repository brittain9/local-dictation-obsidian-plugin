import { Setting, type SettingDefinitionRender, type SettingGroup } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { LocalSttSettingTab } from '../src/settings/settings-tab';
import { TestElement } from './__mocks__/obsidian';

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
