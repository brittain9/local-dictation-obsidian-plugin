import { Platform } from 'obsidian';

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
  if (version === null || version === undefined) {
    return false;
  }

  const [majorText, minorText = '0'] = version.trim().split('.');
  const major = Number.parseInt(majorText ?? '', 10);
  const minor = Number.parseInt(minorText, 10);

  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return false;
  }

  return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
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
