import { describe, expect, it } from 'vitest';

import { computeFirstPhrasePrefix } from '../src/editor/transcript-placement';

describe('computeFirstPhrasePrefix', () => {
  it('returns a newline for end_of_note when doc ends mid-line', () => {
    expect(computeFirstPhrasePrefix({ anchor: 'end_of_note', charBeforeAnchor: 'a' })).toBe('\n');
  });
});
