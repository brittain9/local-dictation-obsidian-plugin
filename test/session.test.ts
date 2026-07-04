import type { EditorView } from '@codemirror/view';
import type { App, EventRef, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import type {
  AppendResult,
  NotePlacementOptions,
  PreservedSpan,
  ProjectedSpan,
  ReplaceResult,
  RewriteRange,
  RewriteResult,
} from '../src/editor/note-surface';
import { Session } from '../src/session/session';
import type {
  TranscriptInsertProjection,
  TranscriptRenderOptions,
} from '../src/transcript/renderer';
import { transcript } from './fixtures/transcript';
import { renderOptions, timestamps } from './helpers/render-options';

class FakeSurface {
  public readonly appendCalls: Array<{
    projection: TranscriptInsertProjection;
    utteranceId: string;
  }> = [];
  public readonly replaceCalls: Array<{
    expectedOldText: string;
    newText: string;
    utteranceId: string;
  }> = [];
  public readonly rewriteCalls: Array<{
    newText: string;
    preservedSpans: PreservedSpan[];
    range: RewriteRange;
  }> = [];
  public readonly dispose = vi.fn();
  public readonly readNoteGlossary = vi.fn(
    (_maxChars: number): { text: string; truncated: boolean } | null => null,
  );
  public readonly readNoteText = vi.fn(
    (_maxChars: number): { text: string; truncated: boolean } | null => null,
  );
  public readonly setAnchorMode = vi.fn();
  public readonly setProcessingRange = vi.fn(
    (_range: { from: number; to: number } | null): void => undefined,
  );
  public readonly setProvisional = vi.fn(
    (_utteranceId: string, _provisional: boolean): void => undefined,
  );
  public readonly validateExternalModification = vi.fn();
  public documentText = '';
  public nextAppendResult: AppendResult | null = null;
  public nextReplaceResult: ReplaceResult | null = null;
  public nextRewriteResult: RewriteResult | null = null;

  public projectionContext = { tailContent: '' };
  private readonly spans = new Map<string, ProjectedSpan>();

  readProjectionContext(): { tailContent: string } {
    return { tailContent: this.documentText.slice(-2) || this.projectionContext.tailContent };
  }

  appendProjection(utteranceId: string, projection: TranscriptInsertProjection): AppendResult {
    this.appendCalls.push({ projection, utteranceId });

    const from = this.documentText.length;
    const result = this.nextAppendResult ?? {
      kind: 'appended',
      span: {
        end: from + projection.projectedText.length,
        projectedText: projection.insertedText,
        start: from,
        textEnd: from + projection.textEndOffset,
        textStart: from + projection.textStartOffset,
        utteranceId,
      },
    };

    if (result.kind === 'appended') {
      this.documentText = `${this.documentText}${projection.projectedText}`;
      this.spans.set(utteranceId, result.span);
    }

    return result;
  }

  replaceAnchor(
    utteranceId: string,
    newText: string,
    expectedOldText: string,
    removeBoundary = newText.length === 0,
  ): ReplaceResult {
    this.replaceCalls.push({ expectedOldText, newText, utteranceId });

    const span = this.spans.get(utteranceId);
    const replacementStart = span !== undefined && removeBoundary ? span.start : span?.textStart;
    const result: ReplaceResult =
      this.nextReplaceResult ??
      (span === undefined
        ? { kind: 'denied', reason: { kind: 'not_found' }, utteranceId }
        : {
            kind: 'replaced',
            span: {
              ...span,
              end:
                span.end - (span.textEnd - (replacementStart ?? span.textStart)) + newText.length,
              projectedText: newText,
              textEnd: (replacementStart ?? span.textStart) + newText.length,
              textStart: replacementStart ?? span.textStart,
            },
          });

    if (result.kind === 'replaced' && span !== undefined) {
      const from = replacementStart ?? span.textStart;
      this.documentText = `${this.documentText.slice(0, from)}${newText}${this.documentText.slice(span.textEnd)}`;
      this.spans.set(utteranceId, result.span);
    }

    return result;
  }

  getSpan(utteranceId: string): ProjectedSpan | undefined {
    const span = this.spans.get(utteranceId);
    return span === undefined ? undefined : { ...span };
  }

  readRange(range: RewriteRange): string | null {
    if (range.from < 0 || range.to < range.from || range.to > this.documentText.length) {
      return null;
    }

    return this.documentText.slice(range.from, range.to);
  }

  rewriteRegion(
    range: RewriteRange,
    newText: string,
    preservedSpans: PreservedSpan[],
  ): RewriteResult {
    this.rewriteCalls.push({ newText, preservedSpans, range });

    if (this.nextRewriteResult !== null) {
      return this.nextRewriteResult;
    }

    if (this.readRange(range) === null) {
      return { kind: 'denied', reason: { kind: 'range_invalid' } };
    }

    this.documentText = `${this.documentText.slice(0, range.from)}${newText}${this.documentText.slice(range.to)}`;
    this.spans.clear();

    return { kind: 'rewritten', range };
  }
}

describe('Session', () => {
  it('replaces a partial in place when its final revision arrives', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(
      transcript({ isFinal: false, revision: 0, text: 'live words', utteranceId: 'u1' }),
    );
    session.acceptTranscript(
      transcript({ isFinal: true, revision: 1, text: 'final words.', utteranceId: 'u1' }),
    );

    expect(surface.documentText).toBe('final words.');
    expect(surface.appendCalls).toHaveLength(1);
    expect(surface.replaceCalls).toEqual([
      { expectedOldText: 'live words', newText: 'final words.', utteranceId: 'u1' },
    ]);
    expect(surface.setProvisional).toHaveBeenNthCalledWith(1, 'u1', true);
    expect(surface.setProvisional).toHaveBeenNthCalledWith(2, 'u1', false);
  });

  it('keeps a user-edited partial latched while recording later partials and the final', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(
      transcript({ isFinal: false, revision: 0, text: 'live words', utteranceId: 'u1' }),
    );
    surface.nextReplaceResult = {
      kind: 'denied',
      reason: { currentText: 'user words', kind: 'span_mismatch' },
      utteranceId: 'u1',
    };
    session.acceptTranscript(
      transcript({ isFinal: false, revision: 1, text: 'new partial', utteranceId: 'u1' }),
    );
    session.acceptTranscript(
      transcript({ isFinal: true, revision: 2, text: 'final words.', utteranceId: 'u1' }),
    );

    expect(surface.replaceCalls).toHaveLength(1);
    expect(surface.setProvisional).toHaveBeenLastCalledWith('u1', false);
    expect(session.readPriorUtterances(1, 100)).toEqual([
      { text: 'final words.', truncated: false },
    ]);
  });

  it('removes a projected partial and its insertion boundary when the final is empty', () => {
    const { session, surface } = createSessionHarness();
    surface.documentText = 'Existing';

    session.acceptTranscript(
      transcript({ isFinal: false, revision: 0, text: 'live words', utteranceId: 'u1' }),
    );
    expect(surface.documentText).toBe('Existing live words');

    session.acceptTranscript(
      transcript({ isFinal: true, revision: 1, text: '', utteranceId: 'u1' }),
    );

    expect(surface.documentText).toBe('Existing');
    expect(surface.replaceCalls).toEqual([
      { expectedOldText: 'live words', newText: '', utteranceId: 'u1' },
    ]);
  });

  it('emits a timestamp on the first partial without timestamp churn on revisions', () => {
    const { session, surface } = createSessionHarness({
      rendererOptions: renderOptions({
        timestamps: timestamps({ enabled: true, header: false }),
      }),
    });

    session.acceptTranscript(
      transcript({
        isFinal: false,
        revision: 0,
        text: 'first partial',
        utteranceId: 'u1',
        utteranceStartMsInSession: 10_000,
      }),
    );
    session.acceptTranscript(
      transcript({
        isFinal: false,
        revision: 1,
        text: 'second partial',
        utteranceId: 'u1',
        utteranceStartMsInSession: 10_000,
      }),
    );
    session.acceptTranscript(
      transcript({
        isFinal: true,
        revision: 2,
        text: 'final words.',
        utteranceId: 'u1',
        utteranceStartMsInSession: 10_000,
      }),
    );

    expect(surface.documentText).toBe('(0:10) final words.');
    expect(surface.appendCalls).toHaveLength(1);
    expect(surface.replaceCalls).toHaveLength(2);
  });

  it('preserves the separator and timestamp across an empty partial revision', () => {
    const { session, surface } = createSessionHarness({
      rendererOptions: renderOptions({
        timestamps: timestamps({ enabled: true, header: false }),
      }),
    });
    surface.documentText = 'Existing';

    session.acceptTranscript(
      transcript({
        isFinal: false,
        revision: 0,
        text: 'first partial',
        utteranceId: 'u1',
        utteranceStartMsInSession: 10_000,
      }),
    );
    session.acceptTranscript(
      transcript({ isFinal: false, revision: 1, text: '', utteranceId: 'u1' }),
    );
    session.acceptTranscript(
      transcript({ isFinal: false, revision: 2, text: 'next partial', utteranceId: 'u1' }),
    );

    expect(surface.documentText).toBe('Existing (0:10) next partial');
    expect(surface.appendCalls).toHaveLength(1);
  });

  it('projects new and revised transcripts through append then replace using last projected text', () => {
    const { session, surface } = createSessionHarness();

    expect(
      session.acceptTranscript(transcript({ revision: 0, text: 'rough', utteranceId: 'u1' })),
    ).toEqual({
      kind: 'accepted',
    });
    expect(
      session.acceptTranscript(transcript({ revision: 1, text: 'polished', utteranceId: 'u1' })),
    ).toEqual({
      kind: 'accepted',
    });

    expect(surface.appendCalls).toHaveLength(1);
    expect(surface.appendCalls[0]).toMatchObject({
      projection: { insertedText: 'rough', projectedText: 'rough' },
      utteranceId: 'u1',
    });
    expect(surface.replaceCalls).toEqual([
      { expectedOldText: 'rough', newText: 'polished', utteranceId: 'u1' },
    ]);
  });

  it('does not project duplicate or stale revisions', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ revision: 1, text: 'current', utteranceId: 'u1' }));
    expect(
      session.acceptTranscript(transcript({ revision: 1, text: 'duplicate', utteranceId: 'u1' })),
    ).toEqual({
      kind: 'duplicate',
    });
    expect(
      session.acceptTranscript(transcript({ revision: 0, text: 'stale', utteranceId: 'u1' })),
    ).toEqual({
      kind: 'stale',
    });

    expect(surface.appendCalls).toHaveLength(1);
    expect(surface.replaceCalls).toHaveLength(0);
  });

  it('latches a denied replace and never queues later retries', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ revision: 0, text: 'manual target', utteranceId: 'u1' }));
    surface.nextReplaceResult = {
      kind: 'denied',
      reason: { currentText: 'manual edit', kind: 'span_mismatch' },
      utteranceId: 'u1',
    };
    session.acceptTranscript(transcript({ revision: 1, text: 'replacement', utteranceId: 'u1' }));
    session.acceptTranscript(
      transcript({ revision: 2, text: 'later replacement', utteranceId: 'u1' }),
    );

    expect(surface.replaceCalls).toHaveLength(1);
  });

  it('does not retry projection after an append denial', () => {
    const { session, surface } = createSessionHarness();

    surface.nextAppendResult = {
      kind: 'denied',
      reason: { kind: 'disposed' },
      utteranceId: 'u1',
    };
    session.acceptTranscript(transcript({ revision: 0, text: 'first', utteranceId: 'u1' }));
    session.acceptTranscript(transcript({ revision: 1, text: 'second', utteranceId: 'u1' }));

    expect(surface.appendCalls).toHaveLength(1);
    expect(surface.replaceCalls).toHaveLength(0);
  });

  it('commits renderer timestamp state only after a successful append', () => {
    const { session, surface } = createSessionHarness({
      rendererOptions: renderOptions({
        timestamps: timestamps({ enabled: true, header: false }),
      }),
    });

    surface.nextAppendResult = {
      kind: 'denied',
      reason: { kind: 'disposed' },
      utteranceId: 'u1',
    };
    session.acceptTranscript(
      transcript({ text: 'first', utteranceId: 'u1', utteranceStartMsInSession: 0 }),
    );
    surface.nextAppendResult = null;
    session.acceptTranscript(
      transcript({ text: 'second', utteranceId: 'u2', utteranceStartMsInSession: 10_000 }),
    );

    expect(surface.appendCalls).toHaveLength(2);
    expect(surface.appendCalls[1]).toMatchObject({
      projection: { projectedText: '(0:10) second' },
      utteranceId: 'u2',
    });
  });

  it('keeps projecting to the locked background note when the active tab changes', () => {
    const { callbacks, lockedFile, session, surface, workspace } = createSessionHarness();
    const otherFile = fakeFile('other.md');

    workspace.activeEditor = fakeActiveEditor(otherFile);
    workspace.trigger('layout-change');
    session.acceptTranscript(transcript({ text: 'background write', utteranceId: 'u1' }));

    expect(callbacks.onLockedNoteClosed).not.toHaveBeenCalled();
    expect(surface.appendCalls).toHaveLength(1);
    expect(surface.appendCalls[0]).toMatchObject({
      projection: { insertedText: 'background write', projectedText: 'background write' },
      utteranceId: 'u1',
    });
    expect(workspace.leaves[0]?.view?.file).toBe(lockedFile);
  });

  it('requests graceful stop when the locked note is no longer open', () => {
    const { callbacks, session, surface, workspace } = createSessionHarness();

    workspace.leaves = [];
    workspace.trigger('layout-change');
    session.acceptTranscript(transcript({ text: 'drained journal only', utteranceId: 'u1' }));

    expect(callbacks.onLockedNoteClosed).toHaveBeenCalledTimes(1);
    expect(surface.dispose).toHaveBeenCalledTimes(1);
    expect(surface.appendCalls).toHaveLength(0);
  });

  it('requests cancel on locked-note delete and never writes later transcripts', () => {
    const { callbacks, lockedFile, session, surface, vault } = createSessionHarness();

    vault.trigger('delete', lockedFile);
    session.acceptTranscript(transcript({ text: 'journal only', utteranceId: 'u1' }));

    expect(callbacks.onLockedNoteDeleted).toHaveBeenCalledTimes(1);
    expect(surface.dispose).toHaveBeenCalledTimes(1);
    expect(surface.appendCalls).toHaveLength(0);
  });

  it('follows rename by file identity and validates external modifications on the same file', () => {
    const { lockedFile, session, surface, vault } = createSessionHarness();

    lockedFile.path = 'renamed.md';
    vault.trigger('rename', lockedFile, 'note.md');
    vault.trigger('modify', lockedFile);
    session.acceptTranscript(transcript({ text: 'after rename', utteranceId: 'u1' }));

    expect(surface.validateExternalModification).toHaveBeenCalledTimes(1);
    expect(surface.appendCalls).toHaveLength(1);
    expect(surface.appendCalls[0]).toMatchObject({
      projection: { insertedText: 'after rename', projectedText: 'after rename' },
      utteranceId: 'u1',
    });
  });

  it('proxies readNoteGlossary to the active surface', () => {
    const { session, surface } = createSessionHarness();
    surface.readNoteGlossary.mockReturnValueOnce({
      text: 'The notes mention NVIDIA.',
      truncated: true,
    });

    expect(session.readNoteGlossary(256)).toEqual({
      text: 'The notes mention NVIDIA.',
      truncated: true,
    });
    expect(surface.readNoteGlossary).toHaveBeenCalledWith(256);
  });

  it('tracks transcript revisions through batch-cleaned range replacement', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ revision: 0, text: 'rough', utteranceId: 'u1' }));
    session.acceptTranscript(transcript({ revision: 1, text: 'polished', utteranceId: 'u1' }));
    session.acceptTranscript(transcript({ text: 'tail', utteranceId: 'u2' }));

    expect(surface.documentText).toBe('polished tail');
    expect(session.joinRawSessionText()).toBe('polished tail');
    expect(session.replaceSessionRangeWithCleaned('Polished tail.')).toBe(true);

    expect(surface.rewriteCalls).toEqual([
      {
        newText: 'Polished tail.',
        preservedSpans: [{ utteranceId: 'u1' }, { utteranceId: 'u2' }],
        range: { from: 0, to: 'polished tail'.length },
      },
    ]);
    expect(surface.documentText).toBe('Polished tail.');
  });

  it('omits emptied finalized utterances from joined raw session text', () => {
    const { session } = createSessionHarness();

    session.acceptTranscript(transcript({ text: 'first', utteranceId: 'u1' }));
    session.acceptTranscript(transcript({ isFinal: false, text: 'temporary', utteranceId: 'u2' }));
    session.acceptTranscript(
      transcript({ isFinal: true, revision: 1, text: '', utteranceId: 'u2' }),
    );
    session.acceptTranscript(transcript({ text: 'third', utteranceId: 'u3' }));

    expect(session.joinRawSessionText()).toBe('first third');
  });

  it('replaceSessionRangeWithCleaned force-replaces the tracked range even if its text diverged', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ text: 'raw words', utteranceId: 'u1' }));
    surface.documentText = 'raw words tail';

    expect(session.replaceSessionRangeWithCleaned('Cleaned words.')).toBe(true);
    expect(surface.rewriteCalls).toEqual([
      {
        newText: 'Cleaned words.',
        preservedSpans: [{ utteranceId: 'u1' }],
        range: { from: 0, to: 'raw words'.length },
      },
    ]);
    expect(surface.documentText).toBe('Cleaned words. tail');
  });

  it('appends the raw callout below the cleaned text when showRawBelow is set', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ text: 'raw words', utteranceId: 'u1' }));

    expect(
      session.replaceSessionRangeWithCleaned('Cleaned words.', {
        showRawBelow: true,
      }),
    ).toBe(true);
    expect(surface.documentText).toBe('Cleaned words.\n\n> [!note]- raw\n> raw words');
  });

  it('appends the raw callout when a projected partial is replaced by a cleaned final', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(
      transcript({ isFinal: false, revision: 0, text: 'raw words', utteranceId: 'u1' }),
    );
    session.acceptTranscript(
      transcript({
        isFinal: true,
        llmPostprocessRawText: 'raw words',
        revision: 1,
        text: 'Cleaned words.',
        utteranceId: 'u1',
      }),
    );

    expect(surface.documentText).toBe('Cleaned words.\n\n> [!note]- raw\n> raw words');
  });

  it('folds the raw callout beneath its own utterance when a later utterance was projected first', () => {
    const { session, surface } = createSessionHarness();

    // A's partial projects, then B's partial projects while A's cleaned final is
    // still pending (its LLM cleanup runs async in the controller).
    session.acceptTranscript(
      transcript({ isFinal: false, revision: 0, text: 'raw words', utteranceId: 'u1' }),
    );
    session.acceptTranscript(
      transcript({ isFinal: false, revision: 0, text: 'more', utteranceId: 'u2' }),
    );
    session.acceptTranscript(
      transcript({
        isFinal: true,
        llmPostprocessRawText: 'raw words',
        revision: 1,
        text: 'Cleaned words.',
        utteranceId: 'u1',
      }),
    );

    // The callout lands directly beneath A, not after the later utterance B.
    expect(surface.documentText).toBe('Cleaned words.\n\n> [!note]- raw\n> raw words more');
  });

  it('insertAdjacentToSessionRange prepends above the untouched session range', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ text: 'hello world', utteranceId: 'u1' }));

    expect(session.insertAdjacentToSessionRange('TLDR\n- point', 'above')).toBe(true);
    expect(surface.rewriteCalls).toEqual([
      {
        newText: 'TLDR\n- point\n\nhello world',
        preservedSpans: [{ utteranceId: 'u1' }],
        range: { from: 0, to: 'hello world'.length },
      },
    ]);
    expect(surface.documentText).toBe('TLDR\n- point\n\nhello world');
  });

  it('insertAdjacentToSessionRange appends below the session range', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ text: 'hello world', utteranceId: 'u1' }));

    expect(session.insertAdjacentToSessionRange('Action items', 'below')).toBe(true);
    expect(surface.documentText).toBe('hello world\n\nAction items');
  });

  it('insertAdjacentToSessionRange returns false with no session entries', () => {
    const { session } = createSessionHarness();

    expect(session.insertAdjacentToSessionRange('x', 'above')).toBe(false);
  });

  it('preserves the first insertion boundary when replacing a batch-cleaned range', () => {
    const { session, surface } = createSessionHarness();
    surface.documentText = 'Existing';

    session.acceptTranscript(transcript({ text: 'raw words', utteranceId: 'u1' }));

    expect(surface.documentText).toBe('Existing raw words');
    expect(session.replaceSessionRangeWithCleaned('Cleaned words.')).toBe(true);
    expect(surface.documentText).toBe('Existing Cleaned words.');
  });

  it('does not force timestamps into batch-cleaned output', () => {
    const { session, surface } = createSessionHarness({
      rendererOptions: renderOptions({
        timestamps: timestamps({ enabled: true, header: true }),
      }),
    });

    session.acceptTranscript(transcript({ text: 'raw words', utteranceId: 'u1' }));

    expect(surface.documentText).toBe('[2026-05-16 14:32]\n(0:00) raw words');
    expect(session.readCurrentSessionText()).toBe('[2026-05-16 14:32]\n(0:00) raw words');
    expect(session.replaceSessionRangeWithCleaned('Cleaned words.')).toBe(true);
    expect(surface.documentText).toBe('Cleaned words.');
  });

  it('marks the session range as processing and clears the mark on demand', () => {
    const { session, surface } = createSessionHarness();

    expect(session.markSessionRangeAsProcessing()).toBe(false);
    expect(surface.setProcessingRange).not.toHaveBeenCalled();

    session.acceptTranscript(transcript({ text: 'hello', utteranceId: 'u1' }));
    session.acceptTranscript(transcript({ text: 'world', utteranceId: 'u2' }));

    expect(session.markSessionRangeAsProcessing()).toBe(true);
    expect(surface.setProcessingRange).toHaveBeenLastCalledWith({
      from: 0,
      to: 'hello world'.length,
    });

    session.clearSessionProcessingMark();
    expect(surface.setProcessingRange).toHaveBeenLastCalledWith(null);
  });

  it('returns null from readNoteGlossary when the surface is detached', () => {
    const { session } = createSessionHarness();
    session.dispose();

    expect(session.readNoteGlossary(256)).toBeNull();
  });
});

function createSessionHarness(options: { rendererOptions?: TranscriptRenderOptions } = {}): {
  callbacks: {
    onLockedNoteClosed: ReturnType<typeof vi.fn>;
    onLockedNoteDeleted: ReturnType<typeof vi.fn>;
  };
  lockedFile: TFile;
  session: Session;
  surface: FakeSurface;
  vault: FakeEvents;
  workspace: FakeWorkspace;
} {
  const lockedFile = fakeFile('note.md');
  const surface = new FakeSurface();
  const vault = new FakeEvents();
  const workspace = new FakeWorkspace(lockedFile);
  const callbacks = {
    onLockedNoteClosed: vi.fn(),
    onLockedNoteDeleted: vi.fn(),
  };
  const app = { vault, workspace } as unknown as Pick<App, 'vault' | 'workspace'>;
  const placement: NotePlacementOptions = { anchor: 'at_cursor' };
  const session = new Session({
    app,
    callbacks,
    lockedFile,
    noteSurfaceFactory: () => surface,
    placement,
    rendererOptions: options.rendererOptions ?? renderOptions(),
    sessionId: 'session-1',
    view: {} as EditorView,
  });

  return { callbacks, lockedFile, session, surface, vault, workspace };
}

class FakeEvents {
  private nextRef = 0;
  private readonly handlers = new Map<
    string,
    Array<{ handler: (...args: unknown[]) => void; ref: EventRef }>
  >();

  on(name: string, handler: (...args: unknown[]) => void): EventRef {
    const ref = { id: this.nextRef++ } as unknown as EventRef;
    const handlers = this.handlers.get(name) ?? [];
    handlers.push({ handler, ref });
    this.handlers.set(name, handlers);
    return ref;
  }

  offref(ref: EventRef): void {
    for (const [name, handlers] of this.handlers.entries()) {
      this.handlers.set(
        name,
        handlers.filter((entry) => entry.ref !== ref),
      );
    }
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const entry of this.handlers.get(name) ?? []) {
      entry.handler(...args);
    }
  }
}

class FakeWorkspace extends FakeEvents {
  public activeEditor: unknown;
  public leaves: Array<{ view: { editor: { cm: EditorView }; file: TFile } }> = [];

  constructor(file: TFile) {
    super();
    this.activeEditor = fakeActiveEditor(file);
    this.leaves = [this.activeEditor as { view: { editor: { cm: EditorView }; file: TFile } }];
  }

  getLeavesOfType(viewType: string): Array<{ view: { editor: { cm: EditorView }; file: TFile } }> {
    return viewType === 'markdown' ? this.leaves : [];
  }
}

function fakeActiveEditor(file: TFile): { view: { editor: { cm: EditorView }; file: TFile } } {
  return {
    view: {
      editor: { cm: {} as EditorView },
      file,
    },
  };
}

function fakeFile(path: string): TFile {
  return {
    name: path.split('/').at(-1) ?? path,
    parent: null,
    path,
    vault: null,
  } as unknown as TFile;
}
