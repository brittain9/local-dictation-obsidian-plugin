import { describe, expect, it } from 'vitest';

import { PcmFrameProcessor } from '../src/audio/pcm-frame-processor';

describe('PcmFrameProcessor', () => {
  it('mixes input channels and emits complete PCM frames', () => {
    const processor = new PcmFrameProcessor({
      samplesPerFrame: 2,
      sourceSampleRate: 16_000,
      targetSampleRate: 16_000,
    });

    const frames = processor.pushChannels([
      new Float32Array([0.5, -0.5]),
      new Float32Array([1, -1]),
    ]);

    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0] ?? [])).toEqual([24_575, -24_576]);
  });

  it('returns no frames when no input channels are present', () => {
    const processor = new PcmFrameProcessor({
      samplesPerFrame: 2,
      sourceSampleRate: 16_000,
      targetSampleRate: 16_000,
    });

    expect(processor.pushChannels([])).toEqual([]);
  });
});
