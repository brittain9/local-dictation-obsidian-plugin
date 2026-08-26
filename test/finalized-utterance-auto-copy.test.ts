import { describe, expect, it, vi } from 'vitest';

import { FinalizedUtteranceAutoCopy } from '../src/dictation/finalized-utterance-auto-copy';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import type { ClipboardWriter } from '../src/shared/clipboard';

interface Deferred {
  promise: Promise<void>;
  reject(reason?: unknown): void;
  resolve(): void;
}

function deferred(): Deferred {
  let resolvePromise: () => void = () => {};
  let rejectPromise: (reason?: unknown) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function createHarness(
  overrides: Partial<PluginSettings> = {},
  initialClipboard: ClipboardWriter | null | undefined = {
    writeText: vi.fn(async (_text: string) => {}),
  },
) {
  let clipboard: ClipboardWriter | null | undefined = initialClipboard;
  const settings: PluginSettings = {
    ...DEFAULT_PLUGIN_SETTINGS,
    ...overrides,
  };
  const feedback = { show: vi.fn() };
  const getClipboard = vi.fn(() => clipboard);
  const autoCopy = new FinalizedUtteranceAutoCopy({
    feedback,
    getClipboard,
    getSettings: () => settings,
  });

  return {
    autoCopy,
    feedback,
    getClipboard,
    setClipboard(next: ClipboardWriter | null | undefined) {
      clipboard = next;
    },
  };
}

describe('FinalizedUtteranceAutoCopy', () => {
  it('does nothing while automatic copying is disabled', async () => {
    const harness = createHarness({ autoCopyFinalizedUtterances: false });

    await expect(harness.autoCopy.copyAcceptedUtterance('ignored')).resolves.toBe(false);

    expect(harness.getClipboard).not.toHaveBeenCalled();
    expect(harness.feedback.show).not.toHaveBeenCalled();
  });

  it('copies exact normalized text silently', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const harness = createHarness({ autoCopyFinalizedUtterances: true }, { writeText });

    await expect(harness.autoCopy.copyAcceptedUtterance(' \n Finalized phrase. \t')).resolves.toBe(
      true,
    );

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('Finalized phrase.');
    expect(harness.feedback.show).not.toHaveBeenCalled();
  });

  it('remains enabled when last-utterance recovery retention is disabled', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const harness = createHarness(
      {
        autoCopyFinalizedUtterances: true,
        retainLastUtterance: false,
      },
      { writeText },
    );

    await expect(harness.autoCopy.copyAcceptedUtterance('independent copy')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('independent copy');
  });

  it('serializes rapid Always-on phrases so the newest phrase is written last', async () => {
    const writes: string[] = [];
    const pending: Deferred[] = [];
    const writeText = vi.fn((text: string) => {
      writes.push(text);
      const write = deferred();
      pending.push(write);
      return write.promise;
    });
    const harness = createHarness(
      {
        autoCopyFinalizedUtterances: true,
        listeningMode: 'always_on',
      },
      { writeText },
    );

    const first = harness.autoCopy.copyAcceptedUtterance('first');
    const second = harness.autoCopy.copyAcceptedUtterance('second');
    const newest = harness.autoCopy.copyAcceptedUtterance('newest');

    await vi.waitFor(() => expect(writes).toEqual(['first']));
    pending[0]?.resolve();
    await vi.waitFor(() => expect(writes).toEqual(['first', 'second']));
    pending[1]?.resolve();
    await vi.waitFor(() => expect(writes).toEqual(['first', 'second', 'newest']));
    pending[2]?.resolve();

    await expect(Promise.all([first, second, newest])).resolves.toEqual([true, true, true]);
  });

  it('recovers after clipboard absence without leaking or showing success feedback', async () => {
    const privateText = 'private unavailable phrase';
    const writeText = vi.fn(async (_text: string) => {});
    const harness = createHarness({ autoCopyFinalizedUtterances: true }, null);

    await expect(harness.autoCopy.copyAcceptedUtterance(privateText)).resolves.toBe(false);
    harness.setClipboard({ writeText });
    await expect(harness.autoCopy.copyAcceptedUtterance('later phrase')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('later phrase');
    expect(JSON.stringify(harness.feedback.show.mock.calls)).not.toContain(privateText);
    expect(harness.feedback.show).toHaveBeenCalledOnce();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'error',
      key: 'finalized-utterance-auto-copy-failed',
      message: 'Could not automatically copy the finalized utterance.',
    });
  });

  it('contains a rejected write and continues with the next accepted phrase', async () => {
    const privateText = 'private rejected phrase';
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error(`clipboard rejected ${privateText}`))
      .mockResolvedValueOnce(undefined);
    const harness = createHarness({ autoCopyFinalizedUtterances: true }, { writeText });

    const failed = harness.autoCopy.copyAcceptedUtterance(privateText);
    const recovered = harness.autoCopy.copyAcceptedUtterance('newest accepted phrase');

    await expect(failed).resolves.toBe(false);
    await expect(recovered).resolves.toBe(true);
    expect(writeText.mock.calls.map(([text]) => text)).toEqual([
      privateText,
      'newest accepted phrase',
    ]);
    expect(JSON.stringify(harness.feedback.show.mock.calls)).not.toContain(privateText);
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'error',
      key: 'finalized-utterance-auto-copy-failed',
      message: 'Could not automatically copy the finalized utterance.',
    });
  });

  it('drops queued phrases when the plugin is disposed', async () => {
    const pending = deferred();
    const writeText = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined);
    const harness = createHarness({ autoCopyFinalizedUtterances: true }, { writeText });

    const inFlight = harness.autoCopy.copyAcceptedUtterance('already writing');
    const queued = harness.autoCopy.copyAcceptedUtterance('must not outlive the plugin');
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());

    harness.autoCopy.dispose();
    pending.resolve();

    await expect(inFlight).resolves.toBe(true);
    await expect(queued).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(harness.feedback.show).not.toHaveBeenCalled();
  });

  it('suppresses late failure feedback after disposal', async () => {
    const pending = deferred();
    const writeText = vi.fn(() => pending.promise);
    const harness = createHarness({ autoCopyFinalizedUtterances: true }, { writeText });

    const copy = harness.autoCopy.copyAcceptedUtterance('private phrase');
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    harness.autoCopy.dispose();
    pending.reject(new Error('clipboard failure containing private phrase'));

    await expect(copy).resolves.toBe(false);
    expect(harness.feedback.show).not.toHaveBeenCalled();
  });

  it('contains feedback presenter failures in the background queue', async () => {
    const harness = createHarness({ autoCopyFinalizedUtterances: true }, null);
    harness.feedback.show.mockImplementationOnce(() => {
      throw new Error('presenter failed');
    });

    await expect(harness.autoCopy.copyAcceptedUtterance('private phrase')).resolves.toBe(false);
  });
});
