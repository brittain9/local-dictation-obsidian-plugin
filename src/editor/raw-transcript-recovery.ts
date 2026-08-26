import type { EditorView } from '@codemirror/view';
import type { App, TFile } from 'obsidian';

import { type ClipboardProvider, tryWriteClipboardText } from '../shared/clipboard';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';

interface MarkdownLeafLike {
  view?: {
    editor?: { cm?: EditorView };
    file: TFile | null;
  };
}

export interface RawTranscriptRecoveryReceipt {
  readonly documentText: string;
  readonly file: TFile;
  readonly filePath: string;
  readonly from: number;
  readonly rawText: string;
  readonly to: number;
  readonly transformedText: string;
  readonly view: EditorView;
}

interface RawTranscriptRecoveryDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getClipboard: ClipboardProvider;
  workspace: Pick<App['workspace'], 'getLeavesOfType'>;
}

export class RawTranscriptRecovery {
  private enabled = true;
  private receipt: RawTranscriptRecoveryReceipt | null = null;

  constructor(private readonly dependencies: RawTranscriptRecoveryDependencies) {}

  hasRecovery(): boolean {
    return this.enabled && this.receipt !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  record(receipt: RawTranscriptRecoveryReceipt): void {
    if (!this.enabled) {
      return;
    }

    this.receipt = { ...receipt };
  }

  clear(): void {
    this.receipt = null;
  }

  clearWithFeedback(): boolean {
    if (!this.hasRecovery()) {
      this.reportUnavailable();
      return false;
    }

    this.clear();
    this.dependencies.feedback.show({
      intent: 'success',
      key: 'raw-transcript-recovery-cleared',
      message: t('notice.rawTranscriptCleared'),
    });
    return true;
  }

  async copyRawTranscript(): Promise<boolean> {
    const receipt = this.receipt;
    if (!this.enabled || receipt === null) {
      this.reportUnavailable();
      return false;
    }

    if (!(await tryWriteClipboardText(this.dependencies.getClipboard, receipt.rawText))) {
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'raw-transcript-copy-failed',
        message: t('notice.rawTranscriptCopyFailed'),
      });
      return false;
    }

    this.dependencies.feedback.show({
      intent: 'success',
      key: 'raw-transcript-copied',
      message: t('notice.rawTranscriptCopied'),
    });
    return true;
  }

  restoreRawTranscript(): boolean {
    const receipt = this.receipt;
    if (!this.enabled || receipt === null) {
      this.reportUnavailable();
      return false;
    }

    if (!this.isExactTargetOpen(receipt)) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'raw-transcript-target-unavailable',
        message: t('notice.rawTranscriptTargetUnavailable'),
      });
      return false;
    }

    let currentDocument: string;
    try {
      currentDocument = receipt.view.state.doc.toString();
    } catch {
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'raw-transcript-restore-failed',
        message: t('notice.rawTranscriptRestoreFailed'),
      });
      return false;
    }
    if (
      currentDocument !== receipt.documentText ||
      !isValidRange(receipt.from, receipt.to, currentDocument.length) ||
      currentDocument.slice(receipt.from, receipt.to) !== receipt.transformedText
    ) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'raw-transcript-restore-stale',
        message: t('notice.rawTranscriptChanged'),
      });
      return false;
    }

    let actualRestoredDocument: string;
    try {
      // One dispatch produces one undoable document edit. No selection or
      // follow-up transaction is needed; CodeMirror maps the existing caret.
      receipt.view.dispatch({
        changes: {
          from: receipt.from,
          insert: receipt.rawText,
          to: receipt.to,
        },
      });
      actualRestoredDocument = receipt.view.state.doc.toString();
    } catch {
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'raw-transcript-restore-failed',
        message: t('notice.rawTranscriptRestoreFailed'),
      });
      return false;
    }

    const restoredDocument = `${currentDocument.slice(0, receipt.from)}${receipt.rawText}${currentDocument.slice(receipt.to)}`;
    if (actualRestoredDocument !== restoredDocument) {
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'raw-transcript-restore-failed',
        message: t('notice.rawTranscriptRestoreFailed'),
      });
      return false;
    }

    if (this.receipt === receipt) {
      this.clear();
    }
    this.dependencies.feedback.show({
      intent: 'success',
      key: 'raw-transcript-restored',
      message: t('notice.rawTranscriptRestored'),
    });
    return true;
  }

  private isExactTargetOpen(receipt: RawTranscriptRecoveryReceipt): boolean {
    // TFile identity survives a vault rename while its path changes. Match the
    // live file and editor objects so a safe rename does not invalidate recovery.
    let matchingLeaves = 0;
    for (const leaf of this.dependencies.workspace.getLeavesOfType(
      'markdown',
    ) as unknown as MarkdownLeafLike[]) {
      if (leaf.view?.file !== receipt.file || leaf.view.editor?.cm !== receipt.view) {
        continue;
      }
      matchingLeaves += 1;
    }

    return matchingLeaves === 1;
  }

  private reportUnavailable(): void {
    this.dependencies.feedback.show({
      intent: 'information',
      key: 'raw-transcript-recovery-unavailable',
      message: t('notice.rawTranscriptUnavailable'),
    });
  }
}

function isValidRange(from: number, to: number, documentLength: number): boolean {
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    to >= from &&
    to <= documentLength
  );
}
