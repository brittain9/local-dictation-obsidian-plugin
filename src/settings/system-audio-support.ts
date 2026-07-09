import { Platform } from 'obsidian';

import { compareVersions } from '../version';

export interface SystemAudioPlatform {
  isLinux: boolean;
  isMacOS: boolean;
  isWin: boolean;
}

export function isSystemAudioSupportedOnCurrentPlatform(): boolean {
  return isSystemAudioSupported(Platform, readMacOSSystemVersion());
}

export function isSystemAudioSupported(
  platform: SystemAudioPlatform,
  macOSVersion: string | null | undefined,
): boolean {
  if (platform.isWin || platform.isLinux) {
    return true;
  }

  return platform.isMacOS && isMacOSVersionAtLeast(macOSVersion, 14, 2);
}

export function isMacOSVersionAtLeast(
  version: string | null | undefined,
  requiredMajor: number,
  requiredMinor: number,
): boolean {
  const comparison = compareVersions(version, `${requiredMajor}.${requiredMinor}`);
  return comparison !== null && comparison >= 0;
}

function readMacOSSystemVersion(): string | null {
  const maybeProcess =
    typeof process === 'undefined' ? undefined : (process as { getSystemVersion?: () => string });

  if (typeof maybeProcess?.getSystemVersion !== 'function') {
    return null;
  }

  try {
    return maybeProcess.getSystemVersion();
  } catch {
    return null;
  }
}
