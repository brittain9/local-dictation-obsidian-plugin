import { describe, expect, it } from 'vitest';

import { AudioFrameFlowControl } from '../src/audio/audio-frame-flow-control';

describe('AudioFrameFlowControl', () => {
  it('pauses at catching-up or worse and resumes only when the queue is normal', async () => {
    const flow = new AudioFrameFlowControl();
    flow.setTier('catching_up');

    let resumed = false;
    const waiting = flow.waitUntilReady(new AbortController().signal).then(() => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);

    flow.setTier('falling_behind');
    flow.setTier('catching_up');
    await Promise.resolve();
    expect(resumed).toBe(false);

    flow.setTier('normal');
    await waiting;
    expect(resumed).toBe(true);
  });

  it('releases a paused producer through abort without waiting for a queue event', async () => {
    const flow = new AudioFrameFlowControl();
    const abortController = new AbortController();
    flow.setTier('saturated');

    const waiting = flow.waitUntilReady(abortController.signal);
    abortController.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
