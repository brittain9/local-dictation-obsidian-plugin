import type { App } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { PresetManagerModal } from '../src/ui/preset-manager-modal';
import { Setting, TestElement } from './__mocks__/obsidian';

describe('PresetManagerModal row interaction', () => {
  beforeEach(() => {
    Setting.reset();
    vi.stubGlobal('createFragment', () => new TestElement());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the information area as the explicit mouse target', async () => {
    const modal = createModal();
    modal.open();
    const row = cleanUpRow();

    expect(row.infoEl.tabIndex).toBe(0);
    expect(row.infoEl.getAttribute('role')).toBe('button');
    expect(row.infoEl.getAttribute('aria-label')).toBe('View preset');

    await row.settingEl.click();
    expect(modal.titleEl.textContent).toBe('Manage presets');

    await row.infoEl.click();
    expect(modal.titleEl.textContent).toBe('Clean up');
  });

  it.each(['Enter', ' '])('opens a preset with the %j key', (key) => {
    const modal = createModal();
    modal.open();
    const preventDefault = vi.fn();

    cleanUpRow().infoEl.dispatchEvent({ key, preventDefault, type: 'keydown' });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(modal.titleEl.textContent).toBe('Clean up');
  });
});

function createModal(): PresetManagerModal {
  return new PresetManagerModal({} as App, {
    feedback: { show: vi.fn() },
    getSettings: () => DEFAULT_PLUGIN_SETTINGS,
    mutatePresetState: vi.fn(async () => {}),
  });
}

function cleanUpRow(): Setting {
  const row = Setting.instances.find((setting) => setting.name.startsWith('Clean up'));
  if (row === undefined) throw new Error('Clean up preset row not found');
  return row;
}
