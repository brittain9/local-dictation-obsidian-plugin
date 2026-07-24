import { describe, expect, it, vi } from 'vitest';

import { openReadAloudModelRecovery } from '../src/tts/read-aloud-model-recovery';

describe('openReadAloudModelRecovery', () => {
  it('opens production recovery directly on Text to speech', async () => {
    const openModelPicker = vi.fn(async () => {});

    await openReadAloudModelRecovery(openModelPicker);

    expect(openModelPicker).toHaveBeenCalledExactlyOnceWith({ initialTask: 'tts' });
  });

  it('preserves model-picker failures for actionable retry feedback', async () => {
    const failure = new Error('sidecar setup failed');
    const openModelPicker = vi.fn(async () => {
      throw failure;
    });

    await expect(openReadAloudModelRecovery(openModelPicker)).rejects.toBe(failure);
  });
});
