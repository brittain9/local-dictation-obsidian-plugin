import {
  EditorSelection,
  EditorState,
  type Extension,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import {
  dictationAnchorExtension,
  dictationAnchorStateField,
  setAnchorEffect,
  setAnchorModeEffect,
} from '../src/editor/dictation-anchor-extension';
import { NoteSurface } from '../src/editor/note-surface';
import {
  provisionalTranscriptDecorationsField,
  provisionalTranscriptExtension,
  provisionalTranscriptStateField,
  setProvisionalTranscriptEffect,
} from '../src/editor/provisional-transcript-extension';
import {
  sessionProcessingExtension,
  sessionProcessingStateField,
  setSessionProcessingEffect,
} from '../src/editor/session-processing-extension';
import type { DictationAnchor } from '../src/settings/plugin-settings';
import {
  type TranscriptInsertProjection,
  TranscriptRenderer,
  type TranscriptRenderOptions,
} from '../src/transcript/renderer';
import { renderOptions, timestamps } from './helpers/render-options';

class FakeEditorView {
  public lastUpdate: ViewUpdate | null = null;
  public state: EditorState;
  private readonly updateListeners: Array<(update: ViewUpdate) => void> = [];

  constructor(doc: string, selectionHead: number, extensions: Extension = []) {
    this.state = EditorState.create({
      doc,
      extensions,
      selection: EditorSelection.cursor(selectionHead),
    });
  }

  dispatch(spec: TransactionSpec): void {
    const startState = this.state;
    const transaction = startState.update(spec);
    this.state = transaction.state;
    this.lastUpdate = {
      changes: transaction.changes,
      docChanged: transaction.docChanged,
      startState,
      transactions: [transaction],
      view: this,
    } as unknown as ViewUpdate;
    for (const listener of this.updateListeners) {
      listener(this.lastUpdate);
    }
  }

  addUpdateListener(listener: (update: ViewUpdate) => void): void {
    this.updateListeners.push(listener);
  }

  apply(spec: TransactionSpec): ViewUpdate {
    const startState = this.state;
    const transaction = startState.update(spec);
    this.state = transaction.state;

    this.lastUpdate = {
      changes: transaction.changes,
      docChanged: transaction.docChanged,
      startState,
      transactions: [transaction],
      view: this,
    } as unknown as ViewUpdate;
    return this.lastUpdate;
  }

  replaceStateWithoutViewUpdate(doc: string): void {
    this.state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
    });
  }

  replaceEditorStateWithoutViewUpdate(state: EditorState): void {
    this.state = state;
  }
}

function createSurface({
  anchor = 'at_cursor',
  doc = '',
  extensions = [],
  selectionHead = 0,
  onSurfaceDesynchronized,
}: {
  anchor?: DictationAnchor;
  doc?: string;
  extensions?: Extension;
  selectionHead?: number;
  onSurfaceDesynchronized?: (failure: {
    documentLength: number;
    kind: 'surface_desynchronized';
    trackedPosition: number;
  }) => void;
} = {}): { surface: NoteSurface; view: FakeEditorView } {
  const view = new FakeEditorView(doc, selectionHead, extensions);
  const surface = new NoteSurface(
    view as unknown as EditorView,
    { anchor },
    onSurfaceDesynchronized,
  );

  return { surface, view };
}

function provisionalDecorationCount(state: EditorState): number {
  let count = 0;
  state.field(provisionalTranscriptDecorationsField).between(0, state.doc.length, () => {
    count += 1;
  });
  return count;
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

function literalProjection(text: string): TranscriptInsertProjection {
  return {
    emittedSpeakerIndex: null,
    emittedTimestamp: null,
    insertedText: text,
    precedingSpeakerIndex: null,
    projectedText: text,
    replacementPrefix: '',
    textEndOffset: text.length,
    textStartOffset: 0,
  };
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
      spans: [{ speakerIndex: null, text }],
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
  it('reports a fatal desynchronization without changing an externally replaced note', () => {
    const initialDocument = 'x'.repeat(4280);
    const externalReplacement = 'r'.repeat(4280);
    const { surface, view } = createSurface({
      doc: initialDocument,
      selectionHead: initialDocument.length,
    });
    const priorTranscript = 'y'.repeat(34);

    expect(surface.appendProjection('u1', literalProjection(priorTranscript)).kind).toBe(
      'appended',
    );
    expect(doc(view).length).toBe(4314);

    view.replaceStateWithoutViewUpdate(externalReplacement);

    const failure = surface.validateExternalModification();
    expect(failure).toEqual({
      documentLength: 4280,
      kind: 'surface_desynchronized',
      trackedPosition: 4314,
    });
    expect(surface.appendProjection('u2', literalProjection('next'))).toEqual({
      kind: 'denied',
      reason: failure,
      utteranceId: 'u2',
    });
    expect(doc(view)).toBe(externalReplacement);
  });

  it('keeps the writing tail valid when a mapped edit shrinks the note', () => {
    const initialDocument = 'x'.repeat(4280);
    const { surface, view } = createSurface({
      doc: initialDocument,
      selectionHead: initialDocument.length,
    });

    expect(surface.appendProjection('u1', literalProjection('y'.repeat(34))).kind).toBe('appended');
    surface.observeTransaction(view.apply({ changes: { from: 4280, to: 4314, insert: '' } }));

    expect(surface.appendProjection('u2', literalProjection('z')).kind).toBe('appended');
    expect(doc(view)).toBe(`${initialDocument}z`);
  });

  it('reports an unmapped replacement before mapping the next editor transaction', () => {
    const initialDocument = 'x'.repeat(4280);
    const externalReplacement = 'r'.repeat(4280);
    const onSurfaceDesynchronized = vi.fn();
    const { surface, view } = createSurface({
      doc: initialDocument,
      onSurfaceDesynchronized,
      selectionHead: initialDocument.length,
    });
    expect(surface.appendProjection('u1', literalProjection('y'.repeat(34))).kind).toBe('appended');
    view.replaceStateWithoutViewUpdate(externalReplacement);
    const update = view.apply({ changes: { from: 0, insert: '!' } });
    let failure: ReturnType<NoteSurface['validateExternalModification']> = null;

    expect(() => {
      failure = surface.observeTransaction(update);
    }).not.toThrow();
    expect(failure).toEqual({
      documentLength: 4280,
      kind: 'surface_desynchronized',
      trackedPosition: 4314,
    });
    expect(onSurfaceDesynchronized).toHaveBeenCalledOnce();
    expect(onSurfaceDesynchronized).toHaveBeenCalledWith(failure);
    expect(doc(view)).toBe(`!${externalReplacement}`);
  });

  it('keeps appending after a live partial is replaced by a shorter final', () => {
    const initialDocument = 'x'.repeat(4246);
    const { surface, view } = createSurface({
      doc: initialDocument,
      selectionHead: initialDocument.length,
    });
    const partial = 'p'.repeat(68);
    const final = 'f'.repeat(34);

    expect(surface.appendProjection('u1', literalProjection(partial)).kind).toBe('appended');
    expect(surface.replaceAnchor('u1', final, partial, false).kind).toBe('replaced');
    expect(surface.appendProjection('u2', literalProjection('z')).kind).toBe('appended');

    expect(doc(view)).toBe(`${initialDocument}${final}z`);
  });

  it.each([
    ['anchor mode', (surface: NoteSurface) => surface.setAnchorMode('visible')],
    ['processing range', (surface: NoteSurface) => surface.setProcessingRange({ from: 0, to: 1 })],
    ['provisional range', (surface: NoteSurface) => surface.setProvisional('u1', true)],
    ['pending prefix trim', (surface: NoteSurface) => surface.trimPendingInitialPrefix()],
    ['dispose', (surface: NoteSurface) => surface.dispose()],
  ] as const)('blocks %s mutation after an unmapped replacement', (_label, mutate) => {
    const initialDocument = 'x'.repeat(4280);
    const externalReplacement = 'r'.repeat(4280);
    const { surface, view } = createSurface({
      doc: initialDocument,
      selectionHead: initialDocument.length,
    });
    expect(surface.appendProjection('u1', literalProjection('y'.repeat(34))).kind).toBe('appended');
    view.replaceStateWithoutViewUpdate(externalReplacement);

    expect(mutate(surface)).toEqual({
      documentLength: 4280,
      kind: 'surface_desynchronized',
      trackedPosition: 4314,
    });
    expect(doc(view)).toBe(externalReplacement);
  });

  it('clears editor decorations when a desynchronized surface is disposed', () => {
    const extensions = [
      dictationAnchorExtension(),
      provisionalTranscriptExtension(),
      sessionProcessingExtension(),
    ];
    const initialDocument = 'x'.repeat(4280);
    const externalReplacement = 'r'.repeat(4280);
    const { surface, view } = createSurface({
      doc: initialDocument,
      extensions,
      selectionHead: initialDocument.length,
    });
    expect(surface.appendProjection('u1', literalProjection('y'.repeat(34))).kind).toBe('appended');
    let replacementState = EditorState.create({ doc: externalReplacement, extensions });
    replacementState = replacementState.update({
      effects: [
        setAnchorEffect.of(100),
        setAnchorModeEffect.of('visible'),
        setProvisionalTranscriptEffect.of({ from: 0, to: 1, utteranceId: 'u1' }),
        setSessionProcessingEffect.of({ from: 0, to: 1 }),
      ],
    }).state;
    view.replaceEditorStateWithoutViewUpdate(replacementState);
    const failure = surface.validateExternalModification();

    expect(surface.dispose()).toEqual(failure);
    expect(view.state.field(dictationAnchorStateField)).toEqual({ mode: 'hidden', pos: null });
    expect(view.state.field(provisionalTranscriptStateField).size).toBe(0);
    expect(view.state.field(sessionProcessingStateField)).toBeNull();
    expect(doc(view)).toBe(externalReplacement);
  });

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

  it('keeps same-cursor overlaps healthy when listeners observe an older append in creation order', () => {
    const view = new FakeEditorView('', 0);
    const earlierFailure = vi.fn();
    const laterFailure = vi.fn();
    const earlier = new NoteSurface(
      view as unknown as EditorView,
      { anchor: 'at_cursor' },
      earlierFailure,
    );
    const later = new NoteSurface(
      view as unknown as EditorView,
      { anchor: 'at_cursor' },
      laterFailure,
    );
    view.addUpdateListener((update) => earlier.observeTransaction(update));
    view.addUpdateListener((update) => later.observeTransaction(update));

    expect(append(earlier, 'earlier', 'A').kind).toBe('appended');
    expect(append(later, 'later', 'B').kind).toBe('appended');

    expect(doc(view)).toBe('A B');
    expect(earlierFailure).not.toHaveBeenCalled();
    expect(laterFailure).not.toHaveBeenCalled();
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

  it('removes an empty finalized utterance together with its boundary and timestamp prefix', () => {
    const { surface, view } = createSurface({ doc: 'Existing', selectionHead: 8 });
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    expect(
      appendWithRenderer(surface, renderer, 'u1', 'live words', {
        utteranceStartMsInSession: 10_000,
      }).kind,
    ).toBe('appended');
    expect(doc(view)).toBe('Existing (0:10) live words');

    expect(surface.replaceAnchor('u1', '', 'live words').kind).toBe('replaced');
    expect(doc(view)).toBe('Existing');
  });

  it('keeps the boundary and timestamp prefix when an empty partial clears the body', () => {
    const { surface, view } = createSurface({ doc: 'Existing', selectionHead: 8 });
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    expect(
      appendWithRenderer(surface, renderer, 'u1', 'live words', {
        utteranceStartMsInSession: 10_000,
      }).kind,
    ).toBe('appended');

    expect(surface.replaceAnchor('u1', '', 'live words', false).kind).toBe('replaced');
    expect(doc(view)).toBe('Existing (0:10) ');

    expect(surface.replaceAnchor('u1', 'live words again', '', false).kind).toBe('replaced');
    expect(doc(view)).toBe('Existing (0:10) live words again');
  });

  it('applies provisional styling and clears it on final replacement', () => {
    const { surface, view } = createSurface({ extensions: provisionalTranscriptExtension() });

    expect(append(surface, 'u1', 'live words').kind).toBe('appended');
    surface.setProvisional('u1', true);
    expect(provisionalDecorationCount(view.state)).toBe(1);

    expect(surface.replaceAnchor('u1', 'final words', 'live words').kind).toBe('replaced');
    surface.setProvisional('u1', false);
    expect(provisionalDecorationCount(view.state)).toBe(0);
  });

  it('clears provisional styling on a user edit and session teardown', () => {
    const { surface, view } = createSurface({ extensions: provisionalTranscriptExtension() });

    expect(append(surface, 'u1', 'live words').kind).toBe('appended');
    surface.setProvisional('u1', true);
    expect(provisionalDecorationCount(view.state)).toBe(1);

    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('input.type'),
        changes: { from: 1, to: 2, insert: 'I' },
      }),
    );
    expect(provisionalDecorationCount(view.state)).toBe(0);

    expect(append(surface, 'u2', 'more words').kind).toBe('appended');
    surface.setProvisional('u2', true);
    expect(provisionalDecorationCount(view.state)).toBe(1);
    surface.dispose();
    expect(provisionalDecorationCount(view.state)).toBe(0);
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

  it('lets only the newest session drive the shared cursor and clears it on the last dispose', () => {
    const view = new FakeEditorView('', 0, dictationAnchorExtension());
    const earlier = new NoteSurface(view as unknown as EditorView, { anchor: 'at_cursor' });
    const later = new NoteSurface(view as unknown as EditorView, { anchor: 'at_cursor' });

    // The older (non-owner) session cannot move the shared cursor.
    earlier.setAnchorMode('visible');
    expect(view.state.field(dictationAnchorStateField).mode).toBe('hidden');

    // The newest session owns it.
    later.setAnchorMode('visible');
    expect(view.state.field(dictationAnchorStateField).mode).toBe('visible');

    // An older session finishing must not wipe the newer session's cursor.
    earlier.dispose();
    expect(view.state.field(dictationAnchorStateField).mode).toBe('visible');

    // The last session to dispose clears it.
    later.dispose();
    expect(view.state.field(dictationAnchorStateField)).toEqual({ mode: 'hidden', pos: null });
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

  it('keeps section dictation before the following heading with valid line boundaries', () => {
    const documentText = '## Notes\n## Next';
    const position = documentText.indexOf('\n## Next');
    const view = new FakeEditorView(documentText, 0);
    const surface = new NoteSurface(view as unknown as EditorView, {
      anchor: 'section_end',
      position,
    });

    expect(doc(view)).toBe('## Notes\n\n## Next');
    expect(append(surface, 'u1', 'captured thought').kind).toBe('appended');
    expect(doc(view)).toBe('## Notes\ncaptured thought\n## Next');
  });

  it('removes an unused section boundary when startup ends before any transcript', () => {
    const documentText = '## Notes\n## Next';
    const position = documentText.indexOf('\n## Next');
    const view = new FakeEditorView(documentText, 0);
    const surface = new NoteSurface(view as unknown as EditorView, {
      anchor: 'section_end',
      position,
    });

    surface.dispose();

    expect(doc(view)).toBe(documentText);
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

  it('batch-rewrites the whole region even after the user edits an utterance', () => {
    const { surface, view } = createSurface();

    expect(append(surface, 'u1', 'first').kind).toBe('appended');
    expect(append(surface, 'u2', 'second').kind).toBe('appended');
    expect(append(surface, 'u3', 'third').kind).toBe('appended');

    // The user fixes a word in the middle utterance mid-session.
    surface.observeTransaction(
      view.apply({
        annotations: Transaction.userEvent.of('input.type'),
        changes: { from: 7, to: 8, insert: 'X' },
      }),
    );

    // Live mode still protects that edit: a per-utterance revision is denied.
    expect(surface.replaceAnchor('u2', 'SECOND', 'second').kind).toBe('denied');

    // Batch passes every session utterance as allowed, so the deliberate
    // whole-region rewrite overwrites the edited span instead of bailing.
    expect(
      surface.rewriteRegion({ from: 0, to: doc(view).length }, 'Cleaned all.', [
        { utteranceId: 'u1' },
        { utteranceId: 'u2' },
        { utteranceId: 'u3' },
      ]),
    ).toMatchObject({ kind: 'rewritten' });
    expect(doc(view)).toBe('Cleaned all.');
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
      [
        'acronyms',
        'We use NVIDIA GPU acceleration with STT.',
        'The notes mention NVIDIA, GPU, STT.',
      ],
      [
        'mixed-case identifiers',
        'See writingRegionTail and TranscriptionRequest for details.',
        'The notes mention writingRegionTail, TranscriptionRequest.',
      ],
      [
        'hyphenated, underscored, and dotted identifiers',
        'Files: note-surface, set_initial_prompt, whisper.cpp, Object.keys.',
        'The notes mention note-surface, set_initial_prompt, whisper.cpp, Object.keys.',
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
        text: 'The notes mention Sidecar.',
        truncated: false,
      });
    });

    it('extracts capitalized proper nouns and skips common sentence-start words', () => {
      const { surface } = createSurface({
        doc: 'The team chose Claude. And Alex agreed.',
        selectionHead: 0,
      });

      expect(surface.readNoteGlossary(384)).toEqual({
        text: 'The notes mention Claude, Alex.',
        truncated: false,
      });
    });

    it('dedupes case-insensitively, keeping the first-seen casing', () => {
      const { surface } = createSurface({
        doc: 'NVIDIA hardware and nvidia drivers from NVIDIA again.',
        selectionHead: 0,
      });

      expect(surface.readNoteGlossary(384)).toEqual({
        text: 'The notes mention NVIDIA.',
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
      expect(result?.text).toBe('The notes mention NVIDIA.');
    });

    it('scans the whole note, including text after the writing tail', () => {
      const { surface, view } = createSurface({ doc: 'NVIDIA ', selectionHead: 7 });

      view.dispatch({ changes: { from: 7, insert: 'after CUDA' } });

      expect(surface.readNoteGlossary(384)).toEqual({
        text: 'The notes mention NVIDIA, CUDA.',
        truncated: false,
      });
    });
  });
});
