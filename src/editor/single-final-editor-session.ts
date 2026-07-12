import type { App, Editor, EventRef, TAbstractFile, TFile } from 'obsidian';

import type { SessionAcceptResult, SessionLifecycleCallbacks } from '../session/session';
import type { TranscriptRevision } from '../session/session-journal';

type SingleFinalEditor = Pick<Editor, 'getValue'>;

export interface SingleFinalEditorSnapshot {
  readonly documentText: string;
  readonly editor: SingleFinalEditor;
  readonly file: TFile;
}

interface SingleFinalEditorSessionDependencies {
  app: Pick<App, 'vault' | 'workspace'>;
  callbacks: SessionLifecycleCallbacks;
  disposedReason: string;
  snapshot: SingleFinalEditorSnapshot;
}

interface MarkdownEditorViewLike {
  editor?: Editor;
  file: TFile | null;
}

export function isSingleFinalEditorSnapshotCurrent(
  app: Pick<App, 'workspace'>,
  snapshot: SingleFinalEditorSnapshot,
): boolean {
  try {
    return isTargetOpen(app, snapshot) && snapshot.editor.getValue() === snapshot.documentText;
  } catch {
    return false;
  }
}

export abstract class SingleFinalEditorSession {
  private cancelled = false;
  private disposed = false;
  private finalHandled = false;
  private readonly refs: Array<{ offref: (ref: EventRef) => void; ref: EventRef }> = [];
  private targetUnavailable = false;

  protected constructor(
    private readonly sessionDependencies: SingleFinalEditorSessionDependencies,
  ) {
    this.registerLifecycleSubscriptions();
  }

  acceptTranscript(revision: TranscriptRevision): SessionAcceptResult {
    if (this.disposed) {
      return { kind: 'rejected', reason: this.sessionDependencies.disposedReason };
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
    if (!this.isTargetCurrent()) {
      this.reportStaleTarget();
      return { kind: 'accepted' };
    }

    this.handleFinalText(revision.text.trim());
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
    this.reportCancellation();
  }

  readCurrentSessionText(): string {
    return '';
  }

  readNoteGlossary(_maxChars: number): { text: string; truncated: boolean } | null {
    return null;
  }

  readNoteText(_maxChars: number): { text: string; truncated: boolean } | null {
    return null;
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

  protected abstract handleFinalText(text: string): void;

  protected isTargetCurrent(): boolean {
    return (
      !this.disposed &&
      !this.targetUnavailable &&
      isSingleFinalEditorSnapshotCurrent(
        this.sessionDependencies.app,
        this.sessionDependencies.snapshot,
      )
    );
  }

  protected abstract reportCancellation(): void;

  protected abstract reportStaleTarget(): void;

  private registerLifecycleSubscriptions(): void {
    const { snapshot } = this.sessionDependencies;
    const { vault, workspace } = this.sessionDependencies.app;
    this.refs.push({
      offref: (ref) => workspace.offref(ref),
      ref: workspace.on('layout-change', () => {
        if (!this.disposed && !this.targetUnavailable && !isTargetOpen({ workspace }, snapshot)) {
          this.targetUnavailable = true;
          this.sessionDependencies.callbacks.onLockedNoteClosed();
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
    if (
      this.disposed ||
      this.targetUnavailable ||
      file !== this.sessionDependencies.snapshot.file
    ) {
      return;
    }
    this.targetUnavailable = true;
    this.sessionDependencies.callbacks.onLockedNoteDeleted();
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

function isTargetOpen(app: Pick<App, 'workspace'>, snapshot: SingleFinalEditorSnapshot): boolean {
  return app.workspace.getLeavesOfType('markdown').some((leaf) => {
    const view = leaf.view as unknown as MarkdownEditorViewLike;
    return view.editor === snapshot.editor && view.file === snapshot.file;
  });
}
