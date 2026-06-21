import { describe, expect, it } from 'vitest';

import { pickFirstExistingDir } from '../scripts/lib/pick-existing-dir.mjs';

describe('pickFirstExistingDir', () => {
  it.each([
    { label: 'returns the first candidate when it exists', present: 'C:/cuda/bin/x64' },
    { label: 'skips an absent earlier candidate', present: 'C:/cuda/bin' },
  ])('$label', ({ present }) => {
    const exists = (p: string) => p === present;
    expect(pickFirstExistingDir(['C:/cuda/bin/x64', 'C:/cuda/bin'], exists)).toBe(present);
  });

  it('throws a descriptive error when no candidate exists', () => {
    expect(() => pickFirstExistingDir(['a', 'b'], () => false)).toThrow(/none of the candidate/i);
  });
});
