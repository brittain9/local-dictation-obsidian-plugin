import { describe, expect, it, vi } from 'vitest';

import { SettingsTabLifecycle } from '../src/settings/settings-tab-lifecycle';
import { TestElement } from './__mocks__/obsidian';

describe('SettingsTabLifecycle', () => {
  it('uses display on legacy hosts and preserves focused control identity', () => {
    const container = new TestElement();
    const originalControls = addSettingRow(container, 'Listening mode', 2);
    originalControls[1]?.focus();
    const display = vi.fn(() => {
      container.empty();
      addSettingRow(container, 'Listening mode', 2);
    });
    const lifecycle = new SettingsTabLifecycle({
      containerEl: container as unknown as HTMLElement,
      display,
    });

    lifecycle.markVisible();
    lifecycle.refresh();

    expect(display).toHaveBeenCalledOnce();
    const refreshedControls = container.querySelectorAll('button');
    expect(container.ownerDocument.activeElement).toBe(refreshedControls[1]);
  });

  it('uses update on current hosts without also calling display', () => {
    const container = new TestElement();
    const display = vi.fn();
    const update = vi.fn();
    const lifecycle = new SettingsTabLifecycle({
      containerEl: container as unknown as HTMLElement,
      display,
      update,
    });

    lifecycle.markVisible();
    lifecycle.refresh();

    expect(update).toHaveBeenCalledOnce();
    expect(display).not.toHaveBeenCalled();
  });

  it('ignores a late refresh after the settings tab is hidden', () => {
    const display = vi.fn();
    const update = vi.fn();
    const lifecycle = new SettingsTabLifecycle({
      containerEl: new TestElement() as unknown as HTMLElement,
      display,
      update,
    });

    lifecycle.markVisible();
    lifecycle.markHidden();
    lifecycle.refresh();

    expect(update).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
  });
});

function addSettingRow(container: TestElement, name: string, controlCount: number): TestElement[] {
  const row = container.createDiv({ cls: 'setting-item' });
  row.createDiv({ cls: 'setting-item-name', text: name });
  const controls = row.createDiv({ cls: 'setting-item-control' });
  return Array.from({ length: controlCount }, () => controls.createEl('button'));
}
