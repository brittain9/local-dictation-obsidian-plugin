import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import {
  RawTranscriptRecovery,
  type RawTranscriptRecoveryReceipt,
} from '../src/editor/raw-transcript-recovery';
import { StateBackedEditorView } from './fixtures/state-backed-editor-view';

describe('RawTranscriptRecovery', () => {
  it('announces enabled recovery with a transient keyed restore action without exposing content', () => {
    const rawText = 'private raw transcript';
    const transformedText = 'private transformed transcript';
    const harness = createHarness(transformedText, {
      rawText,
      to: transformedText.length,
      transformedText,
    });

    harness.recovery.record(harness.receipt());

    expect(harness.feedback.show).toHaveBeenCalledExactlyOnceWith({
      action: expect.objectContaining({
        label: 'Restore original',
        run: expect.any(Function),
      }),
      intent: 'warning',
      key: 'raw-transcript-recovery-available',
      message: 'Cleanup replaced the original transcript. You can restore it.',
    });
    expect(JSON.stringify(harness.feedback.show.mock.calls)).not.toContain(rawText);
    expect(JSON.stringify(harness.feedback.show.mock.calls)).not.toContain(transformedText);
  });

  it('restores the current receipt through the recovery notice action', () => {
    const harness = createHarness('clean');
    harness.recovery.record(harness.receipt({ rawText: 'raw' }));

    recoveryAction(harness).run();

    expect(harness.view.state.doc.toString()).toBe('raw');
    expect(harness.recovery.hasRecovery()).toBe(false);
    expect(harness.feedback.dismiss).toHaveBeenCalledWith('raw-transcript-recovery-available');
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'success',
      key: 'raw-transcript-restored',
      message: 'Restored the raw transcript.',
    });
  });

  it('overwrites the prior record and replaces its notice with an action for the latest receipt', () => {
    const harness = createHarness('clean one');
    harness.recovery.record(harness.receipt({ rawText: 'raw one' }));
    const firstAction = recoveryAction(harness);
    harness.view.state = EditorState.create({ doc: 'clean two' });
    harness.recovery.record(
      harness.receipt({
        documentText: 'clean two',
        rawText: 'raw two',
        to: 'clean two'.length,
        transformedText: 'clean two',
      }),
    );

    expect(harness.feedback.show).toHaveBeenCalledTimes(2);
    expect(harness.feedback.show.mock.calls.map(([request]) => request.key)).toEqual([
      'raw-transcript-recovery-available',
      'raw-transcript-recovery-available',
    ]);

    firstAction.run();
    expect(harness.view.state.doc.toString()).toBe('raw two');
  });

  it('copies the retained raw transcript without consuming recovery', async () => {
    const rawText = 'private raw transcript';
    const harness = createHarness('clean');
    harness.recovery.record(harness.receipt({ rawText }));

    expect(await harness.recovery.copyRawTranscript()).toBe(true);

    expect(harness.writeText).toHaveBeenCalledExactlyOnceWith(rawText);
    expect(harness.recovery.hasRecovery()).toBe(true);
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'success',
      key: 'raw-transcript-copied',
      message: 'Copied the raw transcript.',
    });
    expect(JSON.stringify(harness.feedback.show.mock.calls)).not.toContain(rawText);
  });

  it('clears immediately when disabled and ignores records until re-enabled', () => {
    const harness = createHarness('clean');
    harness.recovery.record(harness.receipt({ rawText: 'private raw' }));

    harness.recovery.setEnabled(false);
    harness.feedback.show.mockClear();
    harness.recovery.record(harness.receipt({ rawText: 'must not persist' }));

    expect(harness.recovery.hasRecovery()).toBe(false);
    expect(harness.feedback.dismiss).toHaveBeenCalledWith('raw-transcript-recovery-available');
    expect(harness.feedback.show).not.toHaveBeenCalled();

    harness.recovery.setEnabled(true);
    expect(harness.recovery.hasRecovery()).toBe(false);

    harness.recovery.record(harness.receipt({ rawText: 'new raw' }));
    expect(harness.recovery.hasRecovery()).toBe(true);
  });

  it('restores the exact range with one transaction and consumes the record', () => {
    const harness = createHarness('before clean after', {
      from: 'before '.length,
      rawText: 'raw words',
      to: 'before clean'.length,
      transformedText: 'clean',
    });
    harness.recovery.record(harness.receipt());

    expect(harness.recovery.restoreRawTranscript()).toBe(true);

    expect(harness.view.dispatch).toHaveBeenCalledOnce();
    expect(harness.view.dispatch).toHaveBeenCalledWith({
      changes: {
        from: 'before '.length,
        insert: 'raw words',
        to: 'before clean'.length,
      },
    });
    expect(harness.view.state.doc.toString()).toBe('before raw words after');
    expect(harness.recovery.hasRecovery()).toBe(false);
    expect(harness.feedback.dismiss).toHaveBeenCalledWith('raw-transcript-recovery-available');
  });

  it('refuses restore after any document change without editing the note', () => {
    const harness = createHarness('before clean after', {
      from: 'before '.length,
      rawText: 'raw words',
      to: 'before clean'.length,
      transformedText: 'clean',
    });
    harness.recovery.record(harness.receipt());
    harness.view.state = harness.view.state.update({
      changes: { from: 0, insert: 'changed ' },
    }).state;

    expect(harness.recovery.restoreRawTranscript()).toBe(false);

    expect(harness.view.dispatch).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'warning',
      key: 'raw-transcript-restore-stale',
      message: 'Could not restore the raw transcript because the note changed after cleanup.',
    });
  });

  it('keeps recovery available and reports stale restore when its notice action is used after a change', () => {
    const rawText = 'private raw transcript';
    const transformedText = 'private transformed transcript';
    const harness = createHarness(transformedText, {
      rawText,
      to: transformedText.length,
      transformedText,
    });
    harness.recovery.record(harness.receipt());
    harness.view.state = harness.view.state.update({
      changes: { from: 0, insert: 'changed ' },
    }).state;

    recoveryAction(harness).run();

    expect(harness.recovery.hasRecovery()).toBe(true);
    expect(harness.view.dispatch).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'warning',
      key: 'raw-transcript-restore-stale',
      message: 'Could not restore the raw transcript because the note changed after cleanup.',
    });
    expect(JSON.stringify(harness.feedback.show.mock.calls)).not.toContain(rawText);
    expect(JSON.stringify(harness.feedback.show.mock.calls)).not.toContain(transformedText);
  });

  it('keeps recovery available when the editor filters out the restore edit', () => {
    const harness = createHarness('clean');
    harness.recovery.record(harness.receipt({ rawText: 'raw' }));
    harness.view.dispatch.mockImplementationOnce((_spec) => {});

    expect(harness.recovery.restoreRawTranscript()).toBe(false);

    expect(harness.view.dispatch).toHaveBeenCalledOnce();
    expect(harness.recovery.hasRecovery()).toBe(true);
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'error',
      key: 'raw-transcript-restore-failed',
      message: 'Could not restore the raw transcript.',
    });
  });

  it('retains recovery without exposing transcript content when the restore edit fails', () => {
    const rawText = 'private raw transcript';
    const transformedText = 'private transformed transcript';
    const harness = createHarness(transformedText, {
      rawText,
      to: transformedText.length,
      transformedText,
    });
    harness.recovery.record(harness.receipt());
    harness.view.dispatch.mockImplementationOnce(() => {
      throw new Error(`editor rejected ${rawText} after reading ${transformedText}`);
    });

    expect(harness.recovery.restoreRawTranscript()).toBe(false);

    expect(harness.recovery.hasRecovery()).toBe(true);
    expect(harness.view.state.doc.toString()).toBe(transformedText);
    const serializedFeedback = JSON.stringify(harness.feedback.show.mock.calls);
    expect(serializedFeedback).not.toContain(rawText);
    expect(serializedFeedback).not.toContain(transformedText);
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'error',
      key: 'raw-transcript-restore-failed',
      message: 'Could not restore the raw transcript.',
    });
  });

  it('refuses restore when the exact editor and file target is no longer open', () => {
    const harness = createHarness('clean');
    harness.recovery.record(harness.receipt({ rawText: 'raw' }));
    harness.leaves.splice(0);

    expect(harness.recovery.restoreRawTranscript()).toBe(false);

    expect(harness.view.dispatch).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'warning',
      key: 'raw-transcript-target-unavailable',
      message:
        'Could not restore the raw transcript because its original note is no longer open in the same editor.',
    });
  });

  it('clears explicitly and hides recovery availability', () => {
    const harness = createHarness('clean');
    harness.recovery.record(harness.receipt({ rawText: 'raw' }));

    expect(harness.recovery.clearWithFeedback()).toBe(true);

    expect(harness.recovery.hasRecovery()).toBe(false);
    expect(harness.feedback.dismiss).toHaveBeenCalledWith('raw-transcript-recovery-available');
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'success',
      key: 'raw-transcript-recovery-cleared',
      message: 'Cleared the raw transcript recovery.',
    });
  });

  it('reports unavailable consistently when no recovery record exists', async () => {
    const harness = createHarness('clean');

    expect(harness.recovery.restoreRawTranscript()).toBe(false);
    expect(await harness.recovery.copyRawTranscript()).toBe(false);
    expect(harness.recovery.clearWithFeedback()).toBe(false);

    expect(harness.feedback.show).toHaveBeenCalledTimes(3);
    for (const [request] of harness.feedback.show.mock.calls) {
      expect(request).toEqual({
        intent: 'information',
        key: 'raw-transcript-recovery-unavailable',
        message: 'No raw transcript recovery is available.',
      });
    }
  });

  it('reports copy failure without leaking either transcript through feedback', async () => {
    const rawText = 'private raw transcript';
    const transformedText = 'private transformed transcript';
    const harness = createHarness(transformedText, {
      rawText,
      to: transformedText.length,
      transformedText,
      writeText: vi.fn(async (text: string) => {
        throw new Error(`clipboard rejected: ${text}`);
      }),
    });
    harness.recovery.record(harness.receipt());

    expect(await harness.recovery.copyRawTranscript()).toBe(false);

    const serializedFeedback = JSON.stringify(harness.feedback.show.mock.calls);
    expect(serializedFeedback).not.toContain(rawText);
    expect(serializedFeedback).not.toContain(transformedText);
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'error',
      key: 'raw-transcript-copy-failed',
      message: 'Could not copy the raw transcript.',
    });
  });
});

function recoveryAction(harness: ReturnType<typeof createHarness>): { run: () => void } {
  const [request] = harness.feedback.show.mock.calls.at(-1) ?? [];
  if (request?.action === undefined) {
    throw new Error('Expected a recovery notice action.');
  }
  return request.action;
}

function createHarness(
  documentText: string,
  options: {
    from?: number;
    rawText?: string;
    to?: number;
    transformedText?: string;
    writeText?: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  } = {},
) {
  const file = { path: 'note.md' } as TFile;
  const view = new StateBackedEditorView(documentText);
  const leaves = [
    {
      view: {
        editor: { cm: view as unknown as EditorView },
        file,
      },
    },
  ];
  const feedback = { dismiss: vi.fn(), show: vi.fn() };
  const writeText = options.writeText ?? vi.fn(async (_text: string) => {});
  const recovery = new RawTranscriptRecovery({
    feedback,
    getClipboard: () => ({ writeText }),
    workspace: { getLeavesOfType: () => leaves as never },
  });
  const defaults = {
    documentText,
    file,
    filePath: file.path,
    from: options.from ?? 0,
    rawText: options.rawText ?? 'raw',
    to: options.to ?? documentText.length,
    transformedText: options.transformedText ?? documentText,
    view: view as unknown as EditorView,
  } satisfies RawTranscriptRecoveryReceipt;

  return {
    feedback,
    leaves,
    receipt: (overrides: Partial<RawTranscriptRecoveryReceipt> = {}) => ({
      ...defaults,
      ...overrides,
    }),
    recovery,
    view,
    writeText,
  };
}
