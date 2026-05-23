import { Platform } from 'obsidian';

// macOS TCC grants apply to Obsidian as the host process and don't take effect
// until Obsidian restarts, so the macOS copy has to call that out — otherwise
// users enable Microphone access and then keep seeing the same denial.
export function formatMicrophonePermissionDeniedMessage(): string {
  if (Platform.isMacOS) {
    return 'Microphone permission denied. Open System Settings → Privacy & Security → Microphone, enable Obsidian, then restart Obsidian and try again.';
  }
  return 'Microphone permission denied. Grant access in your OS settings and try again.';
}
