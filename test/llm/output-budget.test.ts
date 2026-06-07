import { describe, expect, it } from 'vitest';

import {
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  outputTokenBudget,
} from '../../src/llm/output-budget';

describe('outputTokenBudget', () => {
  it('returns the floor for short inputs so an "expand this" command is not clipped', () => {
    expect(outputTokenBudget(0)).toBe(MIN_OUTPUT_TOKENS);
    expect(outputTokenBudget(40)).toBe(MIN_OUTPUT_TOKENS);
  });

  it('scales above the floor with input so a long transcript is not truncated', () => {
    // 40k chars ≈ 10k input tokens → 1.5× headroom ≈ 15k, above the floor.
    expect(outputTokenBudget(40_000)).toBe(15_000);
  });

  it('clamps to the ceiling for very large inputs', () => {
    expect(outputTokenBudget(1_000_000)).toBe(MAX_OUTPUT_TOKENS);
  });
});
