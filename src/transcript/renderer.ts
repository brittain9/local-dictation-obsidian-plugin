import type { UtteranceId } from '../session/session-journal';
import type {
  TimestampClock,
  TimestampDensity,
  TranscriptFormattingMode,
} from '../settings/plugin-settings';

export const SMART_PARAGRAPH_PAUSE_MS = 3000;

export interface TranscriptRenderOptions {
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
  readonly text: string;
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
  readonly emittedTimestamp: EmittedTimestamp | null;
  readonly insertedText: string;
  readonly projectedText: string;
  readonly replacementPrefix: string;
  readonly textEndOffset: number;
  readonly textStartOffset: number;
}

export class TranscriptRenderer {
  private hasRenderedText = false;
  private lastTimestampMsInSession: number | null = null;

  constructor(private readonly options: TranscriptRenderOptions) {}

  planAppend(
    input: TranscriptAppendInput,
    context: TranscriptRenderContext,
  ): TranscriptInsertProjection {
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
    const prefix = `${boundary}${sessionHeader}${timestampPrefix}`;
    const textStartOffset = prefix.length;
    const projectedText = `${prefix}${input.text}`;

    return {
      emittedTimestamp,
      insertedText: input.text,
      projectedText,
      replacementPrefix: boundary,
      textEndOffset: textStartOffset + input.text.length,
      textStartOffset,
    };
  }

  commitAppend(projection: TranscriptInsertProjection): void {
    this.hasRenderedText = true;

    if (projection.emittedTimestamp !== null) {
      this.lastTimestampMsInSession = projection.emittedTimestamp.elapsedMs;
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

    return isMeaningfulPause(pauseMsBeforeUtterance) ? 'new_paragraph' : 'space';
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
      isMeaningfulPause(input.pauseMsBeforeUtterance) ||
      input.utteranceStartMsInSession - this.lastTimestampMsInSession >=
        this.options.timestamps.sparseIntervalMs
    );
  }

  private shouldEmitSessionHeader(): boolean {
    return (
      !this.hasRenderedText && this.options.timestamps.enabled && this.options.timestamps.header
    );
  }
}

export function isMeaningfulPause(pauseMsBeforeUtterance: number | null): boolean {
  return pauseMsBeforeUtterance !== null && pauseMsBeforeUtterance >= SMART_PARAGRAPH_PAUSE_MS;
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
