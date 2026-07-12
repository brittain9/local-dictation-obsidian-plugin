import type { App, Editor, EditorPosition, TFile } from 'obsidian';

import type { SessionLifecycleCallbacks } from '../session/session';
import type { UserFeedback } from '../shared/user-feedback';
import {
  isSingleFinalEditorSnapshotCurrent,
  SingleFinalEditorSession,
  type SingleFinalEditorSnapshot,
} from './single-final-editor-session';

type MarkdownCommandEditor = Pick<Editor, 'getCursor' | 'getValue' | 'transaction'>;

type MarkdownStructuralCommand =
  | 'bullet'
  | 'callout'
  | 'checkbox'
  | 'code_block'
  | 'heading_one'
  | 'heading_three'
  | 'heading_two'
  | 'horizontal_rule'
  | 'new_line'
  | 'new_paragraph'
  | 'numbered_item';

export type MarkdownVoiceCommand =
  | { kind: MarkdownStructuralCommand }
  | { kind: 'literal'; text: string }
  | { kind: 'unrecognized'; reason: 'empty' | 'literal_missing_text' | 'unknown' };

type RecognizedMarkdownVoiceCommand = Exclude<MarkdownVoiceCommand, { kind: 'unrecognized' }>;

export interface MarkdownCommandSnapshot extends SingleFinalEditorSnapshot {
  readonly cursor: EditorPosition;
  readonly editor: MarkdownCommandEditor;
}

export interface MarkdownInsertionPlan {
  readonly cursor: EditorPosition;
  readonly text: string;
}

export type MarkdownCommandCaptureResult =
  | { kind: 'captured'; snapshot: MarkdownCommandSnapshot }
  | { kind: 'no_file' };

interface MarkdownCommandSessionDependencies {
  app: Pick<App, 'vault' | 'workspace'>;
  callbacks: SessionLifecycleCallbacks;
  feedback: Pick<UserFeedback, 'show'>;
  snapshot: MarkdownCommandSnapshot;
}

const STRUCTURAL_COMMANDS = new Map<string, MarkdownStructuralCommand>([
  ['bullet', 'bullet'],
  ['callout', 'callout'],
  ['checkbox', 'checkbox'],
  ['code block', 'code_block'],
  ['heading one', 'heading_one'],
  ['heading three', 'heading_three'],
  ['heading two', 'heading_two'],
  ['horizontal rule', 'horizontal_rule'],
  ['new line', 'new_line'],
  ['new paragraph', 'new_paragraph'],
  ['numbered item', 'numbered_item'],
]);

export function canCaptureMarkdownCommand(
  _editor: MarkdownCommandEditor,
  file: TFile | null,
): boolean {
  return file !== null;
}

export function captureMarkdownCommand(
  editor: MarkdownCommandEditor,
  file: TFile | null,
): MarkdownCommandCaptureResult {
  if (file === null) {
    return { kind: 'no_file' };
  }

  return {
    kind: 'captured',
    snapshot: {
      cursor: { ...editor.getCursor() },
      documentText: editor.getValue(),
      editor,
      file,
      filePath: file.path,
    },
  };
}

export function isMarkdownCommandSnapshotCurrent(
  app: Pick<App, 'workspace'>,
  snapshot: MarkdownCommandSnapshot,
): boolean {
  return isSingleFinalEditorSnapshotCurrent(app, snapshot);
}

export function parseMarkdownVoiceCommand(text: string): MarkdownVoiceCommand {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { kind: 'unrecognized', reason: 'empty' };
  }

  const literalMatch = /^literal(?:\s+([\s\S]+))?$/iu.exec(trimmed);
  if (literalMatch !== null) {
    const literalText = literalMatch[1]?.trim() ?? '';
    return literalText.length > 0
      ? { kind: 'literal', text: literalText }
      : { kind: 'unrecognized', reason: 'literal_missing_text' };
  }

  const normalized = trimmed
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .replace(/[!,.?:;]+$/gu, '')
    .trim();
  const command = STRUCTURAL_COMMANDS.get(normalized);
  return command === undefined ? { kind: 'unrecognized', reason: 'unknown' } : { kind: command };
}

export function buildMarkdownInsertionPlan(
  documentText: string,
  cursor: EditorPosition,
  command: RecognizedMarkdownVoiceCommand,
): MarkdownInsertionPlan | null {
  const insertionOffset = positionToOffset(documentText, cursor);
  if (insertionOffset === null) {
    return null;
  }

  switch (command.kind) {
    case 'literal':
      return buildDirectInsertionPlan(documentText, insertionOffset, command.text);
    case 'new_line':
      return buildDirectInsertionPlan(documentText, insertionOffset, '\n');
    case 'new_paragraph':
      return buildDirectInsertionPlan(documentText, insertionOffset, '\n\n');
    case 'bullet':
      return buildLineBlockPlan(documentText, insertionOffset, '- ', 2);
    case 'numbered_item':
      return buildLineBlockPlan(documentText, insertionOffset, '1. ', 3);
    case 'checkbox':
      return buildLineBlockPlan(documentText, insertionOffset, '- [ ] ', 6);
    case 'heading_one':
      return buildLineBlockPlan(documentText, insertionOffset, '# ', 2);
    case 'heading_two':
      return buildLineBlockPlan(documentText, insertionOffset, '## ', 3);
    case 'heading_three':
      return buildLineBlockPlan(documentText, insertionOffset, '### ', 4);
    case 'callout': {
      const block = '> [!NOTE]\n> ';
      return buildLineBlockPlan(documentText, insertionOffset, block, block.length);
    }
    case 'code_block':
      return buildLineBlockPlan(documentText, insertionOffset, '```\n\n```', 4);
    case 'horizontal_rule':
      return buildLineBlockPlan(documentText, insertionOffset, '---', 3, true);
  }
}

export class MarkdownCommandSession extends SingleFinalEditorSession {
  constructor(private readonly dependencies: MarkdownCommandSessionDependencies) {
    super({
      app: dependencies.app,
      callbacks: dependencies.callbacks,
      disposedReason: 'Markdown voice command session is disposed.',
      snapshot: dependencies.snapshot,
    });
  }

  protected handleFinalText(text: string): void {
    const command = parseMarkdownVoiceCommand(text);
    if (command.kind === 'unrecognized') {
      this.reportUnrecognizedCommand(command.reason);
      return;
    }

    const { cursor, documentText, editor } = this.dependencies.snapshot;
    const plan = buildMarkdownInsertionPlan(documentText, cursor, command);
    if (plan === null) {
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'markdown-command-invalid-cursor',
        message: 'The captured cursor is no longer valid. No Markdown was inserted.',
      });
      return;
    }

    try {
      editor.transaction(
        {
          changes: [{ from: cursor, text: plan.text, to: cursor }],
          selection: { from: plan.cursor },
        },
        'local-dictation-markdown-command',
      );
      this.dependencies.feedback.show({
        intent: 'success',
        key: 'markdown-command-complete',
        message: 'Applied the Markdown voice command.',
      });
    } catch {
      // Do not forward the editor error as feedback cause: an implementation
      // may echo the transaction payload, which contains the spoken text.
      this.dependencies.feedback.show({
        intent: 'error',
        key: 'markdown-command-failed',
        message: 'Could not apply the Markdown command. Run the command and try again.',
      });
    }
  }

  protected reportCancellation(): void {
    this.dependencies.feedback.show({
      intent: 'information',
      key: 'markdown-command-cancelled',
      message: 'Markdown voice command cancelled. The note was left unchanged.',
    });
  }

  protected reportStaleTarget(): void {
    this.dependencies.feedback.show({
      intent: 'warning',
      key: 'markdown-command-stale',
      message:
        'The note changed while listening. No Markdown command was applied. Run the command again.',
    });
  }

  private reportUnrecognizedCommand(
    reason: Extract<MarkdownVoiceCommand, { kind: 'unrecognized' }>['reason'],
  ): void {
    const message =
      reason === 'literal_missing_text'
        ? 'Say “literal” followed by the exact text to insert.'
        : reason === 'empty'
          ? 'No Markdown command was recognized. Try “new paragraph”, “bullet”, or “literal” followed by text.'
          : 'Unknown Markdown command. Try “new paragraph”, “bullet”, “heading two”, or “literal” followed by text.';
    this.dependencies.feedback.show({
      intent: 'warning',
      key: 'markdown-command-unrecognized',
      message,
    });
  }
}

function buildDirectInsertionPlan(
  documentText: string,
  insertionOffset: number,
  text: string,
): MarkdownInsertionPlan {
  const nextDocument = insertAt(documentText, insertionOffset, text);
  return {
    cursor: offsetToPosition(nextDocument, insertionOffset + text.length),
    text,
  };
}

function buildLineBlockPlan(
  documentText: string,
  insertionOffset: number,
  block: string,
  caretOffsetInBlock: number,
  moveToNextLine = false,
): MarkdownInsertionPlan {
  const startsLine = insertionOffset === 0 || documentText[insertionOffset - 1] === '\n';
  const endsLine =
    insertionOffset === documentText.length || documentText[insertionOffset] === '\n';
  const prefix = startsLine ? '' : '\n';
  let suffix = endsLine ? '' : '\n';
  let text = `${prefix}${block}${suffix}`;
  let caretOffset = insertionOffset + prefix.length + caretOffsetInBlock;

  if (moveToNextLine) {
    if (insertionOffset === documentText.length) {
      suffix = '\n';
      text = `${prefix}${block}${suffix}`;
      caretOffset = insertionOffset + text.length;
    } else if (endsLine) {
      caretOffset = insertionOffset + text.length + 1;
    } else {
      caretOffset = insertionOffset + text.length;
    }
  }

  const nextDocument = insertAt(documentText, insertionOffset, text);
  return { cursor: offsetToPosition(nextDocument, caretOffset), text };
}

function insertAt(text: string, offset: number, insertion: string): string {
  return `${text.slice(0, offset)}${insertion}${text.slice(offset)}`;
}

function positionToOffset(documentText: string, position: EditorPosition): number | null {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.ch) || position.line < 0) {
    return null;
  }

  const lines = documentText.split('\n');
  const line = lines[position.line];
  if (line === undefined || position.ch < 0 || position.ch > line.length) {
    return null;
  }

  let offset = position.ch;
  for (let index = 0; index < position.line; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }
  return offset;
}

function offsetToPosition(documentText: string, offset: number): EditorPosition {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (documentText[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { ch: offset - lineStart, line };
}
