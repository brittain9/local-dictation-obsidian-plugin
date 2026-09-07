import { describe, expect, it } from 'vitest';

import { formatModelTagLabel, isRuntimeDerivedModelTag } from '../src/models/model-guidance';

describe('formatModelTagLabel', () => {
  it('formats hardware abbreviations and readable fallback labels', () => {
    expect(formatModelTagLabel('cpu')).toBe('CPU');
    expect(formatModelTagLabel('cpu-fallback')).toBe('CPU fallback');
    expect(formatModelTagLabel('cuda')).toBe('CUDA');
    expect(formatModelTagLabel('full-precision')).toBe('Full precision');
    expect(formatModelTagLabel('gpu')).toBe('GPU capable');
    expect(formatModelTagLabel('metal')).toBe('Metal');
    expect(formatModelTagLabel('vulkan')).toBe('Vulkan');
    expect(formatModelTagLabel('reduced-size')).toBe('Reduced size');
    expect(formatModelTagLabel('balanced')).toBe('Balanced');
    expect(formatModelTagLabel('requires-terms-review')).toBe('Terms apply');
    expect(formatModelTagLabel('read-aloud')).toBe('Read aloud');
  });

  it('identifies stale catalog tags that must come from detected runtime capabilities', () => {
    expect(
      ['cpu', 'cpu-fallback', 'cuda', 'gpu', 'metal', 'streaming', 'vulkan'].every(
        isRuntimeDerivedModelTag,
      ),
    ).toBe(true);
    expect(isRuntimeDerivedModelTag('accuracy')).toBe(false);
  });
});
