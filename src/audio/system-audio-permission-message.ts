import type { SystemAudioProbeResultEvent } from '../sidecar/protocol';
import { compareVersions } from '../version';

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
  const details = error as { code?: unknown; message?: unknown } | null;

  if (details?.code !== SYSTEM_AUDIO_PERMISSION_DENIED_CODE) {
    return null;
  }

  const { message } = details;
  if (typeof message !== 'string') {
    return null;
  }

  return formatSystemAudioErrorMessage(message, details.code, electronVersion);
}

export function isElectronVersionOlderThan(
  version: string | null | undefined,
  minimumVersion: string,
): boolean {
  // Unknown or unparseable versions must not trigger the reinstall hint.
  return compareVersions(version, minimumVersion) === -1;
}

function readElectronVersion(): string | null {
  const maybeProcess =
    typeof process === 'undefined' ? undefined : (process as { versions?: { electron?: string } });

  return maybeProcess?.versions?.electron ?? null;
}
