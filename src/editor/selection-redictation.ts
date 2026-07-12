import type { App, Editor, EditorPosition, EventRef, TAbstractFile, TFile } from 'obsidian';

import type { SessionAcceptResult, SessionLifecycleCallbacks } from '../session/session';
import type { TranscriptRevision } from '../session/session-journal';
import { truncateTrailingText } from '../shared/text-truncation';
import type { UserFeedback } from '../shared/user-feedback';
import { buildNoteGlossary } from './note-surface';

type SelectionEditor = Pick<Editor, 'getRange' | 'getValue' | 'listSelections' | 'transaction'>;

export interface SelectionRedictationSnapshot {
  readonly documentText: string;
  readonly editor: SelectionEditor;
  readonly file: TFile;
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

interface MarkdownEditorViewLike {
  editor?: Editor;
  file: TFile | null;
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
      from: { ...from },
      to: { ...to },
    },
  };
}

export function isSelectionRedictationSnapshotCurrent(
  app: Pick<App, 'workspace'>,
  snapshot: SelectionRedictationSnapshot,
): boolean {
  if (!isSelectionRedictationTargetOpen(app, snapshot)) {
    return false;
  }

  try {
    return snapshot.editor.getValue() === snapshot.documentText;
  } catch {
    return false;
  }
}

export class SelectionRedictationSession {
  private cancelled = false;
  private disposed = false;
  private finalHandled = false;
  private readonly refs: Array<{ offref: (ref: EventRef) => void; ref: EventRef }> = [];
  private targetUnavailable = false;

  constructor(private readonly dependencies: SelectionRedictationSessionDependencies) {
    this.registerLifecycleSubscriptions();
  }

  acceptTranscript(revision: TranscriptRevision): SessionAcceptResult {
    if (this.disposed) {
      return { kind: 'rejected', reason: 'Selection re-dictation session is disposed.' };
    }
    if (this.cancelled) {
      return { kind: 'stale' };
    }
    if (!revision.isFinal) {
      return { kind: 'accepted' };
    }
    if (this.finalHandled) {
      return { kind: 'duplicate' };
    }

    this.finalHandled = true;
    this.applyFinalReplacement(revision.text.trim());
    return { kind: 'accepted' };
  }

  clearSessionProcessingMark(): void {}

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.releaseSubscriptions();
  }

  insertAdjacentToSessionRange(_blockText: string, _placement: 'above' | 'below'): boolean {
    return false;
  }

  markSessionRangeAsProcessing(): boolean {
    return false;
  }

  onUserCancellation(): void {
    if (this.cancelled || this.finalHandled) {
      return;
    }
    this.cancelled = true;
    this.dependencies.feedback.show({
      intent: 'information',
      key: 'selection-redictation-cancelled',
      message: 'Re-dictation cancelled. The selected text was left unchanged.',
    });
  }

  readCurrentSessionText(): string {
    return '';
  }

  readNoteGlossary(maxChars: number): { text: string; truncated: boolean } | null {
    if (!this.canReadTarget() || maxChars <= 0) {
      return null;
    }

    try {
      return buildNoteGlossary(this.dependencies.snapshot.editor.getValue(), maxChars);
    } catch {
      return null;
    }
  }

  readNoteText(maxChars: number): { text: string; truncated: boolean } | null {
    if (!this.canReadTarget() || maxChars <= 0) {
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

  readPriorUtterances(
    _maxCount: number,
    _maxCharsPerUtterance: number,
  ): Array<{ text: string; truncated: boolean }> {
    return [];
  }

  replaceSessionRangeWithCleaned(
    _cleanText: string,
    _options?: { rawTextForCallout?: string; showRawBelow?: boolean },
  ): boolean {
    return false;
  }

  setAnchorMode(_mode: 'hidden' | 'visible'): void {}

  private applyFinalReplacement(text: string): void {
    if (text.length === 0) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'selection-redictation-empty',
        message: 'No replacement speech was recognized. The selected text was left unchanged.',
      });
      return;
    }

    const { editor, from, to } = this.dependencies.snapshot;
    if (!this.canReadTarget()) {
      this.reportStaleSelection();
      return;
    }

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
    } catch (error) {
      this.dependencies.feedback.show({
        cause: error,
        intent: 'error',
        key: 'selection-redictation-failed',
        message: 'Could not replace the selected text. Select it again and retry.',
      });
    }
  }

  private canReadTarget(): boolean {
    return (
      !this.disposed &&
      !this.targetUnavailable &&
      isSelectionRedictationSnapshotCurrent(this.dependencies.app, this.dependencies.snapshot)
    );
  }

  private isTargetOpen(): boolean {
    return isSelectionRedictationTargetOpen(this.dependencies.app, this.dependencies.snapshot);
  }

  private reportStaleSelection(): void {
    this.dependencies.feedback.show({
      intent: 'warning',
      key: 'selection-redictation-stale',
      message:
        'The note changed while re-dictating. No text was replaced. Select the text again and retry.',
    });
  }

  private registerLifecycleSubscriptions(): void {
    const { vault, workspace } = this.dependencies.app;
    this.refs.push({
      offref: (ref) => workspace.offref(ref),
      ref: workspace.on('layout-change', () => {
        if (!this.disposed && !this.targetUnavailable && !this.isTargetOpen()) {
          this.targetUnavailable = true;
          this.dependencies.callbacks.onLockedNoteClosed();
        }
      }),
    });
    this.refs.push({
      offref: (ref) => vault.offref(ref),
      ref: vault.on('delete', (file) => {
        this.handleDelete(file);
      }),
    });
  }

  private handleDelete(file: TAbstractFile): void {
    if (this.disposed || this.targetUnavailable || file !== this.dependencies.snapshot.file) {
      return;
    }
    this.targetUnavailable = true;
    this.dependencies.callbacks.onLockedNoteDeleted();
  }

  private releaseSubscriptions(): void {
    while (this.refs.length > 0) {
      const subscription = this.refs.pop();
      if (subscription !== undefined) {
        subscription.offref(subscription.ref);
      }
    }
  }
}

function isSelectionRedictationTargetOpen(
  app: Pick<App, 'workspace'>,
  snapshot: SelectionRedictationSnapshot,
): boolean {
  return app.workspace.getLeavesOfType('markdown').some((leaf) => {
    const view = leaf.view as unknown as MarkdownEditorViewLike;
    return view.editor === snapshot.editor && view.file === snapshot.file;
  });
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
