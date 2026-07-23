import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { openFilteredHotkeySettings } from '../src/settings/open-hotkey-settings';

describe('openFilteredHotkeySettings', () => {
  it('opens Obsidian hotkeys and filters by command name', () => {
    const dispatchEvent = vi.fn();
    const searchInputEl = { dispatchEvent, value: '' } as unknown as HTMLInputElement;
    const open = vi.fn();
    const openTabById = vi.fn(() => ({ searchInputEl }));
    const app = { setting: { open, openTabById } } as unknown as App;

    expect(openFilteredHotkeySettings(app, 'Read aloud')).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(openTabById).toHaveBeenCalledWith('hotkeys');
    expect(searchInputEl.value).toBe('Read aloud');
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });

  it('reports failure when Obsidian rejects the settings request', () => {
    const error = new Error('unavailable');
    const onFailure = vi.fn();
    const app = {
      setting: {
        open: () => {
          throw error;
        },
        openTabById: vi.fn(),
      },
    } as unknown as App;

    expect(openFilteredHotkeySettings(app, 'Read aloud', onFailure)).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(error);
  });

  it('reports failure when the hotkeys search surface is unavailable', () => {
    const onFailure = vi.fn();

    expect(openFilteredHotkeySettings({} as App, 'Read aloud', onFailure)).toBe(false);
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
