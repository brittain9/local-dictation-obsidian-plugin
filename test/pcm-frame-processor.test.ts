import { describe, expect, it } from 'vitest';

import { PcmFrameProcessor } from '../src/audio/pcm-frame-processor';

const FRAME_SIZE = 320;

function concatInt16(frames: Int16Array[]): Int16Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  return out;
}

function quantize(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function rampF32(count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = i / count;
  }
  return out;
}

function constantF32(count: number, value: number): Float32Array {
  const out = new Float32Array(count);
  out.fill(value);
  return out;
}

function sineF32(count: number, frequencyHz: number, sampleRateHz: number): Float32Array {
  const out = new Float32Array(count);
  const twoPiFOverFs = (2 * Math.PI * frequencyHz) / sampleRateHz;
  for (let i = 0; i < count; i += 1) {
    out[i] = Math.sin(twoPiFOverFs * i);
  }
  return out;
}

describe('PcmFrameProcessor', () => {
  it('emits the input verbatim under 16 kHz → 16 kHz identity', () => {
    const processor = new PcmFrameProcessor({ sourceSampleRate: 16000, targetSampleRate: 16000 });
    const input = rampF32(4800);

    const frames = processor.push(input);
    const flattened = concatInt16(frames);

    expect(frames).toHaveLength(4800 / FRAME_SIZE);
    expect(flattened).toHaveLength(4800);
    for (let i = 0; i < input.length; i += 1) {
      expect(flattened[i]).toBe(quantize(input[i] ?? 0));
    }
  });

  it('decimates 48 kHz → 16 kHz constant input to a constant output stream', () => {
    const processor = new PcmFrameProcessor({ sourceSampleRate: 48000, targetSampleRate: 16000 });
    const input = constantF32(14400, 0.5);

    const frames = processor.push(input);
    const flattened = concatInt16(frames);
    const expectedSample = quantize(0.5);

    expect(flattened).toHaveLength(4800);
    expect(frames).toHaveLength(15);
    for (let i = 0; i < flattened.length; i += 1) {
      expect(flattened[i]).toBe(expectedSample);
    }
  });

  it('resamples 44.1 kHz → 16 kHz without drift over two seconds', () => {
    const processor = new PcmFrameProcessor({ sourceSampleRate: 44100, targetSampleRate: 16000 });
    const secondOne = sineF32(44100, 1000, 44100);
    const secondTwo = sineF32(44100, 1000, 44100);

    const framesSecondOne = processor.push(secondOne);
    expect(framesSecondOne).toHaveLength(50);
    expect(concatInt16(framesSecondOne)).toHaveLength(16000);

    // The last frame must carry interpolated sine values, not zeros from an
    // uninitialized tail. A pure sine that happens to cross zero at a single
    // frame index is fine; check peak magnitude across the whole frame.
    const lastFrame = framesSecondOne[framesSecondOne.length - 1];
    expect(lastFrame).toBeDefined();
    if (lastFrame === undefined) return;
    let lastFramePeak = 0;
    for (const sample of lastFrame) {
      const magnitude = Math.abs(sample);
      if (magnitude > lastFramePeak) lastFramePeak = magnitude;
    }
    // Quantized 1 kHz sine should reach ~0x7fff; 1000 is far below that
    // ceiling and clears any rounding-noise floor by a wide margin.
    expect(lastFramePeak).toBeGreaterThan(1000);

    const framesSecondTwo = processor.push(secondTwo);
    // 32000 - 16000 = 16000 more outputs across the second second → 50 frames,
    // identical to the first second. Anything else is sub-Hz drift accumulating.
    expect(framesSecondTwo).toHaveLength(50);
    expect(concatInt16(framesSecondTwo)).toHaveLength(16000);
  });

  it('preserves continuity across frame boundaries when buffering across push() calls', () => {
    const processor = new PcmFrameProcessor({ sourceSampleRate: 16000, targetSampleRate: 16000 });
    const totalSamples = 640;
    const firstChunkLength = 333;
    const ramp = rampF32(totalSamples);
    const firstChunk = ramp.subarray(0, firstChunkLength);
    const secondChunk = ramp.subarray(firstChunkLength);

    const framesFirst = processor.push(firstChunk);
    expect(framesFirst).toHaveLength(1);
    const frameOne = framesFirst[0];
    expect(frameOne).toBeDefined();
    if (frameOne === undefined) return;
    expect(frameOne[frameOne.length - 1]).toBe(quantize(ramp[FRAME_SIZE - 1] ?? 0));

    const framesSecond = processor.push(secondChunk);
    expect(framesSecond).toHaveLength(1);
    const frameTwo = framesSecond[0];
    expect(frameTwo).toBeDefined();
    if (frameTwo === undefined) return;

    // Adjacent samples across the seam must come from adjacent input samples.
    // If the resampler dropped or duplicated a sample at the boundary, the
    // delta would be 0 or 2 ulps instead of the ramp's natural step.
    expect(frameTwo[0]).toBe(quantize(ramp[FRAME_SIZE] ?? 0));
    expect(frameTwo[frameTwo.length - 1]).toBe(quantize(ramp[totalSamples - 1] ?? 0));
  });

  it('drops buffered partial-frame samples on reset() so they cannot bleed into later frames', () => {
    const processor = new PcmFrameProcessor({ sourceSampleRate: 16000, targetSampleRate: 16000 });

    const framesBeforeReset = processor.push(constantF32(100, -1));
    expect(framesBeforeReset).toHaveLength(0); // 100 samples buffered, no frame yet

    processor.reset();

    const framesAfterReset = processor.push(constantF32(FRAME_SIZE, 0.5));
    expect(framesAfterReset).toHaveLength(1);
    const frame = framesAfterReset[0];
    expect(frame).toBeDefined();
    if (frame === undefined) return;

    const expectedSample = quantize(0.5);
    for (let i = 0; i < frame.length; i += 1) {
      expect(frame[i]).toBe(expectedSample);
    }
  });

  it('rejects non-positive sample rates and non-integer frame sizes', () => {
    expect(() => new PcmFrameProcessor({ sourceSampleRate: 0, targetSampleRate: 16000 })).toThrow(
      /positive numbers/,
    );
    expect(
      () => new PcmFrameProcessor({ sourceSampleRate: 16000, targetSampleRate: Number.NaN }),
    ).toThrow(/positive numbers/);
    expect(
      () =>
        new PcmFrameProcessor({
          samplesPerFrame: 0,
          sourceSampleRate: 16000,
          targetSampleRate: 16000,
        }),
    ).toThrow(/positive integer/);
  });
});
