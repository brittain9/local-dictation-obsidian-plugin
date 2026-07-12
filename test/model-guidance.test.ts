import { describe, expect, it } from 'vitest';

import { formatModelTagLabel } from '../src/models/model-guidance';

describe('formatModelTagLabel', () => {
  it('turns the catalog starter convention into an explicit recommendation', () => {
    expect(formatModelTagLabel('starter')).toBe('Recommended');
  });

  it('formats hardware abbreviations and readable fallback labels', () => {
    expect(formatModelTagLabel('cpu')).toBe('CPU');
    expect(formatModelTagLabel('gpu')).toBe('GPU');
    expect(formatModelTagLabel('balanced')).toBe('Balanced');
  });
});
