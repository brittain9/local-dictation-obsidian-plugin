import type { EditorView } from '@codemirror/view';
import type { App, EventRef, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import type {
  AppendResult,
  NotePlacementOptions,
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

  replaceAnchor(utteranceId: string, newText: string, expectedOldText: string): ReplaceResult {
    this.replaceCalls.push({ expectedOldText, newText, utteranceId });

    const span = this.spans.get(utteranceId);
    const result: ReplaceResult =
      this.nextReplaceResult ??
      (span === undefined
        ? { kind: 'denied', reason: { kind: 'not_found' }, utteranceId }
        : {
            kind: 'replaced',
            span: {
              ...span,
              end: span.end + newText.length - expectedOldText.length,
              projectedText: newText,
              textEnd: span.textStart + newText.length,
            },
          });

    if (result.kind === 'replaced' && span !== undefined) {
      this.documentText = `${this.documentText.slice(0, span.textStart)}${newText}${this.documentText.slice(span.textEnd)}`;
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

  rewriteRegion(range: RewriteRange, newText: string): RewriteResult {
    this.rewriteCalls.push({ newText, range });

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
      text: 'Glossary: NVIDIA',
      truncated: true,
    });

    expect(session.readNoteGlossary(256)).toEqual({
      text: 'Glossary: NVIDIA',
      truncated: true,
    });
    expect(surface.readNoteGlossary).toHaveBeenCalledWith(256);
  });

  it('replaceSessionRangeWithCleaned succeeds when the current range matches recorded raw text', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ text: 'hello', utteranceId: 'u1' }));
    session.acceptTranscript(transcript({ text: 'world', utteranceId: 'u2' }));

    expect(surface.documentText).toBe('hello world');
    expect(session.joinRawSessionText()).toBe('hello world');
    expect(session.replaceSessionRangeWithCleaned('Hello world.')).toBe(true);

    expect(surface.rewriteCalls).toEqual([
      { newText: 'Hello world.', range: { from: 0, to: 'hello world'.length } },
    ]);
    expect(surface.documentText).toBe('Hello world.');
  });

  it('replaceSessionRangeWithCleaned force-replaces the tracked range even if its text diverged', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ text: 'raw words', utteranceId: 'u1' }));
    surface.documentText = 'raw words tail';

    expect(session.replaceSessionRangeWithCleaned('Cleaned words.')).toBe(true);
    expect(surface.rewriteCalls).toEqual([
      { newText: 'Cleaned words.', range: { from: 0, to: 'raw words'.length } },
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

  it('range tracking follows transcript revisions across multiple acceptTranscript calls', () => {
    const { session, surface } = createSessionHarness();

    session.acceptTranscript(transcript({ revision: 0, text: 'rough', utteranceId: 'u1' }));
    session.acceptTranscript(transcript({ revision: 1, text: 'polished', utteranceId: 'u1' }));
    session.acceptTranscript(transcript({ text: 'tail', utteranceId: 'u2' }));

    expect(surface.documentText).toBe('polished tail');
    expect(session.joinRawSessionText()).toBe('polished tail');
    expect(session.replaceSessionRangeWithCleaned('Polished tail.')).toBe(true);
    expect(surface.rewriteCalls[0]?.range).toEqual({ from: 0, to: 'polished tail'.length });
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
