import { Platform } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';

import { formatMicrophonePermissionDeniedMessage } from '../src/audio/microphone-permission-message';

describe('formatMicrophonePermissionDeniedMessage', () => {
  const originalIsMacOS = Platform.isMacOS;

  afterEach(() => {
    Platform.isMacOS = originalIsMacOS;
  });

  it('tells macOS users to enable Obsidian in Privacy & Security and restart', () => {
    Platform.isMacOS = true;
    const message = formatMicrophonePermissionDeniedMessage();

    expect(message).toContain('System Settings');
    expect(message).toContain('Microphone');
    expect(message).toContain('restart Obsidian');
  });

  it('keeps the short generic copy on non-macOS platforms', () => {
    Platform.isMacOS = false;
    expect(formatMicrophonePermissionDeniedMessage()).toBe(
      'Microphone permission denied. Grant access in your OS settings and try again.',
    );
  });
});
