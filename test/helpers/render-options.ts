import { DEFAULT_SMART_PARAGRAPH_PAUSE_MS } from '../../src/settings/plugin-settings';
import type {
  TranscriptRenderOptions,
  TranscriptTimestampRenderOptions,
} from '../../src/transcript/renderer';

/** Session start used across renderer/note-surface/session tests so timestamp output is stable. */
export const DEFAULT_SESSION_START_MS = new Date(2026, 4, 16, 14, 32).getTime();

export const DEFAULT_SPARSE_INTERVAL_MS = 30_000;

/** Build a TranscriptTimestampRenderOptions with disabled-by-default sane defaults. */
export function timestamps(
  overrides: Partial<TranscriptTimestampRenderOptions> = {},
): TranscriptTimestampRenderOptions {
  return {
    clock: 'elapsed',
    density: 'sparse',
    enabled: false,
    header: true,
    sessionStartUnixMs: DEFAULT_SESSION_START_MS,
    sparseIntervalMs: DEFAULT_SPARSE_INTERVAL_MS,
    ...overrides,
  };
}

/** Build a TranscriptRenderOptions with timestamps disabled by default. */
export function renderOptions(
  overrides: Partial<TranscriptRenderOptions> = {},
): TranscriptRenderOptions {
  return {
    smartParagraphLineBreakPauseMs: DEFAULT_SMART_PARAGRAPH_PAUSE_MS,
    smartParagraphParagraphPauseMs: DEFAULT_SMART_PARAGRAPH_PAUSE_MS,
    timestamps: timestamps(),
    transcriptFormatting: 'space',
    ...overrides,
  };
}
