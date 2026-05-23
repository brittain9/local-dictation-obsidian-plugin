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

function readOnce(spectrum: Uint8Array): number {
  // Fresh tap per call so smoothing state from prior reads cannot leak in.
  // Returns the high-band level after a single tick from a zero baseline.
  const { tap, analyser } = attachTap();
  analyser.setSpectrum(spectrum);
  const levels = tap.readBands() as Readonly<Float32Array>;
  return levels[5] as number;
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

  it('decays gradually between syllables (smooth release, no peak hold)', () => {
    const { tap: attached, analyser } = attachTap();
    // Saturate to ~1.0.
    analyser.setSpectrum(flatSpectrum(255));
    for (let i = 0; i < 10; i++) {
      attached.readBands();
    }
    // Drop to silence; the bar must start decaying immediately (no peak
    // hold) but the decay is gentle enough to feel smooth.
    analyser.setSpectrum(flatSpectrum(0));
    const afterOneTick = (attached.readBands() as Readonly<Float32Array>)[0] as number;
    // The release should be slow enough that the bar visibly lingers for one
    // frame, but still starts falling immediately (no peak hold).
    expect(afterOneTick).toBeLessThan(0.95);
    expect(afterOneTick).toBeGreaterThan(0.94);
  });

  it('normalizes both soft and loud inputs to the same ceiling (per-band AGC)', () => {
    // Per-band AGC: each band tracks its own running peak and rescales to it,
    // so the visualization is supposed to fill regardless of absolute level.
    // Soft /s/ and loud /s/ should both peg band 5 — that's how the right
    // side stays readable even when the speaker is quiet.
    const softReading = readOnce(flatSpectrum(90));
    const loudReading = readOnce(flatSpectrum(200));
    expect(softReading).toBeGreaterThan(0.9);
    expect(loudReading).toBeGreaterThan(0.9);
  });

  it('decays the per-band peak so a smaller follow-up onset eventually re-fills', () => {
    const { tap: attached, analyser } = attachTap();
    // Drive band 0 hard so its peak is fully loaded.
    analyser.setSpectrum(bandSpectrum(0, 255));
    for (let i = 0; i < 5; i++) {
      attached.readBands();
    }
    // Drop to silence and let the peak decay (~1s time constant, run plenty).
    analyser.setSpectrum(flatSpectrum(0));
    for (let i = 0; i < 600; i++) {
      attached.readBands();
    }
    // A modest follow-up input should now normalize back toward 1.0 because
    // the peak has decayed close to the floor.
    analyser.setSpectrum(bandSpectrum(0, 80));
    for (let i = 0; i < 5; i++) {
      attached.readBands();
    }
    const levels = attached.readBands() as Readonly<Float32Array>;
    expect(levels[0]).toBeGreaterThan(0.9);
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
