import type { Editor, EditorPosition } from 'obsidian';

import type { UserFeedback } from '../shared/user-feedback';

export type UtteranceRecoveryEditor = Pick<
  Editor,
  'getCursor' | 'getLine' | 'replaceRange' | 'setCursor'
>;

export class LastUtteranceRecovery {
  private text: string | null = null;

  constructor(private readonly feedback: Pick<UserFeedback, 'show'>) {}

  hasUtterance(): boolean {
    return this.text !== null;
  }

  clear(): void {
    this.text = null;
  }

  recordFinalizedUtterance(text: string): void {
    const normalized = text.trim();
    if (normalized.length > 0) {
      this.text = normalized;
    }
  }

  reinsert(editor: UtteranceRecoveryEditor): boolean {
    if (this.text === null) {
      this.feedback.show({
        intent: 'information',
        key: 'last-utterance-unavailable',
        message: 'No finalized utterance is available to reinsert.',
      });
      return false;
    }

    try {
      const cursor = editor.getCursor('head');
      const line = editor.getLine(cursor.line);
      const insertion = formatInsertion(this.text, line, cursor.ch);
      editor.replaceRange(insertion, cursor);
      editor.setCursor(advancePosition(cursor, insertion));
      this.feedback.show({
        intent: 'success',
        key: 'last-utterance-reinserted',
        message: 'Reinserted the last finalized utterance.',
      });
      return true;
    } catch (error) {
      this.feedback.show({
        cause: error,
        intent: 'error',
        key: 'last-utterance-reinsert-failed',
        message: 'Could not reinsert the last finalized utterance.',
      });
      return false;
    }
  }
}

function formatInsertion(text: string, line: string, cursorCh: number): string {
  const characterBefore = cursorCh > 0 ? line.charAt(cursorCh - 1) : '';
  const characterAfter = line.charAt(cursorCh);
  const prefix = needsSpaceBefore(characterBefore, text.charAt(0)) ? ' ' : '';
  const suffix = needsSpaceAfter(text.charAt(text.length - 1), characterAfter) ? ' ' : '';

  return `${prefix}${text}${suffix}`;
}

function needsSpaceBefore(characterBefore: string, firstInsertedCharacter: string): boolean {
  if (characterBefore.length === 0 || /\s/u.test(characterBefore)) {
    return false;
  }
  if ('([{'.includes(characterBefore) || '.,!?;:)]}'.includes(firstInsertedCharacter)) {
    return false;
  }
  return true;
}

function needsSpaceAfter(lastInsertedCharacter: string, characterAfter: string): boolean {
  if (characterAfter.length === 0 || /\s/u.test(characterAfter)) {
    return false;
  }
  if ('([{'.includes(lastInsertedCharacter) || '.,!?;:)]}'.includes(characterAfter)) {
    return false;
  }
  return true;
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
