import type { Editor, EditorPosition } from 'obsidian';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';

const UNICODE_WORD_AT_START = /^(?:\p{L}|\p{M}|\p{N}|\p{Pc})/u;
const UNICODE_WORD_AT_END = /(?:\p{L}|\p{M}|\p{N}|\p{Pc})$/u;

export type UtteranceRecoveryEditor = Pick<
  Editor,
  'getCursor' | 'getLine' | 'replaceRange' | 'setCursor'
>;

interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

interface LastUtteranceRecoveryDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getClipboard: () => ClipboardWriter | null | undefined;
}

export class LastUtteranceRecovery {
  private enabled = true;
  private text: string | null = null;

  constructor(private readonly dependencies: LastUtteranceRecoveryDependencies) {}

  hasUtterance(): boolean {
    return this.enabled && this.text !== null;
  }

  clear(): void {
    this.text = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  recordFinalizedUtterance(text: string): void {
    if (!this.enabled) {
      return;
    }
    const normalized = text.trim();
    if (normalized.length > 0) {
      this.text = normalized;
    }
  }

  async copyLastUtterance(): Promise<boolean> {
    const text = this.text;
    if (!this.enabled || text === null) {
      this.reportUnavailable();
      return false;
    }

    try {
      const clipboard = this.dependencies.getClipboard();
      if (clipboard === null || clipboard === undefined) {
        throw new Error('Clipboard API unavailable.');
      }
      await clipboard.writeText(text);
    } catch {
      // Do not attach the clipboard error as feedback cause: a hostile or buggy
      // implementation could echo the private text it was asked to copy.
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'last-utterance-copy-failed',
        message: t('notice.lastUtteranceCopyFailed'),
      });
      return false;
    }

    this.dependencies.feedback.show({
      intent: 'success',
      key: 'last-utterance-copied',
      message: t('notice.lastUtteranceCopied'),
    });
    return true;
  }

  reinsert(editor: UtteranceRecoveryEditor): boolean {
    if (this.text === null) {
      this.reportUnavailable();
      return false;
    }

    try {
      const cursor = editor.getCursor('head');
      const line = editor.getLine(cursor.line);
      const insertion = formatInsertion(this.text, line, cursor.ch);
      editor.replaceRange(insertion, cursor);
      editor.setCursor(advancePosition(cursor, insertion));
      this.dependencies.feedback.show({
        intent: 'success',
        key: 'last-utterance-reinserted',
        message: t('notice.lastUtteranceReinserted'),
      });
      return true;
    } catch (error) {
      this.dependencies.feedback.show({
        cause: error,
        intent: 'error',
        key: 'last-utterance-reinsert-failed',
        message: t('notice.lastUtteranceReinsertFailed'),
      });
      return false;
    }
  }

  private reportUnavailable(): void {
    this.dependencies.feedback.show({
      intent: 'information',
      key: 'last-utterance-unavailable',
      message: t('notice.lastUtteranceUnavailable'),
    });
  }
}

function formatInsertion(text: string, line: string, cursorCh: number): string {
  const textBeforeCursor = line.slice(0, cursorCh);
  const textAfterCursor = line.slice(cursorCh);
  const prefix = needsWordBoundarySpace(textBeforeCursor, text) ? ' ' : '';
  const suffix = needsWordBoundarySpace(text, textAfterCursor) ? ' ' : '';

  return `${prefix}${text}${suffix}`;
}

function needsWordBoundarySpace(before: string, after: string): boolean {
  return UNICODE_WORD_AT_END.test(before) && UNICODE_WORD_AT_START.test(after);
}

function advancePosition(position: EditorPosition, insertion: string): EditorPosition {
  const lines = insertion.split('\n');
  if (lines.length === 1) {
    return { ch: position.ch + insertion.length, line: position.line };
  }

  return {
    ch: lines.at(-1)?.length ?? 0,
    line: position.line + lines.length - 1,
  };
}
