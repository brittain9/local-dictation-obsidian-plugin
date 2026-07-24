import type { EditorPosition } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import {
  LastUtteranceRecovery,
  type UtteranceRecoveryEditor,
} from '../src/dictation/last-utterance-recovery';

describe('LastUtteranceRecovery', () => {
  it('keeps recovery unavailable until a non-empty finalized utterance is recorded', () => {
    const { feedback, recovery } = createRecoveryHarness();

    recovery.recordFinalizedUtterance('   ');

    expect(recovery.hasUtterance()).toBe(false);
    expect(recovery.reinsert(createEditorHarness('').editor)).toBe(false);
    expect(feedback.show).toHaveBeenCalledWith({
      intent: 'information',
      key: 'last-utterance-unavailable',
      message: 'No finalized utterance is available to reinsert.',
    });
  });

  it('clears the in-memory utterance explicitly', () => {
    const { recovery } = createRecoveryHarness();
    recovery.recordFinalizedUtterance('temporary text');

    recovery.clear();

    expect(recovery.hasUtterance()).toBe(false);
  });

  it('clears immediately when disabled and ignores text until re-enabled', () => {
    const { recovery } = createRecoveryHarness();
    recovery.recordFinalizedUtterance('temporary text');

    recovery.setEnabled(false);
    recovery.recordFinalizedUtterance('must not be retained');

    expect(recovery.hasUtterance()).toBe(false);

    recovery.setEnabled(true);
    expect(recovery.hasUtterance()).toBe(false);

    recovery.recordFinalizedUtterance('new recovery text');
    expect(recovery.hasUtterance()).toBe(true);
  });

  it('copies the exact normalized finalized utterance and confirms success', async () => {
    const { feedback, recovery, writeText } = createRecoveryHarness();
    recovery.recordFinalizedUtterance('  normalized utterance  ');

    expect(await recovery.copyLastUtterance()).toBe(true);

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('normalized utterance');
    expect(feedback.show).toHaveBeenCalledWith({
      intent: 'success',
      key: 'last-utterance-copied',
      message: 'Copied the last finalized utterance.',
    });
  });

  it('keeps the utterance available and hides its text when copying fails', async () => {
    const privateText = 'private finalized utterance';
    const { feedback, recovery, writeText } = createRecoveryHarness({
      writeText: vi.fn(async (text: string) => {
        throw new Error(`clipboard rejected: ${text}`);
      }),
    });
    recovery.recordFinalizedUtterance(privateText);

    expect(await recovery.copyLastUtterance()).toBe(false);

    expect(writeText).toHaveBeenCalledWith(privateText);
    expect(recovery.hasUtterance()).toBe(true);
    expect(JSON.stringify(feedback.show.mock.calls)).not.toContain(privateText);
    expect(feedback.show).toHaveBeenCalledWith({
      intent: 'error',
      key: 'last-utterance-copy-failed',
      message: 'Could not copy the last finalized utterance.',
    });
  });

  it('inserts at the cursor without replacing a selection and separates adjacent words', () => {
    const { feedback, recovery } = createRecoveryHarness();
    const editor = createEditorHarness('beforeafter', { ch: 6, line: 0 });
    recovery.recordFinalizedUtterance(' restored text ');

    expect(recovery.reinsert(editor.editor)).toBe(true);

    expect(editor.getCursor).toHaveBeenCalledWith('head');
    expect(editor.replaceRange).toHaveBeenCalledWith(' restored text ', { ch: 6, line: 0 });
    expect(editor.replaceRange.mock.calls[0]).toHaveLength(2);
    expect(editor.setCursor).toHaveBeenCalledWith({ ch: 21, line: 0 });
    expect(feedback.show).toHaveBeenCalledWith({
      intent: 'success',
      key: 'last-utterance-reinserted',
      message: 'Reinserted the last finalized utterance.',
    });
  });

  it('does not add a trailing space before closing punctuation', () => {
    const { recovery } = createRecoveryHarness();
    const editor = createEditorHarness('()', { ch: 1, line: 0 });
    recovery.recordFinalizedUtterance('aside');

    recovery.reinsert(editor.editor);

    expect(editor.replaceRange).toHaveBeenCalledWith('aside', { ch: 1, line: 0 });
  });

  it.each([
    ['emphasis', '****', 2, '**restored**'],
    ['inline code', '``', 1, '`restored`'],
    ['quotes', '""', 1, '"restored"'],
  ])('does not synthesize spaces inside Markdown %s', (_label, line, ch, expectedLine) => {
    const { recovery } = createRecoveryHarness();
    const editor = createEditorHarness(line, { ch, line: 0 });
    recovery.recordFinalizedUtterance('restored');

    recovery.reinsert(editor.editor);

    const insertion = editor.replaceRange.mock.calls[0]?.[0] ?? '';
    expect(`${line.slice(0, ch)}${insertion}${line.slice(ch)}`).toBe(expectedLine);
  });

  it('separates adjacent Unicode word characters', () => {
    const { recovery } = createRecoveryHarness();
    const editor = createEditorHarness('𐐀界', { ch: 2, line: 0 });
    recovery.recordFinalizedUtterance('é');

    recovery.reinsert(editor.editor);

    expect(editor.replaceRange).toHaveBeenCalledWith(' é ', { ch: 2, line: 0 });
  });

  it('places the cursor after a recovered multiline utterance', () => {
    const { recovery } = createRecoveryHarness();
    const editor = createEditorHarness('prefix ', { ch: 7, line: 3 });
    recovery.recordFinalizedUtterance('first line\nsecond line');

    recovery.reinsert(editor.editor);

    expect(editor.replaceRange).toHaveBeenCalledWith('first line\nsecond line', {
      ch: 7,
      line: 3,
    });
    expect(editor.setCursor).toHaveBeenCalledWith({ ch: 11, line: 4 });
  });

  it('reports editor failures without clearing the recovery buffer', () => {
    const error = new Error('editor unavailable');
    const { feedback, recovery } = createRecoveryHarness();
    const editor = createEditorHarness('');
    editor.replaceRange.mockImplementation(() => {
      throw error;
    });
    recovery.recordFinalizedUtterance('recover me');

    expect(recovery.reinsert(editor.editor)).toBe(false);
    expect(recovery.hasUtterance()).toBe(true);
    expect(feedback.show).toHaveBeenCalledWith({
      cause: error,
      intent: 'error',
      key: 'last-utterance-reinsert-failed',
      message: 'Could not reinsert the last finalized utterance.',
    });
  });
});

function createRecoveryHarness(
  options: { writeText?: ReturnType<typeof vi.fn<(text: string) => Promise<void>>> } = {},
): {
  feedback: { show: ReturnType<typeof vi.fn> };
  recovery: LastUtteranceRecovery;
  writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
} {
  const feedback = { show: vi.fn() };
  const writeText = options.writeText ?? vi.fn(async (_text: string) => {});
  return {
    feedback,
    recovery: new LastUtteranceRecovery({
      feedback,
      getClipboard: () => ({ writeText }),
    }),
    writeText,
  };
}

function createEditorHarness(line: string, cursor: EditorPosition = { ch: 0, line: 0 }) {
  const getCursor = vi.fn(() => cursor);
  const getLine = vi.fn(() => line);
  const replaceRange = vi.fn();
  const setCursor = vi.fn();
  const editor = {
    getCursor,
    getLine,
    replaceRange,
    setCursor,
  } as unknown as UtteranceRecoveryEditor;

  return { editor, getCursor, getLine, replaceRange, setCursor };
}
