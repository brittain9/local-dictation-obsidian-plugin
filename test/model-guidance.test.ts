import { describe, expect, it } from 'vitest';

import { formatModelTagLabel } from '../src/models/model-guidance';

describe('formatModelTagLabel', () => {
  it('formats hardware abbreviations and readable fallback labels', () => {
    expect(formatModelTagLabel('cpu')).toBe('CPU');
    expect(formatModelTagLabel('full-precision')).toBe('Full precision');
    expect(formatModelTagLabel('gpu')).toBe('GPU');
    expect(formatModelTagLabel('reduced-size')).toBe('Reduced size');
    expect(formatModelTagLabel('balanced')).toBe('Balanced');
  });
});
