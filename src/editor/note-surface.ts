import type { Extension, StateEffect } from '@codemirror/state';
import { Annotation, Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';

import type { UtteranceId } from '../session/session-journal';
import type { DictationAnchor } from '../settings/plugin-settings';
import { truncateTrailingText } from '../shared/text-truncation';
import type { TranscriptInsertProjection } from '../transcript/renderer';
import {
  clearAnchorEffect,
  type DictationAnchorMode,
  setAnchorEffect,
  setAnchorModeEffect,
} from './dictation-anchor-extension';
import {
  clearProvisionalTranscriptEffect,
  setProvisionalTranscriptEffect,
} from './provisional-transcript-extension';
import {
  bypassSessionProcessingLock,
  type SessionProcessingRange,
  setSessionProcessingEffect,
} from './session-processing-extension';
import { computeFirstPhrasePrefix } from './transcript-placement';

export interface NotePlacementOptions {
  anchor: DictationAnchor;
}

export interface NoteProjectionContext {
  readonly tailContent: string;
}

export type LatchKind = 'user_edited' | 'span_mismatch';

export function isLatchKind(kind: string): kind is LatchKind {
  return kind === 'user_edited' || kind === 'span_mismatch';
}

export interface ProjectedSpan {
  end: number;
  latched?: LatchKind;
  projectedText: string;
  start: number;
  textEnd: number;
  textStart: number;
  utteranceId: UtteranceId;
}

interface CompanionSpan {
  end: number;
  latched?: LatchKind;
  projectedText: string;
  start: number;
  utteranceId: UtteranceId;
}

export interface SurfaceDesynchronization {
  readonly documentLength: number;
  readonly kind: 'surface_desynchronized';
  readonly trackedPosition: number;
}

export type AppendDenialReason =
  | { kind: 'disposed' }
  | { kind: 'already_projected' }
  | SurfaceDesynchronization;

export type AppendResult =
  | {
      kind: 'appended';
      span: ProjectedSpan;
    }
  | {
      kind: 'denied';
      reason: AppendDenialReason;
      utteranceId: UtteranceId;
    };

export type ReplaceDenialReason =
  | { kind: 'disposed' }
  | { kind: 'not_found' }
  | { kind: 'user_edited' }
  | { currentText: string; kind: 'span_mismatch' }
  | SurfaceDesynchronization;

export type ReplaceResult =
  | {
      kind: 'replaced';
      span: ProjectedSpan;
    }
  | {
      kind: 'denied';
      reason: ReplaceDenialReason;
      utteranceId: UtteranceId;
    };

export interface RewriteRange {
  from: number;
  to: number;
}

export interface PreservedSpan {
  utteranceId: UtteranceId;
}

export type RewriteDenialReason =
  | { kind: 'disposed' }
  | { kind: 'range_invalid' }
  | { kind: 'range_partial' }
  | { kind: 'user_edited' }
  | { kind: 'span_mismatch' }
  | SurfaceDesynchronization;

export type RewriteResult =
  | {
      kind: 'rewritten';
      range: RewriteRange;
    }
  | {
      kind: 'denied';
      reason: RewriteDenialReason;
    };

const noteSurfaceInsertOrder = Annotation.define<number>();
const noteSurfacesByView = new WeakMap<EditorView, Set<NoteSurface>>();
let nextSurfaceOrder = 0;

function registerNoteSurface(surface: NoteSurface): void {
  const existing = noteSurfacesByView.get(surface.view);
  if (existing !== undefined) {
    existing.add(surface);
    return;
  }

  noteSurfacesByView.set(surface.view, new Set([surface]));
}

function unregisterNoteSurface(surface: NoteSurface): void {
  const surfaces = noteSurfacesByView.get(surface.view);
  if (surfaces === undefined) {
    return;
  }

  surfaces.delete(surface);
}

export function noteSurfaceUpdateListenerExtension(): Extension {
  return EditorView.updateListener.of((update) => {
    const surfaces = noteSurfacesByView.get(update.view);
    if (surfaces === undefined) {
      return;
    }

    for (const surface of [...surfaces]) {
      surface.observeTransaction(update);
    }
  });
}

export class NoteSurface {
  private readonly createdAt = nextSurfaceOrder;
  private desynchronization: SurfaceDesynchronization | null = null;
  private disposed = false;
  private initialAnchorPos: number;
  private readonly initialBoundaryPos: number;
  private pendingInitialPrefix = '';
  private readonly spans = new Map<UtteranceId, ProjectedSpan>();
  private readonly companionSpans = new Map<UtteranceId, CompanionSpan>();

  constructor(
    readonly view: EditorView,
    private readonly placement: NotePlacementOptions,
    private readonly onSurfaceDesynchronized?: (failure: SurfaceDesynchronization) => void,
  ) {
    nextSurfaceOrder += 1;
    this.initialAnchorPos = this.computePinPosition();
    this.insertInitialPrefix();
    this.initialBoundaryPos = this.initialAnchorPos;
    // Register before pinning the anchor so the ownership check below sees this
    // surface — a freshly created surface is always the newest, so it owns the
    // shared cursor.
    registerNoteSurface(this);
    if (this.isAnchorOwner()) {
      this.view.dispatch({ effects: setAnchorEffect.of(this.initialAnchorPos) });
    }
  }

  observeTransaction(update: ViewUpdate): SurfaceDesynchronization | null {
    if (this.disposed || update.view !== this.view || !update.docChanged) {
      return null;
    }
    if (this.desynchronization !== null) {
      return this.desynchronization;
    }

    const desynchronization = this.detectOwnedDesynchronization(update.startState.doc.length);
    if (desynchronization !== null) {
      this.onSurfaceDesynchronized?.(desynchronization);
      return desynchronization;
    }

    const spansBefore = [...this.spans.values()].map(cloneSpan);
    const companionsBefore = [...this.companionSpans.values()].map(cloneCompanionSpan);
    const latchedUtteranceIds: string[] = [];

    this.mapSpans(update);

    if (!this.hasLatchableUserChange(update)) {
      return null;
    }

    for (const before of spansBefore) {
      const current = this.spans.get(before.utteranceId);

      if (current === undefined || current.latched !== undefined) {
        continue;
      }

      if (changeIntersectsSpan(update, before)) {
        current.latched = 'user_edited';
        latchedUtteranceIds.push(current.utteranceId);
      }
    }

    this.clearProvisional(latchedUtteranceIds);
    for (const before of companionsBefore) {
      const current = this.companionSpans.get(before.utteranceId);
      if (
        current !== undefined &&
        current.latched === undefined &&
        changeIntersectsSpan(update, before)
      ) {
        current.latched = 'user_edited';
      }
    }
    return null;
  }

  replaceUtteranceCompanion(utteranceId: UtteranceId, blockText: string): boolean {
    if (this.disposed) return false;
    if (this.detectDesynchronization() !== null) return false;
    const source = this.spans.get(utteranceId);
    if (source === undefined) return false;
    const text = blockText.trim();
    if (text.length === 0) return false;
    const rendered = `\n\n${text}\n\n`;
    const existing = this.companionSpans.get(utteranceId);
    if (existing?.latched !== undefined) return false;
    if (
      existing !== undefined &&
      this.view.state.doc.sliceString(existing.start, existing.end) !== existing.projectedText
    ) {
      existing.latched = 'span_mismatch';
      return false;
    }
    const start = existing?.start ?? source.end;
    const end = existing?.end ?? start;
    this.view.dispatch({
      changes: { from: start, to: end, insert: rendered },
      effects: this.ownerAnchorEffects(start + rendered.length),
    });
    const currentSource = this.spans.get(utteranceId);
    if (currentSource !== undefined) currentSource.end = start;
    this.companionSpans.set(utteranceId, {
      end: start + rendered.length,
      projectedText: rendered,
      start,
      utteranceId,
    });
    this.pendingInitialPrefix = '';
    return true;
  }

  readProjectionContext(): NoteProjectionContext {
    const tail = this.writingRegionTail();
    const from = Math.max(0, tail - 2);

    return {
      tailContent: this.view.state.doc.sliceString(from, tail),
    };
  }

  appendProjection(utteranceId: UtteranceId, projection: TranscriptInsertProjection): AppendResult {
    if (this.disposed) {
      return { kind: 'denied', reason: { kind: 'disposed' }, utteranceId };
    }

    const desynchronization = this.detectDesynchronization();
    if (desynchronization !== null) {
      return { kind: 'denied', reason: desynchronization, utteranceId };
    }

    if (this.spans.has(utteranceId)) {
      return { kind: 'denied', reason: { kind: 'already_projected' }, utteranceId };
    }

    const from = this.writingRegionTail();
    const textStart = from + projection.textStartOffset;
    const textEnd = from + projection.textEndOffset;
    const to = from + projection.projectedText.length;

    this.view.dispatch({
      annotations: noteSurfaceInsertOrder.of(this.createdAt),
      changes: { from, insert: projection.projectedText },
      effects: this.ownerAnchorEffects(to),
    });

    const span: ProjectedSpan = {
      end: to,
      projectedText: projection.insertedText,
      start: from,
      textEnd,
      textStart,
      utteranceId,
    };
    this.spans.set(utteranceId, span);
    this.pendingInitialPrefix = '';

    return { kind: 'appended', span: cloneSpan(span) };
  }

  replaceAnchor(
    utteranceId: UtteranceId,
    newText: string,
    expectedOldText: string,
    removeBoundary = newText.length === 0,
  ): ReplaceResult {
    if (this.disposed) {
      return { kind: 'denied', reason: { kind: 'disposed' }, utteranceId };
    }

    const desynchronization = this.detectDesynchronization();
    if (desynchronization !== null) {
      return { kind: 'denied', reason: desynchronization, utteranceId };
    }

    const span = this.spans.get(utteranceId);

    if (span === undefined) {
      return { kind: 'denied', reason: { kind: 'not_found' }, utteranceId };
    }

    if (span.latched !== undefined) {
      return { kind: 'denied', reason: this.latchedReason(span), utteranceId };
    }

    const currentText = this.view.state.doc.sliceString(span.textStart, span.textEnd);

    if (currentText !== expectedOldText || currentText !== span.projectedText) {
      span.latched = 'span_mismatch';
      this.clearProvisional([utteranceId]);
      return {
        kind: 'denied',
        reason: { currentText, kind: 'span_mismatch' },
        utteranceId,
      };
    }

    const replacementStart = removeBoundary ? span.start : span.textStart;
    this.view.dispatch({
      changes: { from: replacementStart, to: span.textEnd, insert: newText },
      effects: this.ownerAnchorEffects(replacementStart + newText.length),
    });

    // The editor update listener has already mapped every tracked position,
    // including this span and any companion block. Re-anchor the replaceable
    // text explicitly instead of applying a second length delta to `end`.
    // The old delta calculation double-counted source changes when a companion
    // translation was present, leaving the final translation detached.
    span.start = removeBoundary ? replacementStart : span.start;
    span.textStart = replacementStart;
    span.textEnd = replacementStart + newText.length;
    span.end = this.companionSpans.get(utteranceId)?.start ?? span.textEnd;
    span.projectedText = newText;

    return { kind: 'replaced', span: cloneSpan(span) };
  }

  readRange(range: RewriteRange): string | null {
    if (this.disposed || !this.isValidRange(range)) {
      return null;
    }

    return this.view.state.doc.sliceString(range.from, range.to);
  }

  readRangeExcludingCompanions(range: RewriteRange): string | null {
    const value = this.readRange(range);
    if (value === null) return null;
    const companions = [...this.companionSpans.values()]
      .filter((span) => span.start >= range.from && span.end <= range.to)
      .sort((a, b) => a.start - b.start);
    if (companions.length === 0) return value;
    let result = '';
    let cursor = range.from;
    for (const companion of companions) {
      result += this.view.state.doc.sliceString(cursor, companion.start);
      cursor = companion.end;
    }
    return `${result}${this.view.state.doc.sliceString(cursor, range.to)}`;
  }

  readDocumentText(): string {
    return this.view.state.doc.toString();
  }

  rewriteRegion(
    range: RewriteRange,
    newText: string,
    preservedSpans: PreservedSpan[],
  ): RewriteResult {
    if (this.disposed) {
      return { kind: 'denied', reason: { kind: 'disposed' } };
    }

    const desynchronization = this.detectDesynchronization();
    if (desynchronization !== null) {
      return { kind: 'denied', reason: desynchronization };
    }

    if (!this.isValidRange(range)) {
      return { kind: 'denied', reason: { kind: 'range_invalid' } };
    }

    const preserved = new Set(preservedSpans.map((span) => span.utteranceId));
    const overlappingSpans = [...this.spans.values()].filter((span) =>
      rangeIntersects(range.from, range.to, span.start, span.end),
    );
    const spansInRange = overlappingSpans.filter(
      (span) => span.start >= range.from && span.end <= range.to,
    );

    if (overlappingSpans.length !== spansInRange.length) {
      return { kind: 'denied', reason: { kind: 'range_partial' } };
    }

    for (const span of spansInRange) {
      if (preserved.has(span.utteranceId)) {
        continue;
      }

      if (span.latched !== undefined) {
        return { kind: 'denied', reason: { kind: span.latched } };
      }

      if (this.view.state.doc.sliceString(span.textStart, span.textEnd) !== span.projectedText) {
        span.latched = 'span_mismatch';
        return { kind: 'denied', reason: { kind: 'span_mismatch' } };
      }
    }

    const end = range.from + newText.length;
    const ownsAnchor = this.isAnchorOwner();
    this.view.dispatch({
      annotations: bypassSessionProcessingLock.of(true),
      changes: { from: range.from, to: range.to, insert: newText },
      effects: this.ownerAnchorEffects(end),
      // Only move the real caret when this surface owns the cursor, so a batch
      // rewrite from an older session can't yank focus from a newer session.
      ...(ownsAnchor ? { selection: { anchor: end } } : {}),
    });
    for (const span of spansInRange) {
      this.spans.delete(span.utteranceId);
    }
    for (const [utteranceId, companion] of this.companionSpans) {
      if (companion.start >= range.from && companion.end <= range.to) {
        this.companionSpans.delete(utteranceId);
      }
    }
    this.clearProvisional(spansInRange.map((span) => span.utteranceId));
    this.pendingInitialPrefix = '';

    return { kind: 'rewritten', range };
  }

  validateExternalModification(): SurfaceDesynchronization | null {
    if (this.disposed) {
      return null;
    }

    const desynchronization = this.detectDesynchronization();
    if (desynchronization !== null) {
      return desynchronization;
    }

    const latchedUtteranceIds: string[] = [];
    for (const span of this.spans.values()) {
      if (span.latched !== undefined) {
        continue;
      }

      if (this.view.state.doc.sliceString(span.textStart, span.textEnd) !== span.projectedText) {
        span.latched = 'span_mismatch';
        latchedUtteranceIds.push(span.utteranceId);
      }
    }
    this.clearProvisional(latchedUtteranceIds);
    return null;
  }

  setAnchorMode(mode: DictationAnchorMode): SurfaceDesynchronization | null {
    if (this.disposed) {
      return null;
    }
    const desynchronization = this.detectDesynchronization();
    if (desynchronization !== null) {
      return desynchronization;
    }
    if (this.isAnchorOwner()) {
      this.view.dispatch({ effects: setAnchorModeEffect.of(mode) });
    }
    return null;
  }

  setProcessingRange(range: SessionProcessingRange | null): SurfaceDesynchronization | null {
    if (this.disposed) {
      return null;
    }
    const desynchronization = this.detectDesynchronization();
    if (desynchronization !== null) {
      return desynchronization;
    }
    this.view.dispatch({ effects: setSessionProcessingEffect.of(range) });
    return null;
  }

  setProvisional(utteranceId: UtteranceId, provisional: boolean): SurfaceDesynchronization | null {
    if (this.disposed) {
      return null;
    }
    const desynchronization = this.detectDesynchronization();
    if (desynchronization !== null) {
      return desynchronization;
    }
    const span = this.spans.get(utteranceId);
    if (!provisional || span === undefined || span.latched !== undefined) {
      this.clearProvisional([utteranceId]);
      return null;
    }
    this.view.dispatch({
      effects: setProvisionalTranscriptEffect.of({
        from: span.textStart,
        to: span.textEnd,
        utteranceId,
      }),
    });
    return null;
  }

  trimPendingInitialPrefix(): SurfaceDesynchronization | null {
    if (this.disposed) {
      return null;
    }
    const desynchronization = this.detectDesynchronization();
    if (desynchronization !== null) {
      return desynchronization;
    }
    if (this.pendingInitialPrefix.length === 0) {
      return null;
    }

    const pending = this.pendingInitialPrefix;
    const tail = this.writingRegionTail();
    const start = tail - pending.length;

    if (start >= 0 && this.view.state.doc.sliceString(start, tail) === pending) {
      this.view.dispatch({ changes: { from: start, to: tail, insert: '' } });

      const lastSpan = this.lastSpan();

      if (lastSpan !== null && lastSpan.end === tail) {
        lastSpan.end = start;
      }
    }

    this.pendingInitialPrefix = '';
    return null;
  }

  dispose(): SurfaceDesynchronization | null {
    if (this.disposed) {
      return this.desynchronization;
    }

    const desynchronization = this.detectDesynchronization();
    if (desynchronization === null) {
      this.trimPendingInitialPrefix();
    }
    const provisionalUtteranceIds = [...this.spans.keys()];
    this.companionSpans.clear();
    this.disposed = true;
    unregisterNoteSurface(this);
    // The anchor is a single shared widget. Only clear it when no other live
    // session is still using it — otherwise a draining older session would wipe
    // the newer session's cursor. The processing range is a single shared field
    // too, but only the session currently draining ever shows the flash, so the
    // disposing session always clears it.
    const effects = [
      setSessionProcessingEffect.of(null),
      clearProvisionalTranscriptEffect.of(provisionalUtteranceIds),
    ];
    if (!this.hasOtherLiveSibling()) {
      effects.push(clearAnchorEffect.of(null));
    }
    this.view.dispatch({ effects });
    return desynchronization;
  }

  // The shared cursor belongs to the newest live surface for this view. With
  // overlapping sessions (a new one started while a previous one still drains
  // on a slow backend), this keeps a single session in control of the cursor.
  private isAnchorOwner(): boolean {
    if (this.disposed) {
      return false;
    }

    const siblings = noteSurfacesByView.get(this.view);
    if (siblings === undefined) {
      return true;
    }

    for (const surface of siblings) {
      if (surface !== this && !surface.disposed && surface.createdAt > this.createdAt) {
        return false;
      }
    }

    return true;
  }

  private clearProvisional(utteranceIds: readonly UtteranceId[]): void {
    if (utteranceIds.length > 0) {
      this.view.dispatch({ effects: clearProvisionalTranscriptEffect.of(utteranceIds) });
    }
  }

  private hasOtherLiveSibling(): boolean {
    const siblings = noteSurfacesByView.get(this.view);
    if (siblings === undefined) {
      return false;
    }

    for (const surface of siblings) {
      if (surface !== this && !surface.disposed) {
        return true;
      }
    }

    return false;
  }

  private ownerAnchorEffects(pos: number): StateEffect<number>[] {
    if (!this.isAnchorOwner()) {
      return [];
    }

    return [setAnchorEffect.of(pos)];
  }

  getSpan(utteranceId: UtteranceId): ProjectedSpan | undefined {
    const span = this.spans.get(utteranceId);
    return span === undefined ? undefined : cloneSpan(span);
  }

  getCompanionEnd(utteranceId: UtteranceId): number | undefined {
    return this.companionSpans.get(utteranceId)?.end;
  }

  // Whisper's `initial_prompt` is style-imitative, so present spelling hints
  // as sentence-cased transcript prose instead of a Title-Case glossary list.
  readNoteGlossary(maxChars: number): { text: string; truncated: boolean } | null {
    if (this.disposed || maxChars <= 0) {
      return null;
    }

    return buildGlossary(this.view.state.doc.toString(), maxChars);
  }

  readNoteText(maxChars: number): { text: string; truncated: boolean } | null {
    if (this.disposed || maxChars <= 0) {
      return null;
    }

    const beforeAnchor = this.view.state.doc.sliceString(0, this.writingRegionTail()).trim();
    if (beforeAnchor.length === 0) {
      return null;
    }

    return truncateTrailingText(beforeAnchor, maxChars);
  }

  private insertInitialPrefix(): void {
    const charBeforeAnchor =
      this.initialAnchorPos > 0
        ? this.view.state.doc.sliceString(this.initialAnchorPos - 1, this.initialAnchorPos)
        : null;
    const prefix = computeFirstPhrasePrefix({
      anchor: this.placement.anchor,
      charBeforeAnchor,
    });

    if (prefix.length === 0) {
      return;
    }

    const from = this.initialAnchorPos;
    this.view.dispatch({ changes: { from, insert: prefix } });
    this.initialAnchorPos += prefix.length;
    this.pendingInitialPrefix = prefix;
  }

  private computePinPosition(): number {
    if (this.placement.anchor === 'end_of_note') {
      return this.view.state.doc.length;
    }

    return this.view.state.selection.main.head;
  }

  private writingRegionTail(): number {
    let tail = Math.max(this.initialAnchorPos, ...[...this.spans.values()].map((span) => span.end));
    tail = Math.max(tail, ...[...this.companionSpans.values()].map((span) => span.end));
    const siblingSurfaces = noteSurfacesByView.get(this.view);

    if (siblingSurfaces === undefined) {
      return tail;
    }

    for (const surface of siblingSurfaces) {
      if (
        surface === this ||
        surface.disposed ||
        surface.initialBoundaryPos !== this.initialBoundaryPos ||
        surface.createdAt >= this.createdAt
      ) {
        continue;
      }

      tail = Math.max(tail, surface.writingRegionTail());
    }

    return tail;
  }

  private detectDesynchronization(
    documentLength = this.view.state.doc.length,
  ): SurfaceDesynchronization | null {
    const ownedDesynchronization = this.detectOwnedDesynchronization(documentLength);
    if (ownedDesynchronization !== null) {
      return ownedDesynchronization;
    }

    const writingRegionTail = this.writingRegionTail();
    if (!isDocumentPosition(writingRegionTail, documentLength)) {
      return this.markDesynchronized(writingRegionTail, documentLength);
    }

    return null;
  }

  private detectOwnedDesynchronization(documentLength: number): SurfaceDesynchronization | null {
    if (this.desynchronization !== null) {
      return this.desynchronization;
    }

    if (!isDocumentPosition(this.initialAnchorPos, documentLength)) {
      return this.markDesynchronized(this.initialAnchorPos, documentLength);
    }

    for (const span of this.spans.values()) {
      const positions = [span.start, span.textStart, span.textEnd, span.end];
      let previous = -1;
      for (const position of positions) {
        if (!isDocumentPosition(position, documentLength) || position < previous) {
          return this.markDesynchronized(position, documentLength);
        }
        previous = position;
      }
    }

    for (const companion of this.companionSpans.values()) {
      const positions = [companion.start, companion.end];
      let previous = -1;
      for (const position of positions) {
        if (!isDocumentPosition(position, documentLength) || position < previous) {
          return this.markDesynchronized(position, documentLength);
        }
        previous = position;
      }
    }

    return null;
  }

  private markDesynchronized(
    trackedPosition: number,
    documentLength: number,
  ): SurfaceDesynchronization {
    const failure: SurfaceDesynchronization = {
      documentLength,
      kind: 'surface_desynchronized',
      trackedPosition,
    };
    this.desynchronization = failure;
    return failure;
  }

  private lastSpan(): ProjectedSpan | null {
    let last: ProjectedSpan | null = null;

    for (const span of this.spans.values()) {
      if (last === null || span.end > last.end) {
        last = span;
      }
    }

    return last;
  }

  private mapSpans(update: ViewUpdate): void {
    const insertOrder = update.transactions
      .map((transaction) => transaction.annotation(noteSurfaceInsertOrder))
      .find((order) => order !== undefined);
    const spanStartBias = insertOrder !== undefined && insertOrder < this.createdAt ? 1 : -1;
    const initialAnchorBias = insertOrder !== undefined && insertOrder > this.createdAt ? -1 : 1;

    for (const span of this.spans.values()) {
      span.start = update.changes.mapPos(span.start, spanStartBias);
      span.textStart = update.changes.mapPos(span.textStart, spanStartBias);
      // Text bias: insertions at textEnd land outside the span, so a sibling
      // append at writingRegionTail() doesn't swallow the next utterance.
      span.textEnd = update.changes.mapPos(span.textEnd, -1);
      span.end = update.changes.mapPos(span.end, 1);
    }
    for (const companion of this.companionSpans.values()) {
      companion.start = update.changes.mapPos(companion.start, 1);
      companion.end = update.changes.mapPos(companion.end, 1);
    }

    // Tail bias: insertions at the initial anchor extend the writing region.
    this.initialAnchorPos = update.changes.mapPos(this.initialAnchorPos, initialAnchorBias);
  }

  private latchedReason(span: ProjectedSpan): ReplaceDenialReason {
    if (span.latched === 'user_edited') {
      return { kind: 'user_edited' };
    }

    return {
      currentText: this.view.state.doc.sliceString(span.textStart, span.textEnd),
      kind: 'span_mismatch',
    };
  }

  private hasLatchableUserChange(update: ViewUpdate): boolean {
    return update.transactions.some((transaction) => {
      if (transaction.annotation(Transaction.userEvent) === undefined) {
        return false;
      }

      return !transaction.isUserEvent('undo') && !transaction.isUserEvent('redo');
    });
  }

  private isValidRange(range: RewriteRange): boolean {
    return (
      Number.isInteger(range.from) &&
      Number.isInteger(range.to) &&
      range.from >= 0 &&
      range.to >= range.from &&
      range.to <= this.view.state.doc.length
    );
  }
}

function isDocumentPosition(position: number, documentLength: number): boolean {
  return Number.isInteger(position) && position >= 0 && position <= documentLength;
}

function changeIntersectsSpan(
  update: ViewUpdate,
  span: Pick<ProjectedSpan, 'start' | 'end'>,
): boolean {
  let intersects = false;

  update.changes.iterChangedRanges((fromA, toA) => {
    if (intersects) {
      return;
    }

    intersects = rangeIntersects(fromA, toA, span.start, span.end);
  });

  return intersects;
}

function rangeIntersects(
  changeFrom: number,
  changeTo: number,
  spanFrom: number,
  spanTo: number,
): boolean {
  if (changeFrom === changeTo) {
    return changeFrom > spanFrom && changeFrom < spanTo;
  }

  return changeFrom < spanTo && changeTo > spanFrom;
}

function cloneSpan(span: ProjectedSpan): ProjectedSpan {
  return { ...span };
}

function cloneCompanionSpan(span: CompanionSpan): CompanionSpan {
  return { ...span };
}

// Tokens are split on whitespace and sentence punctuation, but `_`, `-`, and
// `.` between alphanumerics are kept *inside* tokens. This preserves
// identifiers that benefit from prompt-conditioning: `whisper.cpp`,
// `set_initial_prompt`, `note-surface`, etc.
const GLOSSARY_TOKEN_PATTERN = /[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/gu;

// `Capitalized` words like `Bob` or `See` could be proper nouns OR ordinary
// English at a sentence boundary. We disambiguate by *position*: accept them
// only when not at a sentence start. "Bob arrived" mid-sentence is
// unambiguously a name; "Bob arrived." at sentence start is indistinguishable
// from any other capitalized opener.
function isGlossaryWorthy(token: string, noteText: string, offset: number): boolean {
  if (/^[A-Z]{2,}$/u.test(token)) {
    return true;
  }

  if (/^[A-Za-z]+$/u.test(token) && /[A-Z]/u.test(token.slice(1))) {
    return true;
  }

  // Whisper sometimes emits sentence-final punctuation without a trailing
  // space ("Operations.One of..."), and the dotted-identifier rule glues
  // the two sides into one token. Title.Title with no other distinguishing
  // signal (digits, multiple dots, underscores, hyphens) is far more likely
  // to be sentence-glue than an identifier in dictated note prose.
  if (/^[A-Z][a-z]+\.[A-Z][a-z]+$/u.test(token)) {
    return false;
  }

  if (/[._-]/u.test(token)) {
    return true;
  }

  if (/^[A-Z][a-z]+$/u.test(token)) {
    return !isAtSentenceStart(noteText, offset);
  }

  return false;
}

// A sentence start is document start or immediately following `.`, `!`, or
// `?` (skipping whitespace). Bare newlines are *not* sentence boundaries —
// list items and headings start on new lines without closing punctuation;
// otherwise every list-of-names note would lose every name.
function isAtSentenceStart(noteText: string, offset: number): boolean {
  let cursor = offset - 1;

  while (cursor >= 0 && /\s/u.test(noteText.charAt(cursor))) {
    cursor -= 1;
  }

  if (cursor < 0) {
    return true;
  }

  const previous = noteText.charAt(cursor);
  return previous === '.' || previous === '!' || previous === '?';
}

// Keep this prompt prefix in sync with `is_prompt_leak` in
// `native/src/stages/hallucination_filter.rs`.
// Build sentence-cased prompt prose from the note in a single pass, deduped
// case-insensitively (first-seen casing wins) and bounded by `maxChars`.
// Stops scanning at the first token that would overflow the budget, including
// the terminal period.
function buildGlossary(
  noteText: string,
  maxChars: number,
): { text: string; truncated: boolean } | null {
  const prefix = 'The notes mention ';

  if (prefix.length >= maxChars) {
    return null;
  }

  const seen = new Set<string>();
  let text = prefix;
  let appended = 0;
  let truncated = false;

  for (const match of noteText.matchAll(GLOSSARY_TOKEN_PATTERN)) {
    const token = match[0];
    const offset = match.index ?? 0;

    if (!isGlossaryWorthy(token, noteText, offset)) {
      continue;
    }

    const key = token.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const candidate = appended === 0 ? `${text}${token}` : `${text}, ${token}`;

    if (candidate.length + 1 > maxChars) {
      truncated = true;
      break;
    }

    text = candidate;
    appended += 1;
  }

  if (appended === 0) {
    return null;
  }

  return { text: `${text}.`, truncated };
}
