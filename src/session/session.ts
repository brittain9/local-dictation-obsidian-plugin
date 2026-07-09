import type { EditorView } from '@codemirror/view';
import type { App, Editor, EventRef, TAbstractFile, TFile } from 'obsidian';
import type { DictationAnchorMode } from '../editor/dictation-anchor-extension';
import {
  type AppendResult,
  isLatchKind,
  type NotePlacementOptions,
  type NoteProjectionContext,
  NoteSurface,
  type PreservedSpan,
  type ProjectedSpan,
  type ReplaceResult,
  type RewriteRange,
  type RewriteResult,
  type SurfaceDesynchronization,
} from '../editor/note-surface';
import type { PluginLogger } from '../shared/plugin-logger';
import { truncateLeadingText } from '../shared/text-truncation';
import {
  type TranscriptInsertProjection,
  TranscriptRenderer,
  type TranscriptRenderOptions,
} from '../transcript/renderer';
import { SessionJournal, type TranscriptRevision, type UtteranceId } from './session-journal';

interface EditorWithCm extends Editor {
  cm?: EditorView;
}

interface MarkdownFileInfoLike {
  editor?: EditorWithCm;
  file: TFile | null;
}

interface MarkdownLeafLike {
  view?: MarkdownFileInfoLike;
}

type ProjectionState =
  | { kind: 'unprojected' }
  | {
      kind: 'projected';
      lastRevision: number;
      precedingSpeakerIndex: number | null;
      projectedText: string;
    }
  | { kind: 'latched' }
  | { kind: 'denied' };

export type SessionAcceptResult =
  | { kind: 'accepted' }
  | { kind: 'duplicate' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'stale' };

export interface SessionLifecycleCallbacks {
  onLockedNoteClosed: () => void;
  onLockedNoteDeleted: () => void;
  onSurfaceDesynchronized: (failure: SurfaceDesynchronization) => void;
}

export interface SessionDependencies {
  app: Pick<App, 'vault' | 'workspace'>;
  callbacks: SessionLifecycleCallbacks;
  logger?: PluginLogger;
  lockedFile: TFile;
  noteSurfaceFactory?: (
    view: EditorView,
    placement: NotePlacementOptions,
    onSurfaceDesynchronized: (failure: SurfaceDesynchronization) => void,
  ) => NoteSurfaceLike;
  placement: NotePlacementOptions;
  rendererOptions: TranscriptRenderOptions;
  sessionId: string;
  view: EditorView;
}

interface NoteSurfaceLike {
  appendProjection(utteranceId: string, projection: TranscriptInsertProjection): AppendResult;
  dispose(): void;
  getSpan(utteranceId: UtteranceId): ProjectedSpan | undefined;
  readRange(range: RewriteRange): string | null;
  readNoteGlossary(maxChars: number): { text: string; truncated: boolean } | null;
  readNoteText(maxChars: number): { text: string; truncated: boolean } | null;
  readProjectionContext(): NoteProjectionContext;
  replaceAnchor(
    utteranceId: string,
    newText: string,
    expectedOldText: string,
    removeBoundary?: boolean,
  ): ReplaceResult;
  rewriteRegion(
    range: RewriteRange,
    newText: string,
    preservedSpans: PreservedSpan[],
  ): RewriteResult;
  setAnchorMode(mode: DictationAnchorMode): SurfaceDesynchronization | null;
  setProcessingRange(range: { from: number; to: number } | null): SurfaceDesynchronization | null;
  setProvisional(utteranceId: UtteranceId, provisional: boolean): SurfaceDesynchronization | null;
  validateExternalModification(): SurfaceDesynchronization | null;
}

interface RawSessionEntry {
  rawText: string;
  replacementPrefix: string;
  utteranceId: UtteranceId;
}

export class Session {
  private readonly journal: SessionJournal;
  private readonly renderer: TranscriptRenderer;
  private noteDeleted = false;
  private noteOpen = true;
  private readonly projectionByUtterance = new Map<string, ProjectionState>();
  private readonly rawSessionEntries: RawSessionEntry[] = [];
  private readonly rawSessionEntryIndexByUtterance = new Map<UtteranceId, number>();
  private readonly refs: Array<{ offref: (ref: EventRef) => void; ref: EventRef }> = [];
  private surface: NoteSurfaceLike | null;
  private surfaceDesynchronized = false;

  static createFromActiveEditor(
    app: Pick<App, 'vault' | 'workspace'>,
    options: {
      callbacks: SessionLifecycleCallbacks;
      logger?: PluginLogger;
      placement: NotePlacementOptions;
      rendererOptions: TranscriptRenderOptions;
      sessionId: string;
    },
  ): Session {
    const active = resolveActiveEditorTarget(app);
    const fallback = active === null ? resolveFallbackEditorTarget(app) : null;
    const target = active ?? fallback;

    if (target === null) {
      throw new Error('No active Markdown editor is available.');
    }

    // No cursor available — append to end of the open note rather than blocking on a popup.
    const placement: NotePlacementOptions =
      fallback !== null ? { ...options.placement, anchor: 'end_of_note' } : options.placement;

    return new Session({
      app,
      callbacks: options.callbacks,
      lockedFile: target.file,
      placement,
      rendererOptions: options.rendererOptions,
      sessionId: options.sessionId,
      view: target.view,
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
    });
  }

  constructor(private readonly dependencies: SessionDependencies) {
    this.journal = new SessionJournal(dependencies.sessionId);
    this.renderer = new TranscriptRenderer(dependencies.rendererOptions);
    this.surface = (dependencies.noteSurfaceFactory ?? createNoteSurface)(
      dependencies.view,
      dependencies.placement,
      (failure) => {
        this.handleSurfaceDesynchronization(failure);
      },
    );
    this.registerLifecycleSubscriptions();
  }

  acceptTranscript(revision: TranscriptRevision): SessionAcceptResult {
    const result = this.journal.upsert(revision);

    if (result.kind !== 'accepted') {
      if (result.kind === 'rejected') {
        this.dependencies.logger?.warn('session', result.reason);
      }
      return result.kind === 'rejected'
        ? { kind: 'rejected', reason: result.reason }
        : { kind: result.kind };
    }

    this.projectRevision(result.revision);

    return { kind: 'accepted' };
  }

  readNoteGlossary(maxChars: number): { text: string; truncated: boolean } | null {
    return this.surface?.readNoteGlossary(maxChars) ?? null;
  }

  readNoteText(maxChars: number): { text: string; truncated: boolean } | null {
    return this.surface?.readNoteText(maxChars) ?? null;
  }

  readPriorUtterances(
    maxCount: number,
    maxCharsPerUtterance: number,
  ): Array<{ text: string; truncated: boolean }> {
    if (maxCount <= 0 || maxCharsPerUtterance <= 0) {
      return [];
    }

    return this.journal
      .allUtterancesInOrder()
      .filter((revision) => revision.isFinal && revision.text.trim().length > 0)
      .slice(-maxCount)
      .map((revision) => truncateLeadingText(revision.text, maxCharsPerUtterance));
  }

  joinRawSessionText(): string {
    return this.rawSessionEntries
      .map((entry) => entry.rawText.trim())
      .filter((text) => text.length > 0)
      .join(' ');
  }

  readCurrentSessionText(): string {
    if (this.surface === null || this.rawSessionEntries.length === 0) {
      return '';
    }

    const range = this.resolveSessionRange();
    if (range === null) {
      return '';
    }

    return (this.surface.readRange(range) ?? '').trim();
  }

  replaceSessionRangeWithCleaned(
    cleanText: string,
    options: {
      rawTextForCallout?: string;
      showRawBelow?: boolean;
    } = {},
  ): boolean {
    if (this.surface === null || this.rawSessionEntries.length === 0) {
      return false;
    }

    const range = this.resolveSessionRange();
    if (range === null) {
      return false;
    }

    const replacement = this.buildCleanedReplacement(
      cleanText,
      options.showRawBelow === true,
      options.rawTextForCallout,
    );
    // A batch rewrite deliberately replaces the whole session region we just
    // read, cleaned, and locked, so allow overwriting spans the user edited
    // mid-session — their edits were already folded into the cleaned text.
    // Passing [] here made any in-note edit during dictation bail the rewrite
    // and discard the (already paid-for) cleanup result.
    const result = this.surface.rewriteRegion(
      range,
      replacement,
      this.rawSessionEntries.map((entry) => ({ utteranceId: entry.utteranceId })),
    );

    if (result.kind === 'denied' && result.reason.kind === 'surface_desynchronized') {
      this.handleSurfaceDesynchronization(result.reason);
      return false;
    }

    return result.kind === 'rewritten';
  }

  insertAdjacentToSessionRange(blockText: string, placement: 'above' | 'below'): boolean {
    if (this.surface === null || this.rawSessionEntries.length === 0) {
      return false;
    }

    const range = this.resolveSessionRange();
    if (range === null) {
      return false;
    }

    const current = this.surface.readRange(range);
    if (current === null) {
      return false;
    }

    // Additive presets leave the dictated text untouched: rewrite the region to
    // itself with the generated block stitched above or below it, reusing the
    // same edit-tolerant region rewrite as the batch replace path.
    const replacement =
      placement === 'above' ? `${blockText}\n\n${current}` : `${current}\n\n${blockText}`;

    const result = this.surface.rewriteRegion(
      range,
      replacement,
      this.rawSessionEntries.map((entry) => ({ utteranceId: entry.utteranceId })),
    );

    if (result.kind === 'denied' && result.reason.kind === 'surface_desynchronized') {
      this.handleSurfaceDesynchronization(result.reason);
      return false;
    }

    return result.kind === 'rewritten';
  }

  setAnchorMode(mode: DictationAnchorMode): void {
    const result = this.surface?.setAnchorMode(mode);
    if (result !== undefined && result !== null) {
      this.handleSurfaceDesynchronization(result);
    }
  }

  markSessionRangeAsProcessing(): boolean {
    if (this.surface === null) {
      return false;
    }
    const range = this.resolveSessionRange();
    if (range === null) {
      return false;
    }
    const result = this.surface.setProcessingRange(range);
    if (result !== null) {
      this.handleSurfaceDesynchronization(result);
      return false;
    }
    return true;
  }

  clearSessionProcessingMark(): void {
    const result = this.surface?.setProcessingRange(null);
    if (result !== undefined && result !== null) {
      this.handleSurfaceDesynchronization(result);
    }
  }

  dispose(): void {
    this.journal.finalize();
    this.surface?.dispose();
    this.surface = null;
    this.releaseSubscriptions();
  }

  private projectRevision(revision: TranscriptRevision): void {
    if (this.noteDeleted) {
      this.projectionByUtterance.set(revision.utteranceId, { kind: 'denied' });
      return;
    }

    if (!this.noteOpen || this.surface === null) {
      this.projectionByUtterance.set(revision.utteranceId, { kind: 'denied' });
      return;
    }

    const state = this.projectionByUtterance.get(revision.utteranceId) ?? { kind: 'unprojected' };

    if (state.kind === 'latched' || state.kind === 'denied') {
      return;
    }

    if (state.kind === 'projected') {
      this.applyReplace(revision, state);
      return;
    }

    if (revision.isFinal && revision.text.length === 0) {
      return;
    }

    this.applyAppend(revision);
  }

  private applyAppend(revision: TranscriptRevision): void {
    const context = this.surface?.readProjectionContext();

    if (context === undefined) {
      return;
    }

    const projection = this.renderer.planAppend(
      {
        pauseMsBeforeUtterance: revision.pauseMsBeforeUtterance,
        spans: revision.spans,
        utteranceId: revision.utteranceId,
        utteranceStartMsInSession: revision.utteranceStartMsInSession,
      },
      context,
    );
    const result = this.surface?.appendProjection(revision.utteranceId, projection);

    if (result === undefined) {
      return;
    }

    if (result.kind === 'appended') {
      this.projectionByUtterance.set(revision.utteranceId, {
        kind: 'projected',
        lastRevision: revision.revision,
        precedingSpeakerIndex: projection.precedingSpeakerIndex,
        projectedText: projection.insertedText,
      });
      if (!this.updateProvisionalState(revision.utteranceId, !revision.isFinal)) {
        return;
      }
      this.recordRawSessionAppend(revision, projection);
      this.renderer.commitAppend(projection);
      this.applyRawPostprocessCallout(revision);
      return;
    }

    if (result.reason.kind === 'surface_desynchronized') {
      this.handleSurfaceDesynchronization(result.reason);
      return;
    }

    this.projectionByUtterance.set(revision.utteranceId, { kind: 'denied' });
    this.dependencies.logger?.debug('session', `projection append denied: ${result.reason.kind}`);
  }

  // The per-utterance raw callout preserves the pre-cleanup text of a final
  // whose LLM postprocess rewrote it. Returns the formatted callout body, or
  // null when this revision does not warrant one.
  private rawPostprocessCalloutText(revision: TranscriptRevision): string | null {
    if (!revision.isFinal) {
      return null;
    }

    const rawText = revision.llmPostprocessRawText?.trim();
    if (rawText === undefined || rawText.length === 0 || rawText === revision.text.trim()) {
      return null;
    }

    return formatRawPostprocessCallout(rawText);
  }

  private applyRawPostprocessCallout(revision: TranscriptRevision): void {
    const callout = this.rawPostprocessCalloutText(revision);
    if (callout === null) {
      return;
    }

    const context = this.surface?.readProjectionContext();
    if (context === undefined) {
      return;
    }

    const boundary = missingNewlines(context.tailContent, 2);
    const projection: TranscriptInsertProjection = {
      emittedSpeakerIndex: null,
      emittedTimestamp: null,
      insertedText: callout,
      precedingSpeakerIndex: null,
      projectedText: `${boundary}${callout}`,
      replacementPrefix: boundary,
      textEndOffset: boundary.length + callout.length,
      textStartOffset: boundary.length,
    };
    const result = this.surface?.appendProjection(`${revision.utteranceId}:llm_raw`, projection);

    if (result?.kind === 'denied') {
      if (result.reason.kind === 'surface_desynchronized') {
        this.handleSurfaceDesynchronization(result.reason);
        return;
      }
      this.dependencies.logger?.debug(
        'session',
        `raw LLM postprocess callout append denied (${callout.length} chars): ${result.reason.kind}`,
      );
    }
  }

  private applyReplace(
    revision: TranscriptRevision,
    state: Extract<ProjectionState, { kind: 'projected' }>,
  ): void {
    if (revision.revision <= state.lastRevision) {
      return;
    }

    // A multi-speaker utterance carries labels interleaved in its body, so it
    // must be recomposed (not swapped for the plain joined text) to preserve
    // attribution. Single-speaker stays plain so the label in the prefix is
    // untouched.
    const replacementText =
      revision.spans.length > 1
        ? this.renderer.composeReplacementBody(revision.spans, state.precedingSpeakerIndex)
        : revision.text;

    // Fold the raw callout into the same atomic replace as the cleaned text so
    // it lands directly beneath this utterance. A separate tail append would
    // sit after any later utterance whose partial was projected while this
    // final's LLM cleanup was still pending.
    const callout = replacementText.length > 0 ? this.rawPostprocessCalloutText(revision) : null;
    const projectedText = callout === null ? replacementText : `${replacementText}\n\n${callout}`;

    const result = this.surface?.replaceAnchor(
      revision.utteranceId,
      projectedText,
      state.projectedText,
      revision.isFinal && projectedText.length === 0,
    );

    if (result === undefined) {
      return;
    }

    if (result.kind === 'replaced') {
      this.projectionByUtterance.set(revision.utteranceId, {
        kind: 'projected',
        lastRevision: revision.revision,
        precedingSpeakerIndex: state.precedingSpeakerIndex,
        projectedText,
      });
      if (!this.updateProvisionalState(revision.utteranceId, !revision.isFinal)) {
        return;
      }
      this.recordRawSessionReplace(revision);
      return;
    }

    if (result.reason.kind === 'surface_desynchronized') {
      this.handleSurfaceDesynchronization(result.reason);
      return;
    }

    if (isLatchKind(result.reason.kind)) {
      this.projectionByUtterance.set(revision.utteranceId, { kind: 'latched' });
    } else {
      this.projectionByUtterance.set(revision.utteranceId, { kind: 'denied' });
    }
    if (!this.updateProvisionalState(revision.utteranceId, false)) {
      return;
    }
    this.dependencies.logger?.debug('session', `projection replace denied: ${result.reason.kind}`);
  }

  private registerLifecycleSubscriptions(): void {
    const { vault, workspace } = this.dependencies.app;

    this.refs.push({
      offref: (ref) => workspace.offref(ref),
      ref: workspace.on('layout-change', () => {
        this.handleLayoutChange();
      }),
    });
    this.refs.push({
      offref: (ref) => vault.offref(ref),
      ref: vault.on('delete', (file) => {
        this.handleDelete(file);
      }),
    });
    this.refs.push({
      offref: (ref) => vault.offref(ref),
      ref: vault.on('modify', (file) => {
        this.handleModify(file);
      }),
    });
    this.refs.push({
      offref: (ref) => vault.offref(ref),
      ref: vault.on('rename', (file, oldPath) => {
        this.handleRename(file, oldPath);
      }),
    });
  }

  private releaseSubscriptions(): void {
    while (this.refs.length > 0) {
      const subscription = this.refs.pop();
      if (subscription !== undefined) {
        subscription.offref(subscription.ref);
      }
    }
  }

  private handleLayoutChange(): void {
    if (this.noteDeleted || !this.noteOpen) {
      return;
    }

    if (this.hasOpenLockedFile()) {
      return;
    }

    this.noteOpen = false;
    this.surface?.dispose();
    this.surface = null;
    this.dependencies.callbacks.onLockedNoteClosed();
  }

  private handleDelete(file: TAbstractFile): void {
    if (file !== this.dependencies.lockedFile || this.noteDeleted) {
      return;
    }

    this.noteDeleted = true;
    this.noteOpen = false;
    this.surface?.dispose();
    this.surface = null;
    this.dependencies.callbacks.onLockedNoteDeleted();
  }

  private handleModify(file: TAbstractFile): void {
    if (file === this.dependencies.lockedFile) {
      const result = this.surface?.validateExternalModification();
      if (result !== undefined && result !== null) {
        this.handleSurfaceDesynchronization(result);
      }
    }
  }

  private handleSurfaceDesynchronization(failure: SurfaceDesynchronization): void {
    if (this.surfaceDesynchronized) {
      return;
    }

    this.surfaceDesynchronized = true;
    this.surface?.dispose();
    this.surface = null;
    this.dependencies.callbacks.onSurfaceDesynchronized(failure);
  }

  private updateProvisionalState(utteranceId: UtteranceId, provisional: boolean): boolean {
    const failure = this.surface?.setProvisional(utteranceId, provisional);
    if (failure === undefined || failure === null) {
      return true;
    }

    this.handleSurfaceDesynchronization(failure);
    return false;
  }

  private handleRename(file: TAbstractFile, oldPath: string): void {
    if (file === this.dependencies.lockedFile) {
      this.dependencies.logger?.debug(
        'session',
        `locked note renamed from ${oldPath} to ${file.path}`,
      );
    }
  }

  private hasOpenLockedFile(): boolean {
    return (
      findOpenMarkdownViewForFile(this.dependencies.app, this.dependencies.lockedFile) !== null
    );
  }

  private recordRawSessionAppend(
    revision: TranscriptRevision,
    projection: TranscriptInsertProjection,
  ): void {
    if (this.rawSessionEntryIndexByUtterance.has(revision.utteranceId)) {
      return;
    }

    this.rawSessionEntryIndexByUtterance.set(revision.utteranceId, this.rawSessionEntries.length);
    this.rawSessionEntries.push({
      rawText: revision.text,
      replacementPrefix: projection.replacementPrefix,
      utteranceId: revision.utteranceId,
    });
  }

  private recordRawSessionReplace(revision: TranscriptRevision): void {
    const index = this.rawSessionEntryIndexByUtterance.get(revision.utteranceId);
    if (index === undefined) {
      return;
    }

    const entry = this.rawSessionEntries[index];
    if (entry === undefined) {
      return;
    }

    entry.rawText = revision.text;
  }

  private resolveSessionRange(): RewriteRange | null {
    if (this.surface === null || this.rawSessionEntries.length === 0) {
      return null;
    }

    const spans = this.rawSessionEntries.map((entry) => this.surface?.getSpan(entry.utteranceId));
    if (spans.some((span) => span === undefined)) {
      return null;
    }

    const first = spans[0];
    const last = spans.at(-1);
    if (first === undefined || last === undefined) {
      return null;
    }

    return { from: first.start, to: last.end };
  }

  private buildCleanedReplacement(
    cleanText: string,
    showRawBelow: boolean,
    rawTextForCallout?: string,
  ): string {
    const firstPrefix = this.rawSessionEntries[0]?.replacementPrefix ?? '';
    const trimmed = cleanText.trim();
    if (!showRawBelow) {
      return `${firstPrefix}${trimmed}`;
    }

    const rawText = (rawTextForCallout ?? this.joinRawSessionText()).trim();
    if (rawText.length === 0) {
      return `${firstPrefix}${trimmed}`;
    }

    return `${firstPrefix}${trimmed}\n\n${formatRawPostprocessCallout(rawText)}`;
  }
}

function createNoteSurface(
  view: EditorView,
  placement: NotePlacementOptions,
  onSurfaceDesynchronized: (failure: SurfaceDesynchronization) => void,
): NoteSurface {
  return new NoteSurface(view, placement, onSurfaceDesynchronized);
}

function resolveActiveEditorTarget(
  app: Pick<App, 'workspace'>,
): { file: TFile; view: EditorView } | null {
  const activeEditor = app.workspace.activeEditor as MarkdownFileInfoLike | null;
  const file = activeEditor?.file ?? null;
  const view = activeEditor?.editor?.cm ?? null;

  if (file === null || view === null) {
    return null;
  }

  return { file, view };
}

function resolveFallbackEditorTarget(
  app: Pick<App, 'workspace'>,
): { file: TFile; view: EditorView } | null {
  const activeFile = app.workspace.getActiveFile();

  if (activeFile === null) {
    return null;
  }

  const leafView = findOpenMarkdownViewForFile(app, activeFile);
  const view = leafView?.editor?.cm ?? null;

  if (view === null) {
    return null;
  }

  return { file: activeFile, view };
}

function findOpenMarkdownViewForFile(
  app: Pick<App, 'workspace'>,
  lockedFile: TFile,
): MarkdownFileInfoLike | null {
  for (const leaf of app.workspace.getLeavesOfType('markdown') as unknown as MarkdownLeafLike[]) {
    if (leaf.view?.file === lockedFile) {
      return leaf.view;
    }
  }

  return null;
}

function formatRawPostprocessCallout(rawText: string): string {
  const quoted = rawText
    .split(/\r?\n/u)
    .map((line) => `> ${line}`)
    .join('\n');

  return `> [!note]- raw\n${quoted}`;
}

function missingNewlines(tailContent: string, requiredTrailingNewlines: number): string {
  let existing = 0;

  for (let index = tailContent.length - 1; index >= 0; index -= 1) {
    if (tailContent.charAt(index) !== '\n') {
      break;
    }
    existing += 1;
  }

  return '\n'.repeat(Math.max(0, requiredTrailingNewlines - existing));
}
