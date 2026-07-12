import type { App, Editor, EditorPosition, TFile } from 'obsidian';
import type { SessionLifecycleCallbacks } from '../session/session';
import { truncateTrailingText } from '../shared/text-truncation';
import type { UserFeedback } from '../shared/user-feedback';
import { buildNoteGlossary } from './note-surface';
import {
  isSingleFinalEditorSnapshotCurrent,
  SingleFinalEditorSession,
  type SingleFinalEditorSnapshot,
} from './single-final-editor-session';

type SelectionEditor = Pick<Editor, 'getRange' | 'getValue' | 'listSelections' | 'transaction'>;

export interface SelectionRedictationSnapshot extends SingleFinalEditorSnapshot {
  readonly editor: SelectionEditor;
  readonly from: EditorPosition;
  readonly to: EditorPosition;
}

export type SelectionRedictationCaptureResult =
  | { kind: 'captured'; snapshot: SelectionRedictationSnapshot }
  | { kind: 'empty_selection' }
  | { kind: 'multiple_selections' }
  | { kind: 'no_file' };

interface SelectionRedictationSessionDependencies {
  app: Pick<App, 'vault' | 'workspace'>;
  callbacks: SessionLifecycleCallbacks;
  feedback: Pick<UserFeedback, 'show'>;
  snapshot: SelectionRedictationSnapshot;
}

export function canCaptureSelectionRedictation(
  editor: SelectionEditor,
  file: TFile | null,
): boolean {
  return captureSelectionRedictation(editor, file).kind === 'captured';
}

export function captureSelectionRedictation(
  editor: SelectionEditor,
  file: TFile | null,
): SelectionRedictationCaptureResult {
  if (file === null) {
    return { kind: 'no_file' };
  }

  const selections = editor.listSelections();
  if (selections.length === 0) {
    return { kind: 'empty_selection' };
  }
  if (selections.length !== 1) {
    return { kind: 'multiple_selections' };
  }

  const selection = selections[0];
  if (selection === undefined) {
    return { kind: 'empty_selection' };
  }
  const [from, to] = orderPositions(selection.anchor, selection.head);
  if (positionsEqual(from, to)) {
    return { kind: 'empty_selection' };
  }

  if (editor.getRange(from, to).length === 0) {
    return { kind: 'empty_selection' };
  }

  return {
    kind: 'captured',
    snapshot: {
      documentText: editor.getValue(),
      editor,
      file,
      filePath: file.path,
      from: { ...from },
      to: { ...to },
    },
  };
}

export function isSelectionRedictationSnapshotCurrent(
  app: Pick<App, 'workspace'>,
  snapshot: SelectionRedictationSnapshot,
): boolean {
  return isSingleFinalEditorSnapshotCurrent(app, snapshot);
}

export class SelectionRedictationSession extends SingleFinalEditorSession {
  constructor(private readonly dependencies: SelectionRedictationSessionDependencies) {
    super({
      app: dependencies.app,
      callbacks: dependencies.callbacks,
      disposedReason: 'Selection re-dictation session is disposed.',
      snapshot: dependencies.snapshot,
    });
  }

  override readNoteGlossary(maxChars: number): { text: string; truncated: boolean } | null {
    if (!this.isTargetCurrent() || maxChars <= 0) {
      return null;
    }

    try {
      return buildNoteGlossary(this.dependencies.snapshot.editor.getValue(), maxChars);
    } catch {
      return null;
    }
  }

  override readNoteText(maxChars: number): { text: string; truncated: boolean } | null {
    if (!this.isTargetCurrent() || maxChars <= 0) {
      return null;
    }

    try {
      const textBeforeSelection = this.dependencies.snapshot.editor
        .getRange({ ch: 0, line: 0 }, this.dependencies.snapshot.from)
        .trim();
      return textBeforeSelection.length > 0
        ? truncateTrailingText(textBeforeSelection, maxChars)
        : null;
    } catch {
      return null;
    }
  }

  protected handleFinalText(text: string): void {
    if (text.length === 0) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'selection-redictation-empty',
        message: 'No replacement speech was recognized. The selected text was left unchanged.',
      });
      return;
    }

    const { editor, from, to } = this.dependencies.snapshot;
    try {
      editor.transaction(
        {
          changes: [{ from, text, to }],
          selection: { from: advancePosition(from, text) },
        },
        'local-dictation-redictate-selection',
      );
      this.dependencies.feedback.show({
        intent: 'success',
        key: 'selection-redictation-complete',
        message: 'Replaced the selected text.',
      });
    } catch {
      // Do not forward the editor error as feedback cause: an implementation
      // may echo the transaction payload, which contains the spoken text.
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'selection-redictation-failed',
        message: 'Could not replace the selected text. Select it again and retry.',
      });
    }
  }

  protected reportCancellation(): void {
    this.dependencies.feedback.show({
      intent: 'information',
      key: 'selection-redictation-cancelled',
      message: 'Re-dictation cancelled. The selected text was left unchanged.',
    });
  }

  protected reportStaleTarget(): void {
    this.dependencies.feedback.show({
      intent: 'warning',
      key: 'selection-redictation-stale',
      message:
        'The note changed while re-dictating. No text was replaced. Select the text again and retry.',
    });
  }
}

function orderPositions(
  first: EditorPosition,
  second: EditorPosition,
): [EditorPosition, EditorPosition] {
  return comparePositions(first, second) <= 0 ? [first, second] : [second, first];
}

function comparePositions(first: EditorPosition, second: EditorPosition): number {
  return first.line === second.line ? first.ch - second.ch : first.line - second.line;
}

function positionsEqual(first: EditorPosition, second: EditorPosition): boolean {
  return first.line === second.line && first.ch === second.ch;
}

function advancePosition(position: EditorPosition, text: string): EditorPosition {
  const lines = text.split('\n');
  if (lines.length === 1) {
    return { ch: position.ch + text.length, line: position.line };
  }

  return {
    ch: lines.at(-1)?.length ?? 0,
    line: position.line + lines.length - 1,
  };
}
