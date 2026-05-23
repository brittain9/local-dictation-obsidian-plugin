import {
  EditorSelection,
  EditorState,
  type Extension,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  dictationAnchorExtension,
  dictationAnchorStateField,
} from '../src/editor/dictation-anchor-extension';
import { NoteSurface } from '../src/editor/note-surface';
import type { DictationAnchor } from '../src/settings/plugin-settings';
import { TranscriptRenderer, type TranscriptRenderOptions } from '../src/transcript/renderer';
import { renderOptions, timestamps } from './helpers/render-options';

class FakeEditorView {
  public lastUpdate: ViewUpdate | null = null;
  public state: EditorState;

  constructor(doc: string, selectionHead: number, extensions: Extension = []) {
    this.state = EditorState.create({
      doc,
      extensions,
      selection: EditorSelection.cursor(selectionHead),
    });
  }

  dispatch(spec: TransactionSpec): void {
    const transaction = this.state.update(spec);
    this.state = transaction.state;
    this.lastUpdate = {
      changes: transaction.changes,
      docChanged: transaction.docChanged,
      transactions: [transaction],
      view: this,
    } as unknown as ViewUpdate;
  }

  apply(spec: TransactionSpec): ViewUpdate {
    const transaction = this.state.update(spec);
    this.state = transaction.state;

    this.lastUpdate = {
      changes: transaction.changes,
      docChanged: transaction.docChanged,
      transactions: [transaction],
      view: this,
    } as unknown as ViewUpdate;
    return this.lastUpdate;
  }
}

function createSurface({
  anchor = 'at_cursor',
  doc = '',
  extensions = [],
  selectionHead = 0,
}: {
  anchor?: DictationAnchor;
  doc?: string;
  extensions?: Extension;
  selectionHead?: number;
} = {}): { surface: NoteSurface; view: FakeEditorView } {
  const view = new FakeEditorView(doc, selectionHead, extensions);
  const surface = new NoteSurface(view as unknown as EditorView, { anchor });

  return { surface, view };
}

function append(
  surface: NoteSurface,
  utteranceId: string,
  text: string,
  options: TranscriptRenderOptions = renderOptions(),
  input: { pauseMsBeforeUtterance?: number | null; utteranceStartMsInSession?: number } = {},
): ReturnType<NoteSurface['appendProjection']> {
  return appendWithRenderer(surface, new TranscriptRenderer(options), utteranceId, text, input);
}

function appendWithRenderer(
  surface: NoteSurface,
  renderer: TranscriptRenderer,
  utteranceId: string,
  text: string,
  input: { pauseMsBeforeUtterance?: number | null; utteranceStartMsInSession?: number } = {},
): ReturnType<NoteSurface['appendProjection']> {
  const projection = renderer.planAppend(
    {
      pauseMsBeforeUtterance: input.pauseMsBeforeUtterance ?? null,
      text,
      utteranceId,
      utteranceStartMsInSession: input.utteranceStartMsInSession ?? 0,
    },
    surface.readProjectionContext(),
  );
  const result = surface.appendProjection(utteranceId, projection);

  if (result.kind === 'appended') {
    renderer.commitAppend(projection);
  }

  return result;
}

function doc(view: FakeEditorView): string {
  return view.state.doc.toString();
}

describe('NoteSurface', () => {
  it('keeps same-cursor sessions ordered when the later session writes first', () => {
    const view = new FakeEditorView('', 0);
    const earlier = new NoteSurface(view as unknown as EditorView, { anchor: 'at_cursor' });
    const later = new NoteSurface(view as unknown as EditorView, { anchor: 'at_cursor' });

    expect(append(later, 'later', 'B').kind).toBe('appended');
    if (view.lastUpdate === null) {
      throw new Error('later append should produce an update');
    }
    earlier.observeTransaction(view.lastUpdate);

    expect(append(earlier, 'earlier', 'A').kind).toBe('appended');
    if (view.lastUpdate === null) {
      throw new Error('earlier append should produce an update');
    }
    later.observeTransaction(view.lastUpdate);

    expect(doc(view)).toBe('AB');
  });

  it('extends the writing-region tail past user text typed at the initial anchor before any utterance', () => {
    const { surface, view } = createSurface();

    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('input.type'),
        changes: { from: 0, insert: 'hello' },
      }),
    );

    expect(append(surface, 'u1', 'first').kind).toBe('appended');

    expect(doc(view)).toBe('hello first');
  });

  it('appends dictated text at the writing-region tail after user text typed at the old anchor', () => {
    const { surface, view } = createSurface({ doc: 'start ', selectionHead: 6 });

    expect(append(surface, 'u1', 'first').kind).toBe('appended');
    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('input.type'),
        changes: { from: 11, insert: ' USER' },
      }),
    );
    expect(append(surface, 'u2', 'second').kind).toBe('appended');

    expect(doc(view)).toBe('start first USER second');
  });

  it('inserts paragraph boundaries as prefixes without dangling trailing separators', () => {
    const { surface, view } = createSurface();
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'new_paragraph',
    });

    expect(appendWithRenderer(surface, renderer, 'u1', 'first').kind).toBe('appended');
    expect(appendWithRenderer(surface, renderer, 'u2', 'second').kind).toBe('appended');

    expect(doc(view)).toBe('first\n\nsecond');
  });

  it('stores timestamp and boundary prefixes inside the span while replacing only utterance text', () => {
    const { surface, view } = createSurface();
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'new_paragraph',
    });

    expect(appendWithRenderer(surface, renderer, 'u1', 'first').kind).toBe('appended');
    expect(
      appendWithRenderer(surface, renderer, 'u2', 'second', {
        pauseMsBeforeUtterance: 3000,
        utteranceStartMsInSession: 70_000,
      }).kind,
    ).toBe('appended');
    expect(surface.replaceAnchor('u2', 'SECOND', 'second').kind).toBe('replaced');

    expect(doc(view)).toBe('(0:00) first\n\n(1:10) SECOND');
  });

  it('renders the session header with inline landmarks', () => {
    const { surface, view } = createSurface();
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: true }),
      transcriptFormatting: 'space',
    });

    expect(appendWithRenderer(surface, renderer, 'u1', 'first').kind).toBe('appended');
    expect(
      appendWithRenderer(surface, renderer, 'u2', 'second', {
        utteranceStartMsInSession: 30_000,
      }).kind,
    ).toBe('appended');

    expect(doc(view)).toBe('[2026-05-16 14:32]\n(0:00) first (0:30) second');
  });

  it('latches replacements when a user edits the timestamp prefix', () => {
    const { surface, view } = createSurface();

    expect(
      append(surface, 'u1', 'first', {
        timestamps: timestamps({ enabled: true, header: false }),
        transcriptFormatting: 'space',
      }).kind,
    ).toBe('appended');
    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('input.type'),
        changes: { from: 1, to: 2, insert: '9' },
      }),
    );

    expect(surface.replaceAnchor('u1', 'FIRST', 'first').kind).toBe('denied');
  });

  it('keeps the visible anchor marker on the locked note surface', () => {
    const { surface, view } = createSurface({ extensions: dictationAnchorExtension() });

    expect(view.state.field(dictationAnchorStateField)).toEqual({ mode: 'hidden', pos: 0 });

    surface.setAnchorMode('visible');
    expect(view.state.field(dictationAnchorStateField)).toEqual({ mode: 'visible', pos: 0 });

    append(surface, 'u1', 'first');
    expect(view.state.field(dictationAnchorStateField)).toEqual({ mode: 'visible', pos: 5 });

    surface.dispose();
    expect(view.state.field(dictationAnchorStateField)).toEqual({ mode: 'hidden', pos: null });
  });

  it('applies and trims the eager end-of-note first phrase prefix', () => {
    const { surface, view } = createSurface({
      anchor: 'end_of_note',
      doc: 'alpha',
      selectionHead: 0,
    });

    expect(doc(view)).toBe('alpha\n');

    surface.trimPendingInitialPrefix();

    expect(doc(view)).toBe('alpha');
  });

  it('maps spans when text is inserted before them', () => {
    const { surface, view } = createSurface({ doc: 'tail', selectionHead: 4 });

    expect(append(surface, 'u1', 'voice ').kind).toBe('appended');
    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('input.type'),
        changes: { from: 0, insert: 'HEAD ' },
      }),
    );

    expect(surface.replaceAnchor('u1', 'dictated ', 'voice ').kind).toBe('replaced');
    expect(doc(view)).toBe('HEAD tail dictated ');
  });

  it('latches only spans intersected by a user edit', () => {
    const { surface, view } = createSurface();

    expect(append(surface, 'u1', 'first').kind).toBe('appended');
    expect(append(surface, 'u2', 'second').kind).toBe('appended');
    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('input.type'),
        changes: { from: 1, to: 2, insert: 'X' },
      }),
    );

    expect(surface.replaceAnchor('u1', 'FIRST', 'first').kind).toBe('denied');
    expect(surface.replaceAnchor('u2', 'SECOND', 'second').kind).toBe('replaced');
    expect(doc(view)).toBe('fXrst SECOND');
  });

  it('does not latch on undo or redo user events', () => {
    const { surface, view } = createSurface({ doc: 'tail', selectionHead: 4 });

    expect(append(surface, 'u1', 'first').kind).toBe('appended');
    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('undo.selection'),
        changes: { from: 0, insert: '!' },
      }),
    );

    expect(surface.replaceAnchor('u1', 'FIRST', 'first').kind).toBe('replaced');
  });

  it('treats IME composition commits as latchable user edits', () => {
    const { surface, view } = createSurface();

    expect(append(surface, 'u1', 'first').kind).toBe('appended');
    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('input.type.compose'),
        changes: { from: 2, insert: 'X' },
      }),
    );

    expect(surface.replaceAnchor('u1', 'FIRST', 'first').kind).toBe('denied');
  });

  it('denies replace when the recorded bytes no longer match the note', () => {
    const { surface, view } = createSurface();

    expect(append(surface, 'u1', 'first').kind).toBe('appended');
    surface.observeTransaction(view.apply({ changes: { from: 0, to: 1, insert: 'F' } }));

    const result = surface.replaceAnchor('u1', 'FIRST', 'first');

    expect(result).toMatchObject({
      kind: 'denied',
      reason: { currentText: 'First', kind: 'span_mismatch' },
    });
  });

  it('selectively latches externally modified spans by byte identity', () => {
    const { surface, view } = createSurface();

    expect(append(surface, 'u1', 'first').kind).toBe('appended');
    expect(append(surface, 'u2', 'second').kind).toBe('appended');
    surface.observeTransaction(view.apply({ changes: { from: 0, to: 1, insert: 'F' } }));
    surface.validateExternalModification();

    expect(surface.replaceAnchor('u1', 'FIRST', 'first').kind).toBe('denied');
    expect(surface.replaceAnchor('u2', 'SECOND', 'second').kind).toBe('replaced');
  });

  it.each([
    {
      allowedSpans: [],
      editFirstChar: false,
      expectedDoc: 'FIRST second',
      expectedRangeEnd: 5,
      label: 'single intact span',
      newText: 'FIRST',
      rangeEnd: 5,
      verifiesOldAnchorsDropped: true,
    },
    {
      allowedSpans: [],
      editFirstChar: false,
      expectedDoc: 'Cleaned.',
      expectedRangeEnd: 'first second'.length,
      label: 'multi-utterance region',
      newText: 'Cleaned.',
      rangeEnd: null,
      verifiesOldAnchorsDropped: false,
    },
    {
      allowedSpans: [{ utteranceId: 'u1' }, { utteranceId: 'u2' }],
      editFirstChar: true,
      expectedDoc: 'Cleaned.',
      expectedRangeEnd: 'First second'.length,
      label: 'externally changed allowed spans',
      newText: 'Cleaned.',
      rangeEnd: null,
      verifiesOldAnchorsDropped: false,
    },
  ] as const)('rewrites allowed region: $label', (input) => {
    const { surface, view } = createSurface();

    expect(append(surface, 'u1', 'first').kind).toBe('appended');
    expect(append(surface, 'u2', 'second').kind).toBe('appended');
    if (input.editFirstChar) {
      surface.observeTransaction(view.apply({ changes: { from: 0, to: 1, insert: 'F' } }));
    }

    expect(
      surface.rewriteRegion({ from: 0, to: input.rangeEnd ?? doc(view).length }, input.newText, [
        ...input.allowedSpans,
      ]),
    ).toEqual({
      kind: 'rewritten',
      range: { from: 0, to: input.expectedRangeEnd },
    });
    expect(doc(view)).toBe(input.expectedDoc);
    if (input.verifiesOldAnchorsDropped) {
      expect(surface.replaceAnchor('u1', 'next', 'first').kind).toBe('denied');
      expect(surface.replaceAnchor('u2', 'SECOND', 'second').kind).toBe('replaced');
    }
  });

  it('denies rewrites that cut through an utterance span', () => {
    const { surface } = createSurface();

    expect(append(surface, 'u1', 'first').kind).toBe('appended');

    expect(surface.rewriteRegion({ from: 1, to: 4 }, 'ir', [])).toEqual({
      kind: 'denied',
      reason: { kind: 'range_partial' },
    });
  });

  describe('readNoteGlossary', () => {
    it('returns null for non-positive budget', () => {
      const { surface } = createSurface({ doc: 'NVIDIA CUDA', selectionHead: 11 });

      expect(surface.readNoteGlossary(0)).toBeNull();
      expect(surface.readNoteGlossary(-5)).toBeNull();
    });

    it('returns null when the note has no glossary-worthy terms', () => {
      const { surface } = createSurface({
        doc: 'this is just plain prose with no special words',
        selectionHead: 0,
      });

      expect(surface.readNoteGlossary(384)).toBeNull();
    });

    it.each([
      ['acronyms', 'We use NVIDIA GPU acceleration with STT.', 'Glossary: NVIDIA, GPU, STT'],
      [
        'mixed-case identifiers',
        'See writingRegionTail and TranscriptionRequest for details.',
        'Glossary: writingRegionTail, TranscriptionRequest',
      ],
      [
        'hyphenated, underscored, and dotted identifiers',
        'Files: note-surface, set_initial_prompt, whisper.cpp, Object.keys.',
        'Glossary: note-surface, set_initial_prompt, whisper.cpp, Object.keys',
      ],
    ] as const)('extracts %s', (_label, text, expected) => {
      const { surface } = createSurface({
        doc: text,
        selectionHead: 0,
      });

      expect(surface.readNoteGlossary(384)).toEqual({
        text: expected,
        truncated: false,
      });
    });

    it('rejects Title.Title tokens fused at a sentence boundary', () => {
      const { surface } = createSurface({
        doc: 'We discussed Operations.One of the problems was Sidecar.',
        selectionHead: 0,
      });

      expect(surface.readNoteGlossary(384)).toEqual({
        text: 'Glossary: Sidecar',
        truncated: false,
      });
    });

    it('extracts capitalized proper nouns and skips common sentence-start words', () => {
      const { surface } = createSurface({
        doc: 'The team chose Claude. And Alex agreed.',
        selectionHead: 0,
      });

      expect(surface.readNoteGlossary(384)).toEqual({
        text: 'Glossary: Claude, Alex',
        truncated: false,
      });
    });

    it('dedupes case-insensitively, keeping the first-seen casing', () => {
      const { surface } = createSurface({
        doc: 'NVIDIA hardware and nvidia drivers from NVIDIA again.',
        selectionHead: 0,
      });

      expect(surface.readNoteGlossary(384)).toEqual({
        text: 'Glossary: NVIDIA',
        truncated: false,
      });
    });

    it('caps output at maxChars and flags truncated when terms are dropped', () => {
      const { surface } = createSurface({
        doc: 'NVIDIA CUDA Whisper Sidecar Obsidian Plugin GPU STT',
        selectionHead: 0,
      });

      const result = surface.readNoteGlossary(30);

      expect(result?.truncated).toBe(true);
      expect(result?.text.length).toBeLessThanOrEqual(30);
      expect(result?.text.startsWith('Glossary: ')).toBe(true);
    });

    it('scans the whole note, including text after the writing tail', () => {
      const { surface, view } = createSurface({ doc: 'NVIDIA ', selectionHead: 7 });

      view.dispatch({ changes: { from: 7, insert: 'after CUDA' } });

      expect(surface.readNoteGlossary(384)).toEqual({
        text: 'Glossary: NVIDIA, CUDA',
        truncated: false,
      });
    });
  });
});
