import type { App, Editor, EditorPosition, EventRef, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import {
  buildMarkdownInsertionPlan,
  captureMarkdownCommand,
  MarkdownCommandSession,
  type MarkdownCommandSnapshot,
  parseMarkdownVoiceCommand,
} from '../src/editor/markdown-command-mode';
import { transcript } from './fixtures/transcript';

const STRUCTURAL_CASES = [
  { cursor: { ch: 0, line: 1 }, kind: 'new_line', phrase: 'new line', text: '\n' },
  { cursor: { ch: 0, line: 2 }, kind: 'new_paragraph', phrase: 'new paragraph', text: '\n\n' },
  { cursor: { ch: 2, line: 0 }, kind: 'bullet', phrase: 'bullet', text: '- ' },
  { cursor: { ch: 3, line: 0 }, kind: 'numbered_item', phrase: 'numbered item', text: '1. ' },
  { cursor: { ch: 6, line: 0 }, kind: 'checkbox', phrase: 'checkbox', text: '- [ ] ' },
  { cursor: { ch: 2, line: 0 }, kind: 'heading_one', phrase: 'heading one', text: '# ' },
  { cursor: { ch: 3, line: 0 }, kind: 'heading_two', phrase: 'heading two', text: '## ' },
  { cursor: { ch: 4, line: 0 }, kind: 'heading_three', phrase: 'heading three', text: '### ' },
  { cursor: { ch: 2, line: 1 }, kind: 'callout', phrase: 'callout', text: '> [!NOTE]\n> ' },
  { cursor: { ch: 0, line: 1 }, kind: 'code_block', phrase: 'code block', text: '```\n\n```' },
  {
    cursor: { ch: 0, line: 1 },
    kind: 'horizontal_rule',
    phrase: 'horizontal rule',
    text: '---\n',
  },
] as const;

describe('Markdown voice command parser and insertion planner', () => {
  it.each(STRUCTURAL_CASES)('parses and plans "$phrase"', ({ cursor, kind, phrase, text }) => {
    const command = parseMarkdownVoiceCommand(phrase);

    expect(command).toEqual({ kind });
    if (command.kind === 'unrecognized') {
      throw new Error(`expected ${phrase} to parse`);
    }
    expect(buildMarkdownInsertionPlan('', { ch: 0, line: 0 }, command)).toEqual({
      cursor,
      text,
    });
  });

  it('normalizes case, whitespace, and terminal punctuation for command phrases', () => {
    expect(parseMarkdownVoiceCommand('  HeAdInG   TwO!!!  ')).toEqual({ kind: 'heading_two' });
    expect(parseMarkdownVoiceCommand('NEW\nPARAGRAPH.')).toEqual({ kind: 'new_paragraph' });
  });

  it('preserves literal content while rejecting a missing or unknown command', () => {
    expect(parseMarkdownVoiceCommand('Literal Keep  CASE, punctuation!')).toEqual({
      kind: 'literal',
      text: 'Keep  CASE, punctuation!',
    });
    expect(parseMarkdownVoiceCommand('literal')).toEqual({
      kind: 'unrecognized',
      reason: 'literal_missing_text',
    });
    expect(parseMarkdownVoiceCommand('make this fancy')).toEqual({
      kind: 'unrecognized',
      reason: 'unknown',
    });
    expect(parseMarkdownVoiceCommand('  ')).toEqual({
      kind: 'unrecognized',
      reason: 'empty',
    });
  });

  it('isolates line-based Markdown without overwriting surrounding text', () => {
    expect(buildMarkdownInsertionPlan('alphabeta', { ch: 5, line: 0 }, { kind: 'bullet' })).toEqual(
      {
        cursor: { ch: 2, line: 1 },
        text: '\n- \n',
      },
    );
    expect(
      buildMarkdownInsertionPlan('alpha\nbeta', { ch: 5, line: 0 }, { kind: 'horizontal_rule' }),
    ).toEqual({
      cursor: { ch: 0, line: 2 },
      text: '\n---',
    });
  });

  it('rejects an invalid captured cursor', () => {
    expect(
      buildMarkdownInsertionPlan('one line', { ch: 0, line: 2 }, { kind: 'new_line' }),
    ).toBeNull();
  });
});

describe('Markdown command capture and session', () => {
  it('captures the exact editor, file, document, and cursor without mutation', () => {
    const editor = createEditor('alpha', { ch: 3, line: 0 });
    const file = { path: 'note.md' } as TFile;

    expect(captureMarkdownCommand(editor.editor, file)).toEqual({
      kind: 'captured',
      snapshot: {
        cursor: { ch: 3, line: 0 },
        documentText: 'alpha',
        editor: editor.editor,
        file,
        filePath: 'note.md',
      },
    });
    expect(editor.transaction).not.toHaveBeenCalled();
    expect(captureMarkdownCommand(editor.editor, null)).toEqual({ kind: 'no_file' });
  });

  it('applies one final command in one undoable transaction with the caret at its content', () => {
    const harness = createSessionHarness({
      cursor: { ch: 5, line: 0 },
      documentText: 'alphabeta',
    });

    expect(
      harness.session.acceptTranscript(
        transcript({ isFinal: false, text: 'bull', utteranceId: 'command-1' }),
      ),
    ).toEqual({ kind: 'accepted' });
    expect(harness.editor.transaction).not.toHaveBeenCalled();

    expect(
      harness.session.acceptTranscript(transcript({ text: 'bullet', utteranceId: 'command-1' })),
    ).toEqual({ kind: 'accepted' });

    expect(harness.editor.transaction).toHaveBeenCalledWith(
      {
        changes: [
          {
            from: { ch: 5, line: 0 },
            text: '\n- \n',
            to: { ch: 5, line: 0 },
          },
        ],
        selection: { from: { ch: 2, line: 1 } },
      },
      'local-dictation-markdown-command',
    );

    expect(
      harness.session.acceptTranscript(
        transcript({ revision: 1, text: 'horizontal rule', utteranceId: 'command-2' }),
      ),
    ).toEqual({ kind: 'duplicate' });
    expect(harness.editor.transaction).toHaveBeenCalledOnce();
  });

  it('inserts literal content without command interpretation', () => {
    const harness = createSessionHarness({ cursor: { ch: 5, line: 0 }, documentText: 'alpha' });

    harness.session.acceptTranscript(
      transcript({ text: 'literal # Keep This!', utteranceId: 'command-1' }),
    );

    expect(harness.editor.transaction).toHaveBeenCalledWith(
      {
        changes: [
          {
            from: { ch: 5, line: 0 },
            text: '# Keep This!',
            to: { ch: 5, line: 0 },
          },
        ],
        selection: { from: { ch: 17, line: 0 } },
      },
      'local-dictation-markdown-command',
    );
  });

  it('does not forward a content-bearing editor error to feedback', () => {
    const harness = createSessionHarness();
    harness.editor.transaction.mockImplementationOnce(() => {
      throw new Error('transaction rejected: literal private transcript');
    });

    harness.session.acceptTranscript(
      transcript({ text: 'literal private transcript', utteranceId: 'command-1' }),
    );

    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'error',
      key: 'markdown-command-failed',
      message: 'Could not apply the Markdown command. Run the command and try again.',
    });
  });

  it('does not mutate for an unknown command and gives actionable feedback', () => {
    const harness = createSessionHarness();

    harness.session.acceptTranscript(
      transcript({ text: 'make this fancy', utteranceId: 'command-1' }),
    );

    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'markdown-command-unrecognized',
      message:
        'Unknown Markdown command. Try “new paragraph”, “bullet”, “heading two”, or “literal” followed by text.',
    });
  });

  it('explains how to use a literal command that has no content', () => {
    const harness = createSessionHarness();

    harness.session.acceptTranscript(transcript({ text: 'literal', utteranceId: 'command-1' }));

    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'markdown-command-unrecognized',
      message: 'Say “literal” followed by the exact text to insert.',
    });
  });

  it('fails closed when the document changes after capture', () => {
    const harness = createSessionHarness();
    harness.setDocumentText('changed document');

    harness.session.acceptTranscript(transcript({ text: 'bullet', utteranceId: 'command-1' }));

    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'markdown-command-stale' }),
    );
  });

  it('fails closed when the captured editor or file is no longer open', () => {
    const harness = createSessionHarness();
    harness.setTargetOpen(false);

    harness.session.acceptTranscript(transcript({ text: 'bullet', utteranceId: 'command-1' }));

    expect(harness.editor.getValue).not.toHaveBeenCalled();
    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'markdown-command-stale' }),
    );
  });

  it('fails closed when the captured file is renamed', () => {
    const harness = createSessionHarness();
    harness.renameFile('renamed.md');

    harness.session.acceptTranscript(transcript({ text: 'bullet', utteranceId: 'command-1' }));

    expect(harness.editor.getValue).not.toHaveBeenCalled();
    expect(harness.editor.transaction).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'markdown-command-stale' }),
    );
  });
});

function createSessionHarness({
  cursor = { ch: 0, line: 0 },
  documentText = '',
}: {
  cursor?: EditorPosition;
  documentText?: string;
} = {}) {
  let currentDocumentText = documentText;
  const editor = createEditor(documentText, cursor, () => currentDocumentText);
  const file = { path: 'note.md' } as TFile;
  let targetOpen = true;
  const workspace = {
    getLeavesOfType: vi.fn(() =>
      targetOpen ? [{ view: { editor: editor.editor as unknown as Editor, file } }] : [],
    ),
    offref: vi.fn(),
    on: vi.fn((_event: string, _callback: () => void) => ({}) as EventRef),
  };
  const vault = {
    offref: vi.fn(),
    on: vi.fn((_event: string, _callback: (target: TFile) => void) => ({}) as EventRef),
  };
  const feedback = { show: vi.fn() };
  const snapshot: MarkdownCommandSnapshot = {
    cursor,
    documentText,
    editor: editor.editor,
    file,
    filePath: 'note.md',
  };
  const session = new MarkdownCommandSession({
    app: { vault, workspace } as unknown as Pick<App, 'vault' | 'workspace'>,
    callbacks: {
      onLockedNoteClosed: vi.fn(),
      onLockedNoteDeleted: vi.fn(),
      onSurfaceDesynchronized: vi.fn(),
    },
    feedback,
    snapshot,
  });

  return {
    editor,
    feedback,
    renameFile: (path: string) => {
      Object.assign(file, { path });
    },
    session,
    setDocumentText: (text: string) => {
      currentDocumentText = text;
    },
    setTargetOpen: (open: boolean) => {
      targetOpen = open;
    },
  };
}

function createEditor(
  documentText: string,
  cursor: EditorPosition,
  readDocument: () => string = () => documentText,
) {
  const getCursor = vi.fn(() => cursor);
  const getValue = vi.fn(readDocument);
  const transaction = vi.fn();
  const editor = {
    getCursor,
    getValue,
    transaction,
  } as unknown as MarkdownCommandSnapshot['editor'];
  return { editor, getCursor, getValue, transaction };
}
