import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import {
  RawTranscriptRecovery,
  type RawTranscriptRecoveryReceipt,
} from '../src/editor/raw-transcript-recovery';

class StateBackedEditorView {
  state: EditorState;
  readonly dispatch = vi.fn((spec: TransactionSpec) => {
    this.state = this.state.update(spec).state;
  });

  constructor(documentText: string) {
    this.state = EditorState.create({ doc: documentText });
  }
}

describe('RawTranscriptRecovery', () => {
  it('overwrites the prior record and copies only the latest raw transcript', async () => {
    const harness = createHarness('clean one');
    harness.recovery.record(harness.receipt({ rawText: 'raw one' }));
    harness.view.state = EditorState.create({ doc: 'clean two' });
    harness.recovery.record(
      harness.receipt({
        documentText: 'clean two',
        rawText: 'raw two',
        to: 'clean two'.length,
        transformedText: 'clean two',
      }),
    );

    expect(await harness.recovery.copyRawTranscript()).toBe(true);

    expect(harness.writeText).toHaveBeenCalledOnce();
    expect(harness.writeText).toHaveBeenCalledWith('raw two');
    expect(harness.feedback.show).toHaveBeenLastCalledWith({
      intent: 'success',
      key: 'raw-transcript-copied',
      message: 'Copied the raw transcript.',
    });
    expect(harness.recovery.restoreRawTranscript()).toBe(true);
    expect(harness.view.state.doc.toString()).toBe('raw two');
  });

  it('clears immediately when disabled and ignores records until re-enabled', () => {
    const harness = createHarness('clean');
    harness.recovery.record(harness.receipt({ rawText: 'private raw' }));

    harness.recovery.setEnabled(false);
    harness.recovery.record(harness.receipt({ rawText: 'must not persist' }));

    expect(harness.recovery.hasRecovery()).toBe(false);

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
  const feedback = { show: vi.fn() };
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
