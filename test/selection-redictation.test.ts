import type { App, Editor, EditorPosition, EventRef, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import {
  canCaptureSelectionRedictation,
  captureSelectionRedictation,
  SelectionRedictationSession,
  type SelectionRedictationSnapshot,
} from '../src/editor/selection-redictation';
import { transcript } from './fixtures/transcript';

describe('selection re-dictation capture', () => {
  it('captures one non-empty selection in document order without mutating the editor', () => {
    const editor = createEditor({
      selection: {
        anchor: { ch: 12, line: 2 },
        head: { ch: 4, line: 2 },
      },
      selectedText: 'original',
    });
    const file = { path: 'note.md' } as TFile;

    const result = captureSelectionRedictation(editor.editor, file);

    expect(result).toEqual({
      kind: 'captured',
      snapshot: {
        documentText: 'Context before selection original',
        editor: editor.editor,
        file,
        filePath: 'note.md',
        from: { ch: 4, line: 2 },
        to: { ch: 12, line: 2 },
      },
    });
    expect(editor.transaction).not.toHaveBeenCalled();
  });

  it('rejects empty and multiple selections without side effects', () => {
    const file = { path: 'note.md' } as TFile;
    const empty = createEditor({
      selection: {
        anchor: { ch: 4, line: 2 },
        head: { ch: 4, line: 2 },
      },
      selectedText: '',
    });
    const multiple = createEditor({
      selection: {
        anchor: { ch: 0, line: 0 },
        head: { ch: 3, line: 0 },
      },
      selectedText: 'one',
    });
    multiple.listSelections.mockReturnValue([
      { anchor: { ch: 0, line: 0 }, head: { ch: 3, line: 0 } },
      { anchor: { ch: 0, line: 1 }, head: { ch: 3, line: 1 } },
    ]);
    const none = createEditor({
      selection: {
        anchor: { ch: 0, line: 0 },
        head: { ch: 0, line: 0 },
      },
      selectedText: '',
    });
    none.listSelections.mockReturnValue([]);

    expect(captureSelectionRedictation(empty.editor, file)).toEqual({
      kind: 'empty_selection',
    });
    expect(canCaptureSelectionRedictation(empty.editor, file)).toBe(false);
    expect(captureSelectionRedictation(none.editor, file)).toEqual({ kind: 'empty_selection' });
    expect(canCaptureSelectionRedictation(multiple.editor, file)).toBe(false);
    expect(captureSelectionRedictation(multiple.editor, null)).toEqual({ kind: 'no_file' });
    expect(empty.transaction).not.toHaveBeenCalled();
    expect(multiple.transaction).not.toHaveBeenCalled();
  });
});

describe('SelectionRedictationSession', () => {
  it('replaces the unchanged snapshot exactly once in one undoable editor transaction', () => {
    const harness = createSessionHarness();

    expect(
      harness.session.acceptTranscript(
        transcript({
          isFinal: false,
          text: 'partial',
          utteranceId: 'selection-1',
        }),
      ),
    ).toEqual({ kind: 'accepted' });
    expect(harness.editor.transaction).not.toHaveBeenCalled();

    expect(
      harness.session.acceptTranscript(
        transcript({ text: '  replacement text  ', utteranceId: 'selection-1' }),
      ),
    ).toEqual({ kind: 'accepted' });

    expect(harness.editor.transaction).toHaveBeenCalledWith(
      {
        changes: [
          {
            from: { ch: 4, line: 1 },
            text: 'replacement text',
            to: { ch: 12, line: 1 },
          },
        ],
        selection: { from: { ch: 20, line: 1 } },
      },
      'local-dictation-redictate-selection',
    );
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'success',
      key: 'selection-redictation-complete',
      message: 'Replaced the selected text.',
    });

    expect(
      harness.session.acceptTranscript(
        transcript({ revision: 1, text: 'must not apply', utteranceId: 'selection-2' }),
      ),
    ).toEqual({ kind: 'duplicate' });
    expect(harness.editor.transaction).toHaveBeenCalledOnce();
  });

  it('leaves the note unchanged when its captured document changes', () => {
    const harness = createSessionHarness();
    harness.editor.getValue.mockReturnValue('user-edited document');

    harness.session.acceptTranscript(
      transcript({ text: 'replacement text', utteranceId: 'selection-1' }),
    );

    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'selection-redictation-stale',
      message:
        'The note changed while re-dictating. No text was replaced. Select the text again and retry.',
    });
  });

  it('rejects a prepended repeated string even when the old range still matches', () => {
    const harness = createSessionHarness();
    harness.editor.getRange.mockReturnValue('original');
    harness.editor.getValue.mockReturnValue(`original ${harness.snapshot.documentText}`);

    expect(harness.editor.getRange(harness.snapshot.from, harness.snapshot.to)).toBe('original');

    harness.session.acceptTranscript(
      transcript({ text: 'replacement text', utteranceId: 'selection-1' }),
    );

    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'selection-redictation-stale' }),
    );
  });

  it('leaves the note unchanged when the target editor is no longer open', () => {
    const harness = createSessionHarness();
    harness.setTargetOpen(false);

    harness.session.acceptTranscript(
      transcript({ text: 'replacement text', utteranceId: 'selection-1' }),
    );

    expect(harness.editor.getValue).not.toHaveBeenCalled();
    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'selection-redictation-stale' }),
    );
  });

  it('leaves the note unchanged when the editor now belongs to another file', () => {
    const harness = createSessionHarness();
    harness.setOpenFile({ path: 'other.md' } as TFile);

    harness.session.acceptTranscript(
      transcript({ text: 'replacement text', utteranceId: 'selection-1' }),
    );

    expect(harness.editor.getValue).not.toHaveBeenCalled();
    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'selection-redictation-stale' }),
    );
  });

  it('leaves the note unchanged when the captured file is renamed', () => {
    const harness = createSessionHarness();
    harness.renameFile('renamed.md');

    harness.session.acceptTranscript(
      transcript({ text: 'replacement text', utteranceId: 'selection-1' }),
    );

    expect(harness.editor.getValue).not.toHaveBeenCalled();
    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'selection-redictation-stale' }),
    );
  });

  it('keeps the original selection when the first final is empty', () => {
    const harness = createSessionHarness();

    expect(
      harness.session.acceptTranscript(transcript({ text: '  \n  ', utteranceId: 'selection-1' })),
    ).toEqual({ kind: 'accepted' });
    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'selection-redictation-empty',
      message: 'No replacement speech was recognized. The selected text was left unchanged.',
    });

    expect(
      harness.session.acceptTranscript(
        transcript({ revision: 1, text: 'late replacement', utteranceId: 'selection-1' }),
      ),
    ).toEqual({ kind: 'duplicate' });
    expect(harness.editor.transaction).not.toHaveBeenCalled();
  });

  it('never mutates the note after user cancellation', () => {
    const harness = createSessionHarness();

    harness.session.onUserCancellation();

    expect(
      harness.session.acceptTranscript(
        transcript({ text: 'late replacement', utteranceId: 'selection-1' }),
      ),
    ).toEqual({ kind: 'stale' });
    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'information',
      key: 'selection-redictation-cancelled',
      message: 'Re-dictation cancelled. The selected text was left unchanged.',
    });
  });

  it('cancels through the existing target lifecycle when the note closes', () => {
    const harness = createSessionHarness();
    harness.setTargetOpen(false);

    harness.emitLayoutChange();
    harness.emitLayoutChange();

    expect(harness.callbacks.onLockedNoteClosed).toHaveBeenCalledOnce();
  });

  it('cancels once when the target file is deleted and ignores unrelated deletes', () => {
    const harness = createSessionHarness();

    harness.emitDelete({ path: 'other.md' } as TFile);
    expect(harness.callbacks.onLockedNoteDeleted).not.toHaveBeenCalled();

    harness.emitDelete();
    harness.emitDelete();

    expect(harness.callbacks.onLockedNoteDeleted).toHaveBeenCalledOnce();
    expect(
      harness.session.acceptTranscript(
        transcript({ text: 'late replacement', utteranceId: 'selection-1' }),
      ),
    ).toEqual({ kind: 'accepted' });
    expect(harness.editor.transaction).not.toHaveBeenCalled();
  });

  it('releases lifecycle subscriptions once and rejects every revision after disposal', () => {
    const harness = createSessionHarness();

    harness.session.dispose();
    harness.session.dispose();

    expect(harness.workspace.offref).toHaveBeenCalledOnce();
    expect(harness.vault.offref).toHaveBeenCalledOnce();
    expect(
      harness.session.acceptTranscript(
        transcript({ text: 'late replacement', utteranceId: 'selection-1' }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'Selection re-dictation session is disposed.' });
    expect(harness.editor.transaction).not.toHaveBeenCalled();
  });
});

function createSessionHarness() {
  const editor = createEditor({
    selection: {
      anchor: { ch: 4, line: 1 },
      head: { ch: 12, line: 1 },
    },
    selectedText: 'original',
  });
  const file = { path: 'note.md' } as TFile;
  let targetOpen = true;
  let openFile: TFile = file;
  let layoutChange: (() => void) | null = null;
  let deleted: ((file: TFile) => void) | null = null;
  const workspace = {
    getLeavesOfType: vi.fn(() =>
      targetOpen ? [{ view: { editor: editor.editor as unknown as Editor, file: openFile } }] : [],
    ),
    offref: vi.fn(),
    on: vi.fn((_event: string, callback: () => void) => {
      layoutChange = callback;
      return {} as EventRef;
    }),
  };
  const vault = {
    offref: vi.fn(),
    on: vi.fn((_event: string, callback: (target: TFile) => void) => {
      deleted = callback;
      return {} as EventRef;
    }),
  };
  const callbacks = {
    onLockedNoteClosed: vi.fn(),
    onLockedNoteDeleted: vi.fn(),
    onSurfaceDesynchronized: vi.fn(),
  };
  const feedback = { show: vi.fn() };
  const snapshot: SelectionRedictationSnapshot = {
    documentText: 'Context before selection original',
    editor: editor.editor,
    file,
    filePath: 'note.md',
    from: { ch: 4, line: 1 },
    to: { ch: 12, line: 1 },
  };
  const session = new SelectionRedictationSession({
    app: { vault, workspace } as unknown as Pick<App, 'vault' | 'workspace'>,
    callbacks,
    feedback,
    snapshot,
  });

  return {
    callbacks,
    editor,
    emitDelete: (deletedFile: TFile = file) => deleted?.(deletedFile),
    emitLayoutChange: () => layoutChange?.(),
    feedback,
    renameFile: (path: string) => {
      Object.assign(file, { path });
    },
    session,
    snapshot,
    setOpenFile: (nextFile: TFile) => {
      openFile = nextFile;
    },
    setTargetOpen: (open: boolean) => {
      targetOpen = open;
    },
    vault,
    workspace,
  };
}

function createEditor({
  selectedText,
  selection,
}: {
  selectedText: string;
  selection: { anchor: EditorPosition; head: EditorPosition };
}) {
  const getRange = vi.fn((from: EditorPosition, _to?: EditorPosition) =>
    from.line === 0 ? 'Context before selection' : selectedText,
  );
  const getValue = vi.fn(() => `Context before selection ${selectedText}`);
  const listSelections = vi.fn(() => [selection]);
  const transaction = vi.fn();
  const editor = {
    getRange,
    getValue,
    listSelections,
    transaction,
  } as unknown as SelectionRedictationSnapshot['editor'];

  return { editor, getRange, getValue, listSelections, transaction };
}
