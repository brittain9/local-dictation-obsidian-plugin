import { Platform } from 'obsidian';
import { t } from '../shared/i18n';

// macOS TCC grants apply to Obsidian as the host process and don't take effect
// until Obsidian restarts, so the macOS copy has to call that out — otherwise
// users enable Microphone access and then keep seeing the same denial.
export function formatMicrophonePermissionDeniedMessage(): string {
  if (Platform.isMacOS) {
    return t('audio.microphone.permissionDeniedMac');
  }
  return t('audio.microphone.permissionDenied');
}

// Translates a getUserMedia DOMException into actionable copy. Returns null when
// the error isn't a recognized microphone-capture failure, so callers that share
// a generic failure path (e.g. the controller's start handler, which also covers
// sidecar errors) can fall back to their default message.
export function formatMicrophoneCaptureErrorMessage(error: unknown): string | null {
  const name = (error as { name?: unknown } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
      return formatMicrophonePermissionDeniedMessage();
    case 'NotFoundError':
      // getUserMedia found zero input devices, distinct from permission denial.
      // On Linux this is usually no mic connected/enabled, or the audio service
      // not seeing PipeWire/PulseAudio inputs.
      return t('audio.microphone.notFound');
    case 'NotReadableError':
      // The device exists but the OS refused to open it (hardware error or held
      // exclusively by another process).
      return t('audio.microphone.notReadable');
    default:
      return null;
  }
}
