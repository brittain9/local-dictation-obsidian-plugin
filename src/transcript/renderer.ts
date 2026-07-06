import type { TranscriptSegment, TranscriptSpan, UtteranceId } from '../session/session-journal';
import type {
  SmartParagraphPauseSettings,
  TimestampClock,
  TimestampDensity,
  TranscriptFormattingMode,
} from '../settings/plugin-settings';
import {
  DEFAULT_SMART_PARAGRAPH_PAUSE_MS,
  normalizeSmartParagraphPauseSettings,
} from '../settings/plugin-settings';

export const SMART_PARAGRAPH_PAUSE_MS = DEFAULT_SMART_PARAGRAPH_PAUSE_MS;

export interface TranscriptRenderOptions {
  readonly smartParagraphLineBreakPauseMs?: number;
  readonly smartParagraphParagraphPauseMs?: number;
  readonly timestamps: TranscriptTimestampRenderOptions;
  readonly transcriptFormatting: TranscriptFormattingMode;
}

export interface TranscriptTimestampRenderOptions {
  readonly clock: TimestampClock;
  readonly density: TimestampDensity;
  readonly enabled: boolean;
  readonly header: boolean;
  readonly sessionStartUnixMs: number;
  readonly sparseIntervalMs: number;
}

export interface TranscriptAppendInput {
  readonly pauseMsBeforeUtterance: number | null;
  /** Speaker spans to render, in order. One span renders exactly as the old
   * single-speaker path (label in the prefix, replaceable text body); several
   * spans render as a labelled, newline-separated exchange. */
  readonly spans: readonly TranscriptSpan[];
  readonly utteranceId: UtteranceId;
  readonly utteranceStartMsInSession: number;
}

export interface TranscriptRenderContext {
  readonly tailContent: string;
}

export interface EmittedTimestamp {
  readonly elapsedMs: number;
  readonly text: string;
}

export interface TranscriptInsertProjection {
  readonly emittedSpeakerIndex: number | null;
  readonly emittedTimestamp: EmittedTimestamp | null;
  readonly insertedText: string;
  /** The last speaker rendered before this utterance, so a later in-place
   * re-render of a multi-speaker block reproduces the same label suppression. */
  readonly precedingSpeakerIndex: number | null;
  readonly projectedText: string;
  readonly replacementPrefix: string;
  readonly textEndOffset: number;
  readonly textStartOffset: number;
}

export class TranscriptRenderer {
  private hasRenderedText = false;
  private lastRenderedSpeakerIndex: number | null = null;
  private lastTimestampMsInSession: number | null = null;
  private readonly smartParagraphPauses: SmartParagraphPauseSettings;

  constructor(private readonly options: TranscriptRenderOptions) {
    this.smartParagraphPauses = normalizeSmartParagraphPauseSettings({
      lineBreakPauseMs: options.smartParagraphLineBreakPauseMs,
      paragraphPauseMs: options.smartParagraphParagraphPauseMs,
    });
  }

  planAppend(
    input: TranscriptAppendInput,
    context: TranscriptRenderContext,
  ): TranscriptInsertProjection {
    const spans = input.spans.length > 0 ? input.spans : [{ speakerIndex: null, text: '' }];
    const boundary = this.formatBoundary(input, context);
    const sessionHeader = this.shouldEmitSessionHeader()
      ? `${formatSessionHeader(this.options.timestamps.sessionStartUnixMs)}\n`
      : '';
    const emittedTimestamp = this.shouldEmitTimestamp(input)
      ? {
          elapsedMs: input.utteranceStartMsInSession,
          text: formatLandmark(
            input.utteranceStartMsInSession,
            this.options.timestamps.sessionStartUnixMs,
            this.options.timestamps.clock,
          ),
        }
      : null;
    const timestampPrefix = emittedTimestamp === null ? '' : `${emittedTimestamp.text} `;
    const precedingSpeakerIndex = this.lastRenderedSpeakerIndex;

    // Single span keeps the legacy layout exactly: the speaker label lives in the
    // prefix and the body is just the (replaceable) text, so an in-place LLM
    // replace swaps the words without disturbing the label.
    if (spans.length === 1) {
      const span = spans[0] ?? { speakerIndex: null, text: '' };
      const speakerIndex = normalizeSpeakerIndex(span.speakerIndex);
      const speakerPrefix = this.shouldEmitSpeakerLabel(speakerIndex)
        ? `${formatSpeakerLabel(speakerIndex)} `
        : '';
      const prefix = `${boundary}${sessionHeader}${timestampPrefix}${speakerPrefix}`;
      const textStartOffset = prefix.length;

      return {
        emittedSpeakerIndex: speakerIndex,
        emittedTimestamp,
        insertedText: span.text,
        precedingSpeakerIndex,
        projectedText: `${prefix}${span.text}`,
        replacementPrefix: boundary,
        textEndOffset: textStartOffset + span.text.length,
        textStartOffset,
      };
    }

    // Multiple speakers in one utterance: a labelled, newline-separated exchange.
    const composed = composeSpeakerSpans(spans, precedingSpeakerIndex);
    const prefix = `${boundary}${sessionHeader}${timestampPrefix}`;
    const textStartOffset = prefix.length;

    return {
      emittedSpeakerIndex: composed.trailingSpeakerIndex,
      emittedTimestamp,
      insertedText: composed.body,
      precedingSpeakerIndex,
      projectedText: `${prefix}${composed.body}`,
      replacementPrefix: boundary,
      textEndOffset: textStartOffset + composed.body.length,
      textStartOffset,
    };
  }

  // Recompose a multi-speaker body for an in-place replace, reusing the speaker
  // context captured when the block was first rendered.
  composeReplacementBody(
    spans: readonly TranscriptSpan[],
    precedingSpeakerIndex: number | null,
  ): string {
    return composeSpeakerSpans(spans, precedingSpeakerIndex).body;
  }

  commitAppend(projection: TranscriptInsertProjection): void {
    this.hasRenderedText = true;

    if (projection.emittedTimestamp !== null) {
      this.lastTimestampMsInSession = projection.emittedTimestamp.elapsedMs;
    }

    // An unassigned utterance (null) carries no speaker, so it neither relabels
    // nor resets the running speaker — a later same-speaker utterance stays
    // suppressed across the gap.
    const speakerIndex = normalizeSpeakerIndex(projection.emittedSpeakerIndex);
    if (speakerIndex !== null) {
      this.lastRenderedSpeakerIndex = speakerIndex;
    }
  }

  private formatBoundary(input: TranscriptAppendInput, context: TranscriptRenderContext): string {
    if (!this.hasRenderedText) {
      return spaceIfTailAbutsText(context.tailContent);
    }

    switch (this.resolveFormattingMode(input.pauseMsBeforeUtterance)) {
      case 'space':
        return spaceIfTailAbutsText(context.tailContent);
      case 'new_line':
        return missingNewlines(context.tailContent, 1);
      case 'new_paragraph':
        return missingNewlines(context.tailContent, 2);
    }
  }

  private resolveFormattingMode(
    pauseMsBeforeUtterance: number | null,
  ): Exclude<TranscriptFormattingMode, 'smart'> {
    if (this.options.transcriptFormatting !== 'smart') {
      return this.options.transcriptFormatting;
    }

    if (
      pauseMsBeforeUtterance === null ||
      pauseMsBeforeUtterance < this.smartParagraphPauses.lineBreakPauseMs
    ) {
      return 'space';
    }

    if (pauseMsBeforeUtterance < this.smartParagraphPauses.paragraphPauseMs) {
      return 'new_line';
    }

    return 'new_paragraph';
  }

  private shouldEmitTimestamp(input: TranscriptAppendInput): boolean {
    if (!this.options.timestamps.enabled) {
      return false;
    }

    if (this.options.timestamps.density === 'every_utterance') {
      return true;
    }

    if (this.lastTimestampMsInSession === null) {
      return true;
    }

    return (
      input.utteranceStartMsInSession - this.lastTimestampMsInSession >=
      this.options.timestamps.sparseIntervalMs
    );
  }

  private shouldEmitSessionHeader(): boolean {
    return (
      !this.hasRenderedText && this.options.timestamps.enabled && this.options.timestamps.header
    );
  }

  // Label only on speaker change: the first assigned speaker is always labeled,
  // then a label appears only when the speaker differs from the last one
  // rendered. Unassigned utterances (null) never carry a label.
  private shouldEmitSpeakerLabel(speakerIndex: number | null): speakerIndex is number {
    return speakerIndex !== null && speakerIndex !== this.lastRenderedSpeakerIndex;
  }
}

export function isMeaningfulPause(
  pauseMsBeforeUtterance: number | null,
  paragraphPauseMs = SMART_PARAGRAPH_PAUSE_MS,
): boolean {
  return pauseMsBeforeUtterance !== null && pauseMsBeforeUtterance >= paragraphPauseMs;
}

export function formatLandmark(
  elapsedMs: number,
  sessionStartUnixMs: number,
  clock: TimestampClock,
): string {
  if (clock === 'wallclock') {
    const date = new Date(sessionStartUnixMs + elapsedMs);
    return `(${padTwo(date.getHours())}:${padTwo(date.getMinutes())})`;
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `(${hours}:${padTwo(minutes)}:${padTwo(seconds)})`;
  }

  return `(${totalMinutes}:${padTwo(seconds)})`;
}

export function formatSessionHeader(sessionStartUnixMs: number): string {
  const date = new Date(sessionStartUnixMs);

  return `[${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())} ${padTwo(
    date.getHours(),
  )}:${padTwo(date.getMinutes())}]`;
}

// Speaker indices are 0-based on the wire; the rendered label is 1-based.
export function formatSpeakerLabel(speakerIndex: number): string {
  return `**Speaker ${speakerIndex + 1}:**`;
}

// Group an utterance's segments into renderable speaker spans. With zero or one
// distinct speaker the whole utterance is one span carrying `fallbackText` (which
// may be LLM-cleaned), so single-speaker output is unchanged. With several
// speakers, consecutive same-speaker segments merge into a span carrying the
// engine segment text, so a multi-speaker utterance reads as a labelled exchange.
export function buildSpeakerSpans(
  segments: readonly TranscriptSegment[],
  fallbackText: string,
  fallbackSpeakerIndex: number | null,
): TranscriptSpan[] {
  const distinct = new Set<number>();
  for (const segment of segments) {
    const speakerIndex = normalizeSpeakerIndex(segment.speaker);
    if (speakerIndex !== null) {
      distinct.add(speakerIndex);
    }
  }

  if (distinct.size <= 1) {
    const [only] = [...distinct];
    const speakerIndex = only !== undefined ? only : normalizeSpeakerIndex(fallbackSpeakerIndex);
    return [{ speakerIndex, text: fallbackText }];
  }

  const spans: TranscriptSpan[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (text.length === 0) {
      continue;
    }
    const speakerIndex = normalizeSpeakerIndex(segment.speaker);
    const last = spans.at(-1);
    if (last !== undefined && last.speakerIndex === speakerIndex) {
      last.text = `${last.text} ${text}`;
    } else {
      spans.push({ speakerIndex, text });
    }
  }

  return spans.length > 0
    ? spans
    : [{ speakerIndex: normalizeSpeakerIndex(fallbackSpeakerIndex), text: fallbackText }];
}

// Compose speaker spans into one rendered body: a `**Speaker N:**` label whenever
// the speaker differs from the previously rendered one (across spans and across
// utterances), spans separated by newlines. Returns the trailing speaker so the
// caller can advance its running label state.
function composeSpeakerSpans(
  spans: readonly TranscriptSpan[],
  precedingSpeakerIndex: number | null,
): { body: string; trailingSpeakerIndex: number | null } {
  let last = precedingSpeakerIndex;
  const parts: string[] = [];
  for (const span of spans) {
    const speakerIndex = normalizeSpeakerIndex(span.speakerIndex);
    const label =
      speakerIndex !== null && speakerIndex !== last ? `${formatSpeakerLabel(speakerIndex)} ` : '';
    parts.push(`${label}${span.text}`);
    if (speakerIndex !== null) {
      last = speakerIndex;
    }
  }
  return { body: parts.join('\n'), trailingSpeakerIndex: last };
}

function normalizeSpeakerIndex(speakerIndex: number | null | undefined): number | null {
  return typeof speakerIndex === 'number' && Number.isInteger(speakerIndex) && speakerIndex >= 0
    ? speakerIndex
    : null;
}

function padTwo(value: number): string {
  return value.toString().padStart(2, '0');
}

function spaceIfTailAbutsText(tailContent: string): string {
  if (tailContent.length === 0 || /\s$/u.test(tailContent)) {
    return '';
  }

  return ' ';
}

function missingNewlines(tailContent: string, requiredTrailingNewlines: number): string {
  const existingTrailingNewlines = trailingNewlineCount(tailContent);
  const missing = Math.max(0, requiredTrailingNewlines - existingTrailingNewlines);

  return '\n'.repeat(missing);
}

function trailingNewlineCount(value: string): number {
  let count = 0;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value.charAt(index) !== '\n') {
      break;
    }
    count += 1;
  }

  return count;
}
