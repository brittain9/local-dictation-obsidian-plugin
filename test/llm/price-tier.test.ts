import { describe, expect, it } from 'vitest';

import { priceTier } from '../../src/ui/llm-provider-ui';

describe('priceTier', () => {
  it('returns null when pricing is unknown', () => {
    expect(priceTier(undefined)).toBeNull();
  });

  it('returns free only when both rates are zero', () => {
    expect(priceTier({ input: 0, output: 0 })).toBe('free');
    // A zero input but paid output is not free.
    expect(priceTier({ input: 0, output: 4 })).toBe('$');
  });

  it('buckets representative models by the 3:1 input:output blend', () => {
    expect(priceTier({ input: 0.15, output: 0.6 })).toBe('$'); // GPT-4o mini, ~0.26
    expect(priceTier({ input: 3, output: 15 })).toBe('$$'); // Claude Sonnet, 6
    expect(priceTier({ input: 15, output: 75 })).toBe('$$$'); // Claude Opus, 30
    expect(priceTier({ input: 25, output: 125 })).toBe('$$$$'); // GPT-5.5 Pro class, 50
  });

  it('treats each threshold as an inclusive upper bound', () => {
    expect(priceTier({ input: 0, output: 4 })).toBe('$'); // blended 1
    expect(priceTier({ input: 0, output: 60 })).toBe('$$'); // blended 15
    expect(priceTier({ input: 0, output: 160 })).toBe('$$$'); // blended 40
    expect(priceTier({ input: 0, output: 164 })).toBe('$$$$'); // blended 41
  });
});
