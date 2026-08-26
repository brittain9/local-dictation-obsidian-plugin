import { describe, expect, it, vi } from 'vitest';

import { handleMicrophoneDeviceFallback } from '../src/settings/microphone-fallback';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';

describe('microphone device fallback', () => {
  it('persists the default microphone when the unavailable device is still selected', async () => {
    let settings: PluginSettings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      audioInputDevice: { deviceId: 'missing-device', label: 'Desk microphone' },
    };
    const show = vi.fn();
    const clearSelectionIfMatches = vi.fn(async (deviceId: string) => {
      if (settings.audioInputDevice?.deviceId !== deviceId) {
        return false;
      }
      settings = { ...settings, audioInputDevice: null };
      return true;
    });

    await handleMicrophoneDeviceFallback('missing-device', {
      clearSelectionIfMatches,
      feedback: { show },
    });

    expect(clearSelectionIfMatches).toHaveBeenCalledWith('missing-device');
    expect(settings.audioInputDevice).toBeNull();
    expect(show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'microphone-device-fallback',
      message:
        'Saved microphone unavailable. Using the default microphone; the saved selection was cleared for future sessions.',
    });
  });

  it('reports an unchanged setting when the conditional clear is skipped', async () => {
    const show = vi.fn();
    const clearSelectionIfMatches = vi.fn(async () => false);

    await handleMicrophoneDeviceFallback('old-device', {
      clearSelectionIfMatches,
      feedback: { show },
    });

    expect(clearSelectionIfMatches).toHaveBeenCalledWith('old-device');
    expect(show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'microphone-device-fallback',
      message:
        'Saved microphone unavailable. Using the default microphone for this session; the current microphone setting was left unchanged.',
    });
  });

  it('reports persistence failure without rejecting the fallback handler', async () => {
    const error = new Error('data.json is read-only');
    const show = vi.fn();

    await expect(
      handleMicrophoneDeviceFallback('missing-device', {
        clearSelectionIfMatches: vi.fn(async () => {
          throw error;
        }),
        feedback: { show },
      }),
    ).resolves.toBeUndefined();

    expect(show).toHaveBeenCalledWith({
      cause: error,
      intent: 'warning',
      key: 'microphone-device-fallback',
      message:
        'Saved microphone unavailable. Using the default microphone, but this change could not be saved. Select an available microphone in Settings before restarting Obsidian.',
    });
  });
});
