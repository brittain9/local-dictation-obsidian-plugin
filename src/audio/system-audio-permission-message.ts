import type { SystemAudioProbeResultEvent } from '../sidecar/protocol';

const SYSTEM_AUDIO_PERMISSION_DENIED_CODE = 'system_audio_permission_denied';
const ELECTRON_SYSTEM_AUDIO_PERMISSION_MINIMUM_VERSION = '39.6.0';
const OBSIDIAN_INSTALLER_MESSAGE =
  'Your Obsidian installer predates the macOS system-audio permission. Download a fresh installer from obsidian.md and reinstall, then try again.';

export function formatSystemAudioProbeResultMessage(
  result: Pick<SystemAudioProbeResultEvent, 'code' | 'message'>,
  electronVersion = readElectronVersion(),
): string {
  return formatSystemAudioErrorMessage(
    result.message ?? 'System audio is not ready.',
    result.code,
    electronVersion,
  );
}

export function formatSystemAudioErrorMessage(
  message: string,
  code: string | undefined,
  electronVersion = readElectronVersion(),
): string {
  if (
    code !== SYSTEM_AUDIO_PERMISSION_DENIED_CODE ||
    !isElectronVersionOlderThan(electronVersion, ELECTRON_SYSTEM_AUDIO_PERMISSION_MINIMUM_VERSION)
  ) {
    return message;
  }

  return `${message} ${OBSIDIAN_INSTALLER_MESSAGE}`;
}

export function formatSystemAudioSidecarErrorMessage(
  error: unknown,
  electronVersion = readElectronVersion(),
): string | null {
  const code = (error as { code?: unknown } | null)?.code;

  if (code !== SYSTEM_AUDIO_PERMISSION_DENIED_CODE) {
    return null;
  }

  const message = error instanceof Error ? error.message : (error as { message?: unknown }).message;
  if (typeof message !== 'string') {
    return null;
  }

  return formatSystemAudioErrorMessage(message, code, electronVersion);
}

export function isElectronVersionOlderThan(
  version: string | null | undefined,
  minimumVersion: string,
): boolean {
  const parsedVersion = parseVersion(version);
  const parsedMinimum = parseVersion(minimumVersion);

  if (parsedVersion === null || parsedMinimum === null) {
    return false;
  }

  for (let index = 0; index < parsedMinimum.length; index += 1) {
    const current = parsedVersion[index] ?? 0;
    const minimum = parsedMinimum[index] ?? 0;

    if (current < minimum) {
      return true;
    }
    if (current > minimum) {
      return false;
    }
  }

  return false;
}

function parseVersion(version: string | null | undefined): number[] | null {
  if (version === null || version === undefined) {
    return null;
  }

  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  return parts.every(Number.isInteger) ? parts : null;
}

function readElectronVersion(): string | null {
  const maybeProcess =
    typeof process === 'undefined' ? undefined : (process as { versions?: { electron?: string } });

  return maybeProcess?.versions?.electron ?? null;
}
