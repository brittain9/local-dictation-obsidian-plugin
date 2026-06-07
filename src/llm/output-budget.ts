// A transform's output is roughly proportional to the text it rewrites, so the
// output-token cap is sized to the input instead of a fixed limit that truncates
// long transcripts. The floor keeps a short "expand this into a paragraph"
// command from being clipped; the ceiling guards against runaway cost. Both
// providers clamp this down to the model's real maximum, so the ceiling is only
// our own spend guard, not a correctness bound.
const CHARS_PER_TOKEN = 4;
const OUTPUT_HEADROOM = 1.5;

export const MIN_OUTPUT_TOKENS = 4_096;
export const MAX_OUTPUT_TOKENS = 32_768;

export function outputTokenBudget(inputChars: number): number {
  const inputTokens = Math.ceil(Math.max(0, inputChars) / CHARS_PER_TOKEN);
  const scaled = Math.ceil(inputTokens * OUTPUT_HEADROOM);
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, scaled));
}
