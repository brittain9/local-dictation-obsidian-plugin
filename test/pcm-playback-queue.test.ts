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
  const onCurrentSequenceChange = vi.fn();
  const onPlayedThrough = vi.fn();
  const queue = new PcmPlaybackQueue(
    { onCurrentSequenceChange, onDrained, onPlayedThrough },
    () => context as unknown as AudioContext,
  );
  return { context, onCurrentSequenceChange, onDrained, onPlayedThrough, queue, sources };
}

describe('PcmPlaybackQueue', () => {
  it('decodes, schedules, and acknowledges chunks in playback order', () => {
    const harness = createHarness();
    harness.queue.start();
    harness.queue.enqueue(4, 24_000, new Uint8Array([0, 0, 255, 127]));
    expect(harness.context.createBuffer).toHaveBeenCalledWith(1, 2, 24_000);
    expect(harness.sources[0]?.start).toHaveBeenCalledWith(1);
    expect(harness.onCurrentSequenceChange).toHaveBeenLastCalledWith(4);
    harness.queue.markGenerationComplete();
    expect(harness.onDrained).not.toHaveBeenCalled();
    harness.sources[0]?.onended?.();
    expect(harness.onPlayedThrough).toHaveBeenCalledWith(4);
    expect(harness.onDrained).toHaveBeenCalledOnce();
  });

  it('does not report a pre-buffered sequence until the current source ends', () => {
    const harness = createHarness();
    harness.queue.start();
    harness.queue.enqueue(0, 24_000, new Uint8Array([0, 0, 255, 127]));
    harness.queue.enqueue(1, 24_000, new Uint8Array([0, 0, 255, 127]));

    expect(harness.onCurrentSequenceChange).toHaveBeenLastCalledWith(0);
    harness.sources[0]?.onended?.();
    expect(harness.onCurrentSequenceChange).toHaveBeenLastCalledWith(1);
  });

  it('reports a playback gap without exposing a future sequence', () => {
    const harness = createHarness();
    harness.queue.start();
    harness.queue.enqueue(0, 24_000, new Uint8Array([0, 0, 255, 127]));

    harness.sources[0]?.onended?.();
    expect(harness.onCurrentSequenceChange).toHaveBeenLastCalledWith(null);

    harness.queue.enqueue(1, 24_000, new Uint8Array([0, 0, 255, 127]));
    expect(harness.onCurrentSequenceChange).toHaveBeenLastCalledWith(1);
  });

  it('suspends and resumes the audio context', async () => {
    const harness = createHarness();
    harness.queue.start();
    await expect(harness.queue.togglePaused()).resolves.toBe(true);
    await expect(harness.queue.togglePaused()).resolves.toBe(false);
    expect(harness.context.suspend).toHaveBeenCalledOnce();
    expect(harness.context.resume).toHaveBeenCalledOnce();
  });

  it('does not resurrect paused state when playback stops during suspend', async () => {
    const harness = createHarness();
    const suspend: { complete?: () => void } = {};
    const suspended = new Promise<undefined>((resolve) => {
      suspend.complete = () => resolve(undefined);
    });
    harness.context.suspend.mockReturnValue(suspended);
    harness.queue.start();

    const pausing = harness.queue.togglePaused();
    harness.queue.stop();
    if (suspend.complete === undefined) throw new Error('suspend did not start');
    suspend.complete();

    await expect(pausing).resolves.toBe(false);
    expect(harness.queue.isPaused()).toBe(false);
  });

  it('suppresses callbacks from sources after a stop and restart', () => {
    const harness = createHarness();
    harness.queue.start();
    harness.queue.enqueue(0, 24_000, new Uint8Array([0, 0, 255, 127]));
    const staleSource = harness.sources[0];

    harness.queue.start();
    staleSource?.onended?.();

    expect(harness.onPlayedThrough).not.toHaveBeenCalled();
    expect(harness.onCurrentSequenceChange).toHaveBeenLastCalledWith(0);
  });
});
