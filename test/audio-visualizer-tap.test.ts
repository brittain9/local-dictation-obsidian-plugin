import { beforeEach, describe, expect, it } from 'vitest';

import { AudioVisualizerTap } from '../src/audio/audio-visualizer-tap';

const FFT_SIZE = 512;
const BIN_COUNT = FFT_SIZE / 2;
const SAMPLE_RATE = 48000;

class FakeAnalyserNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
  readonly frequencyBinCount = BIN_COUNT;
  bytes: Uint8Array = new Uint8Array(BIN_COUNT);
  disconnectCalls = 0;

  setSpectrum(values: Uint8Array | number[]): void {
    this.bytes = values instanceof Uint8Array ? values : new Uint8Array(values);
  }

  getByteFrequencyData(buffer: Uint8Array): void {
    buffer.set(this.bytes);
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

class FakeSourceNode {
  connectCalls: AnalyserNode[] = [];
  connect(target: AnalyserNode): void {
    this.connectCalls.push(target);
  }
}

class FakeAudioContext {
  readonly sampleRate = SAMPLE_RATE;
  lastAnalyser: FakeAnalyserNode | null = null;

  createAnalyser(): FakeAnalyserNode {
    const analyser = new FakeAnalyserNode();
    this.lastAnalyser = analyser;
    return analyser;
  }
}

function attachTap(): {
  tap: AudioVisualizerTap;
  analyser: FakeAnalyserNode;
  source: FakeSourceNode;
  context: FakeAudioContext;
} {
  const tap = new AudioVisualizerTap();
  const context = new FakeAudioContext();
  const source = new FakeSourceNode();
  tap.attach(context as unknown as AudioContext, source as unknown as AudioNode);
  const analyser = context.lastAnalyser;
  if (analyser === null) {
    throw new Error('FakeAudioContext did not produce an analyser.');
  }
  return { tap, analyser, source, context };
}

function flatSpectrum(value: number): Uint8Array {
  const buffer = new Uint8Array(BIN_COUNT);
  buffer.fill(value);
  return buffer;
}

function bandSpectrum(bandIndex: number, value: number): Uint8Array {
  const buffer = new Uint8Array(BIN_COUNT);
  const hzPerBin = SAMPLE_RATE / 2 / BIN_COUNT;
  const edges = [80, 200, 500, 1000, 2000, 4000, 8000];
  const lo = Math.max(1, Math.floor((edges[bandIndex] as number) / hzPerBin));
  const hi = Math.min(BIN_COUNT, Math.floor((edges[bandIndex + 1] as number) / hzPerBin));
  for (let i = lo; i < hi; i++) {
    buffer[i] = value;
  }
  return buffer;
}

describe('AudioVisualizerTap', () => {
  let tap: AudioVisualizerTap;

  beforeEach(() => {
    tap = new AudioVisualizerTap();
  });

  it('returns null before attach', () => {
    expect(tap.readBands()).toBeNull();
  });

  it('returns null after detach', () => {
    const { tap: attached } = attachTap();
    attached.detach();
    expect(attached.readBands()).toBeNull();
  });

  it('configures the AnalyserNode for snappy custom smoothing', () => {
    const { analyser, source } = attachTap();
    expect(analyser.fftSize).toBe(FFT_SIZE);
    expect(analyser.smoothingTimeConstant).toBe(0);
    expect(source.connectCalls).toHaveLength(1);
  });

  it('rejects double-attach', () => {
    const { tap: attached, context } = attachTap();
    expect(() =>
      attached.attach(
        context as unknown as AudioContext,
        new FakeSourceNode() as unknown as AudioNode,
      ),
    ).toThrow(/already attached/);
  });

  it('produces zero bands for a silent spectrum', () => {
    const { tap: attached, analyser } = attachTap();
    analyser.setSpectrum(flatSpectrum(0));
    const bands = attached.readBands();
    expect(bands).not.toBeNull();
    for (const level of bands as Readonly<Float32Array>) {
      expect(level).toBe(0);
    }
  });

  it('routes low-frequency energy to the lowest band and not to the highest', () => {
    const { tap: attached, analyser } = attachTap();
    analyser.setSpectrum(bandSpectrum(0, 255));
    // First read uses attack coefficient against zero baseline.
    const bands = attached.readBands();
    expect(bands).not.toBeNull();
    const levels = bands as Readonly<Float32Array>;
    expect(levels[0]).toBeGreaterThan(0.5);
    expect(levels[5]).toBe(0);
  });

  it('routes high-frequency energy to the highest band and not to the lowest', () => {
    const { tap: attached, analyser } = attachTap();
    analyser.setSpectrum(bandSpectrum(5, 255));
    const bands = attached.readBands();
    expect(bands).not.toBeNull();
    const levels = bands as Readonly<Float32Array>;
    expect(levels[5]).toBeGreaterThan(0.5);
    expect(levels[0]).toBe(0);
  });

  it('snaps to the peak on the first tick after silence', () => {
    const { tap: attached, analyser } = attachTap();
    analyser.setSpectrum(flatSpectrum(255));
    // PPM-style attack: a single tick should already be near the ceiling.
    const first = (attached.readBands() as Readonly<Float32Array>)[0] as number;
    expect(first).toBeGreaterThan(0.9);
  });

  it('releases slowly between syllables', () => {
    const { tap: attached, analyser } = attachTap();
    // Saturate to ~1.0.
    analyser.setSpectrum(flatSpectrum(255));
    for (let i = 0; i < 10; i++) {
      attached.readBands();
    }
    // Drop to silence and confirm the level decays gently, not in one frame.
    analyser.setSpectrum(flatSpectrum(0));
    const afterOneTick = (attached.readBands() as Readonly<Float32Array>)[0] as number;
    // BAND_RELEASE[0] = 0.053 → previous * (1 - 0.053) ≈ 0.947 after one tick.
    expect(afterOneTick).toBeGreaterThan(0.85);
    expect(afterOneTick).toBeLessThan(0.97);
  });

  it('boosts midrange amplitude via the perceptual pow(0.7) curve and band gain', () => {
    const { tap: attached, analyser } = attachTap();
    // Half-amplitude input across all bands.
    analyser.setSpectrum(flatSpectrum(128));
    const level = (attached.readBands() as Readonly<Float32Array>)[2] as number;
    // mean = 128/255 ≈ 0.502; BAND_GAIN_LINEAR[2] = 10^(2/20) ≈ 1.259
    // → lifted ≈ 0.632; pow(0.632, 0.7) ≈ 0.722; after attack 0.95 → ≈ 0.686.
    // A purely linear mapping (no curve, no gain) would land near 0.477.
    expect(level).toBeGreaterThan(0.65);
  });

  it('lifts high bands far more than low bands on a flat quiet spectrum (pre-emphasis)', () => {
    const { tap: attached, analyser } = attachTap();
    // Quiet uniform spectrum: every band sees the same byte input.
    analyser.setSpectrum(flatSpectrum(64));
    const levels = attached.readBands() as Readonly<Float32Array>;
    const lowBand = levels[0] as number;
    const highBand = levels[5] as number;
    // Same audio energy in every band → after BAND_GAIN [0, 0, 2, 5, 8, 11] dB,
    // band 5 must end up well above band 0. Linear ratio is ~3.5×.
    expect(highBand).toBeGreaterThan(lowBand * 2);
  });

  it('disconnects the analyser on detach', () => {
    const { tap: attached, analyser } = attachTap();
    attached.detach();
    expect(analyser.disconnectCalls).toBe(1);
  });

  it('can be reattached after detach', () => {
    const { tap: attached } = attachTap();
    attached.detach();
    const context = new FakeAudioContext();
    const source = new FakeSourceNode();
    attached.attach(context as unknown as AudioContext, source as unknown as AudioNode);
    expect(source.connectCalls).toHaveLength(1);
    expect(attached.readBands()).not.toBeNull();
  });
});
