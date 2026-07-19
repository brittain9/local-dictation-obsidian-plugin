import { describe, expect, it, vi } from 'vitest';

import { PcmPlaybackQueue } from '../src/audio/pcm-playback-queue';

function createHarness() {
  const sources: Array<{
    onended: (() => void) | null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    close: vi.fn(async () => undefined),
    createBuffer: vi.fn((_channels: number, samples: number, sampleRate: number) => ({
      duration: samples / sampleRate,
      getChannelData: () => new Float32Array(samples),
    })),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null as (() => void) | null,
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(source);
      return source;
    }),
    currentTime: 1,
    destination: {},
    resume: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
  };
  const onDrained = vi.fn();
  const onPlayedThrough = vi.fn();
  const queue = new PcmPlaybackQueue(
    { onDrained, onPlayedThrough },
    () => context as unknown as AudioContext,
  );
  return { context, onDrained, onPlayedThrough, queue, sources };
}

describe('PcmPlaybackQueue', () => {
  it('decodes, schedules, and acknowledges chunks in playback order', () => {
    const harness = createHarness();
    harness.queue.start();
    harness.queue.enqueue(4, 24_000, new Uint8Array([0, 0, 255, 127]));
    expect(harness.context.createBuffer).toHaveBeenCalledWith(1, 2, 24_000);
    expect(harness.sources[0]?.start).toHaveBeenCalledWith(1);
    harness.queue.markGenerationComplete();
    expect(harness.onDrained).not.toHaveBeenCalled();
    harness.sources[0]?.onended?.();
    expect(harness.onPlayedThrough).toHaveBeenCalledWith(4);
    expect(harness.onDrained).toHaveBeenCalledOnce();
  });

  it('suspends and resumes the audio context', async () => {
    const harness = createHarness();
    harness.queue.start();
    await expect(harness.queue.togglePaused()).resolves.toBe(true);
    await expect(harness.queue.togglePaused()).resolves.toBe(false);
    expect(harness.context.suspend).toHaveBeenCalledOnce();
    expect(harness.context.resume).toHaveBeenCalledOnce();
  });
});
