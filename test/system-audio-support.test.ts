import { describe, expect, it } from 'vitest';

import {
  isMacOSVersionAtLeast,
  isSystemAudioSupported,
  type SystemAudioPlatform,
} from '../src/settings/system-audio-support';

const WINDOWS: SystemAudioPlatform = { isLinux: false, isMacOS: false, isWin: true };
const LINUX: SystemAudioPlatform = { isLinux: true, isMacOS: false, isWin: false };
const MACOS: SystemAudioPlatform = { isLinux: false, isMacOS: true, isWin: false };
const OTHER: SystemAudioPlatform = { isLinux: false, isMacOS: false, isWin: false };

describe('isSystemAudioSupported', () => {
  it('keeps Windows and Linux enabled without consulting macOS version', () => {
    expect(isSystemAudioSupported(WINDOWS, null)).toBe(true);
    expect(isSystemAudioSupported(LINUX, null)).toBe(true);
  });

  it('requires macOS 14.2 or newer for native system audio', () => {
    expect(isSystemAudioSupported(MACOS, '14.1.9')).toBe(false);
    expect(isSystemAudioSupported(MACOS, '14.2')).toBe(true);
    expect(isSystemAudioSupported(MACOS, '14.2.1')).toBe(true);
    expect(isSystemAudioSupported(MACOS, '15.0')).toBe(true);
  });

  it('treats missing or malformed macOS versions as unsupported', () => {
    expect(isSystemAudioSupported(MACOS, null)).toBe(false);
    expect(isSystemAudioSupported(MACOS, 'not-a-version')).toBe(false);
    expect(isSystemAudioSupported(OTHER, '15.0')).toBe(false);
  });
});

describe('isMacOSVersionAtLeast', () => {
  it('compares only major and minor version components', () => {
    expect(isMacOSVersionAtLeast('14.10.3', 14, 2)).toBe(true);
    expect(isMacOSVersionAtLeast('14', 14, 2)).toBe(false);
    expect(isMacOSVersionAtLeast('13.9', 14, 2)).toBe(false);
  });
});
