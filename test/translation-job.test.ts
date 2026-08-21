import { describe, expect, it, vi } from 'vitest';

import { TranslationJob } from '../src/translation/translation-job';

describe('TranslationJob', () => {
  it('keeps running when the only view detaches and replays completion on reattach', async () => {
    let resolve!: (value: { kind: 'translated'; sourceUnitsKept: number; text: string }) => void;
    const run = vi.fn(
      (_options: { signal: AbortSignal }) =>
        new Promise<{ kind: 'translated'; sourceUnitsKept: number; text: string }>((done) => {
          resolve = done;
        }),
    );
    const job = new TranslationJob({
      engineId: 'tencent_hy_mt',
      run,
      sourceLanguage: 'fr',
      targetLanguage: 'ja',
    });
    const firstView = vi.fn();
    const detach = job.subscribe(firstView);

    job.start();
    detach();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0].signal.aborted).toBe(false);

    resolve({ kind: 'translated', sourceUnitsKept: 0, text: '完了' });
    await vi.waitFor(() => expect(job.state().phase).toBe('completed'));
    const reopened = vi.fn();
    job.subscribe(reopened);
    expect(reopened).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'completed', text: '完了' }),
    );
  });

  it('propagates explicit cancellation only once', () => {
    const run = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const job = new TranslationJob({
      engineId: 'tencent_hy_mt',
      run,
      sourceLanguage: 'en',
      targetLanguage: 'de',
    });
    job.start();
    job.cancel();
    job.cancel();
    expect(run.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(job.state().phase).toBe('cancelled');
  });
});
