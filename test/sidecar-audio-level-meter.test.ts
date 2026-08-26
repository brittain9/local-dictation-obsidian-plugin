import { describe, expect, it } from 'vitest';

import { SidecarAudioLevelMeter } from '../src/audio/sidecar-audio-level-meter';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('SidecarAudioLevelMeter', () => {
  it('returns null until a session is bound', () => {
    const meter = new SidecarAudioLevelMeter();

    expect(meter.readBands()).toBeNull();
  });

  it('smooths active session level events into AudioBandReader output', () => {
    const now = 0;
    const meter = new SidecarAudioLevelMeter(() => now);
    meter.bindSession(SESSION_ID);

    meter.update({
      bands: [0, 0.25, 0.5, 0.75, 1, 2],
      sessionId: SESSION_ID,
      type: 'audio_level',
    });

    const first = Float32Array.from(meter.readBands() ?? []);
    const second = Float32Array.from(meter.readBands() ?? []);

    expect(first[1]).toBeGreaterThan(0);
    expect(second[1]).toBeGreaterThan(first[1] ?? 0);
    expect(second[5]).toBeLessThanOrEqual(1);
  });

  it('ignores stale session level events and decays after updates stop', () => {
    let now = 0;
    const meter = new SidecarAudioLevelMeter(() => now);
    meter.bindSession(SESSION_ID);
    meter.update({
      bands: [1, 1, 1, 1, 1, 1],
      sessionId: SESSION_ID,
      type: 'audio_level',
    });
    const active = Float32Array.from(meter.readBands() ?? []);

    meter.update({
      bands: [0, 0, 0, 0, 0, 0],
      sessionId: crypto.randomUUID(),
      type: 'audio_level',
    });
    now = 1_000;
    const decayed = Float32Array.from(meter.readBands() ?? []);

    expect(active[0]).toBeGreaterThan(0);
    expect(decayed[0]).toBeLessThan(active[0] ?? 0);
  });

  it('lifts a quiet but steady band toward full scale via AGC', () => {
    const now = 0;
    const meter = new SidecarAudioLevelMeter(() => now);
    meter.bindSession(SESSION_ID);
    meter.update({
      bands: [0, 0, 0.06, 0, 0, 0],
      sessionId: SESSION_ID,
      type: 'audio_level',
    });

    let band = 0;
    for (let i = 0; i < 60; i++) {
      band = (meter.readBands() ?? [])[2] ?? 0;
    }

    expect(band).toBeGreaterThan(0.9);
  });

  it('gates a sub-floor band so room tone stays low', () => {
    const now = 0;
    const meter = new SidecarAudioLevelMeter(() => now);
    meter.bindSession(SESSION_ID);
    meter.update({
      bands: [0.01, 0.01, 0.01, 0.01, 0.01, 0.01],
      sessionId: SESSION_ID,
      type: 'audio_level',
    });

    let band = 0;
    for (let i = 0; i < 60; i++) {
      band = (meter.readBands() ?? [])[0] ?? 0;
    }

    expect(band).toBeLessThan(0.6);
  });

  it('clears only the bound session', () => {
    const meter = new SidecarAudioLevelMeter();
    meter.bindSession(SESSION_ID);

    meter.clearSession(crypto.randomUUID());
    expect(meter.readBands()).not.toBeNull();

    meter.clearSession(SESSION_ID);
    expect(meter.readBands()).toBeNull();
  });
});
