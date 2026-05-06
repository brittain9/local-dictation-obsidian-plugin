import type { EditorView } from '@codemirror/view';
import type { App, EventRef, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import type {
  AppendResult,
  NotePlacementOptions,
  NoteProjectionContext,
  ReplaceResult,
} from '../src/editor/note-surface';
import { Session } from '../src/session/session';
import type {
  TranscriptInsertProjection,
  TranscriptRenderOptions,
} from '../src/transcript/renderer';
import { transcript } from './fixtures/transcript';

class FakeSurface {
  public readonly appendCalls: Array<{
    projection: TranscriptInsertProjection;
    utteranceId: string;
  }> = [];
  public readonly replaceCalls: Array<{
    expectedOldProjection: TranscriptInsertProjection;
    newProjection: TranscriptInsertProjection;
    utteranceId: string;
  }> = [];
  public readonly dispose = vi.fn();
  public readonly readNoteGlossary = vi.fn(
    (_maxChars: number): { text: string; truncated: boolean } | null => null,
  );
  public readonly setAnchorMode = vi.fn();
  public readonly validateExternalModification = vi.fn();
  public nextAppendResult: AppendResult | null = null;
  public nextReplaceResult: ReplaceResult | null = null;

  public projectionContext: NoteProjectionContext = { tailContent: '' };

  readProjectionContext(): { tailContent: string } {
    return this.projectionContext;
  }

  appendProjection(utteranceId: string, projection: TranscriptInsertProjection): AppendResult {
    this.appendCalls.push({ projection, utteranceId });

    return (
      this.nextAppendResult ?? {
        kind: 'appended',
        span: {
          end: projection.projectedText.length,
          projectedText: projection.projectedText,
          start: 0,
          textEnd: projection.textEndOffset,
          textStart: projection.textStartOffset,
          utteranceId,
        },
      }
    );
  }

  replaceProjection(
    utteranceId: string,
    newProjection: TranscriptInsertProjection,
    expectedOldProjection: TranscriptInsertProjection,
  ): ReplaceResult {
    this.replaceCalls.push({ expectedOldProjection, newProjection, utteranceId });

    return (
      this.nextReplaceResult ?? {
        kind: 'replaced',
        span: {
          end: newProjection.projectedText.length,
          projectedText: newProjection.projectedText,
          start: 0,
          textEnd: newProjection.textEndOffset,
          textStart: newProjection.textStartOffset,
          utteranceId,
        },
      }
    );
  }
}

describe('Session', () => {
  it('projects new and revised transcripts through append then full-projection replace', () => {
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
    expect(surface.replaceCalls).toHaveLength(1);
    expect(surface.replaceCalls[0]).toMatchObject({
      expectedOldProjection: { projectedText: 'rough' },
      newProjection: { insertedText: 'polished', projectedText: 'polished' },
      utteranceId: 'u1',
    });
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
      rendererOptions: { showTimestamps: true, transcriptFormatting: 'space' },
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

  it('projects partial to partial to final using the original append context', () => {
    const { session, surface } = createSessionHarness();
    surface.projectionContext = { tailContent: 'note' };

    expect(
      session.acceptTranscript(
        transcript({ isFinal: false, revision: 0, text: 'twenty', utteranceId: 'u1' }),
      ),
    ).toEqual({ kind: 'accepted' });
    surface.projectionContext = { tailContent: 'ignored current tail' };
    expect(
      session.acceptTranscript(
        transcript({ isFinal: false, revision: 1, text: 'twenty twenty', utteranceId: 'u1' }),
      ),
    ).toEqual({ kind: 'accepted' });
    expect(
      session.acceptTranscript(
        transcript({ isFinal: true, revision: 2, text: '2020', utteranceId: 'u1' }),
      ),
    ).toEqual({ kind: 'accepted' });

    expect(surface.appendCalls).toHaveLength(1);
    expect(surface.appendCalls[0]?.projection.projectedText).toBe(' twenty');
    expect(surface.replaceCalls.map((call) => call.newProjection.projectedText)).toEqual([
      ' twenty twenty',
      ' 2020',
    ]);
  });

  it('ignores empty initial partials', () => {
    const { session, surface } = createSessionHarness({
      rendererOptions: { showTimestamps: true, transcriptFormatting: 'space' },
    });

    expect(
      session.acceptTranscript(
        transcript({ isFinal: false, revision: 0, text: '', utteranceId: 'u1' }),
      ),
    ).toEqual({ kind: 'accepted' });

    expect(surface.appendCalls).toHaveLength(0);
    expect(surface.replaceCalls).toHaveLength(0);
  });

  it('allows an empty final to clear an existing partial projection', () => {
    const { session, surface } = createSessionHarness({
      rendererOptions: { showTimestamps: true, transcriptFormatting: 'new_paragraph' },
    });
    surface.projectionContext = { tailContent: 'note' };

    session.acceptTranscript(
      transcript({
        isFinal: false,
        revision: 0,
        text: 'false start',
        utteranceId: 'u1',
        utteranceStartMsInSession: 12_000,
      }),
    );
    session.acceptTranscript(
      transcript({
        isFinal: true,
        revision: 1,
        text: '',
        utteranceId: 'u1',
        utteranceStartMsInSession: 12_000,
      }),
    );

    expect(surface.replaceCalls).toHaveLength(1);
    expect(surface.replaceCalls[0]).toMatchObject({
      expectedOldProjection: { projectedText: ' false start' },
      newProjection: { projectedText: '' },
      utteranceId: 'u1',
    });

    surface.projectionContext = { tailContent: 'note' };
    session.acceptTranscript(
      transcript({
        isFinal: true,
        revision: 0,
        text: 'next',
        utteranceId: 'u2',
        utteranceStartMsInSession: 15_000,
      }),
    );
    expect(surface.appendCalls[1]?.projection.projectedText).toBe(' (0:15) next');
  });

  it('adds timestamp only when a partial projection is finalized', () => {
    const { session, surface } = createSessionHarness({
      rendererOptions: { showTimestamps: true, transcriptFormatting: 'space' },
    });

    session.acceptTranscript(
      transcript({
        isFinal: false,
        revision: 0,
        text: 'twenty twenty',
        utteranceId: 'u1',
        utteranceStartMsInSession: 25_000,
      }),
    );
    session.acceptTranscript(
      transcript({
        isFinal: true,
        revision: 1,
        text: '2020',
        utteranceId: 'u1',
        utteranceStartMsInSession: 25_000,
      }),
    );

    expect(surface.appendCalls[0]?.projection.projectedText).toBe('twenty twenty');
    expect(surface.replaceCalls[0]?.newProjection.projectedText).toBe('(0:25) 2020');
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

  it('proxies readNoteContext to the active surface', () => {
    const { session, surface } = createSessionHarness();
    surface.readNoteGlossary.mockReturnValueOnce({
      text: 'Glossary: NVIDIA',
      truncated: true,
    });

    expect(session.readNoteContext(256)).toEqual({
      text: 'Glossary: NVIDIA',
      truncated: true,
    });
    expect(surface.readNoteGlossary).toHaveBeenCalledWith(256);
  });

  it('returns null from readNoteContext when the surface is detached', () => {
    const { session } = createSessionHarness();
    session.dispose();

    expect(session.readNoteContext(256)).toBeNull();
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
    rendererOptions: options.rendererOptions ?? {
      showTimestamps: false,
      transcriptFormatting: 'space',
    },
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
