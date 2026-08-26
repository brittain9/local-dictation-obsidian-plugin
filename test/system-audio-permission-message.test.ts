import { describe, expect, it } from 'vitest';

import {
  formatSystemAudioErrorMessage,
  formatSystemAudioProbeResultMessage,
  formatSystemAudioSidecarErrorMessage,
  isElectronVersionOlderThan,
} from '../src/audio/system-audio-permission-message';

const PERMISSION_MESSAGE =
  'System-audio recording permission is off for Obsidian. Open System Settings → Privacy & Security → Screen & System Audio Recording, enable Obsidian, and try again.';

describe('formatSystemAudioErrorMessage', () => {
  it('appends the Obsidian installer caveat for older Electron permission builds', () => {
    const message = formatSystemAudioErrorMessage(
      PERMISSION_MESSAGE,
      'system_audio_permission_denied',
      '39.5.9',
    );

    expect(message).toContain(PERMISSION_MESSAGE);
    expect(message).toContain('Download a fresh installer from obsidian.md');
  });

  it('leaves permission copy unchanged once Electron includes the macOS permission key', () => {
    expect(
      formatSystemAudioErrorMessage(PERMISSION_MESSAGE, 'system_audio_permission_denied', '39.6.0'),
    ).toBe(PERMISSION_MESSAGE);
  });

  it('does not append installer copy to unrelated system-audio errors', () => {
    expect(
      formatSystemAudioErrorMessage('device unavailable', 'system_audio_capture_failed', '39.5.9'),
    ).toBe('device unavailable');
  });
});

describe('formatSystemAudioProbeResultMessage', () => {
  it('translates known sidecar codes instead of rendering their raw messages', () => {
    expect(
      formatSystemAudioProbeResultMessage(
        { code: 'system_audio_capture_failed', message: 'raw Rust capture failure' },
        '39.6.0',
      ),
    ).toBe('Could not start system-audio capture.');
    expect(
      formatSystemAudioProbeResultMessage(
        { code: 'system_audio_unsupported', message: 'raw Rust unsupported message' },
        '39.6.0',
      ),
    ).toContain("System-audio capture isn't available on this platform yet.");
  });

  it('uses raw sidecar copy only for unknown codes', () => {
    expect(
      formatSystemAudioProbeResultMessage(
        { code: 'future_system_audio_error', message: 'Future sidecar detail' },
        '39.6.0',
      ),
    ).toBe('Future sidecar detail');
  });

  it('uses generic fallback copy when an unknown failed probe has no message', () => {
    expect(
      formatSystemAudioProbeResultMessage({ code: 'future_system_audio_error' }, '39.6.0'),
    ).toBe('System audio is not ready.');
  });

  it('uses translated permission copy before adding the outdated-installer caveat', () => {
    const message = formatSystemAudioProbeResultMessage(
      { code: 'system_audio_permission_denied', message: 'raw Rust permission message' },
      '39.5.9',
    );

    expect(message).toContain(PERMISSION_MESSAGE);
    expect(message).not.toContain('raw Rust permission message');
    expect(message).toContain('Download a fresh installer from obsidian.md');
  });
});

describe('formatSystemAudioSidecarErrorMessage', () => {
  it('enriches permission-denied sidecar errors without handling unrelated errors', () => {
    const error = Object.assign(new Error(PERMISSION_MESSAGE), {
      code: 'system_audio_permission_denied',
    });

    expect(formatSystemAudioSidecarErrorMessage(error, '39.5.9')).toContain(
      'Download a fresh installer from obsidian.md',
    );
    expect(
      formatSystemAudioSidecarErrorMessage(
        Object.assign(new Error('device unavailable'), { code: 'system_audio_capture_failed' }),
        '39.5.9',
      ),
    ).toBeNull();
  });
});

describe('isElectronVersionOlderThan', () => {
  it('compares semantic version components numerically', () => {
    expect(isElectronVersionOlderThan('39.5.9', '39.6.0')).toBe(true);
    expect(isElectronVersionOlderThan('39.6.0', '39.6.0')).toBe(false);
    expect(isElectronVersionOlderThan('40.0.0', '39.6.0')).toBe(false);
    expect(isElectronVersionOlderThan(undefined, '39.6.0')).toBe(false);
  });
});
