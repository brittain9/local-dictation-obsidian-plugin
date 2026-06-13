import { describe, expect, it } from 'vitest';

import { pickFirstExistingDir } from '../scripts/lib/pick-existing-dir.mjs';

describe('pickFirstExistingDir', () => {
  it('returns the first candidate that exists', () => {
    const exists = (p: string) => p === 'C:/cuda/bin/x64';
    expect(pickFirstExistingDir(['C:/cuda/bin/x64', 'C:/cuda/bin'], exists)).toBe(
      'C:/cuda/bin/x64',
    );
  });

  it('falls through to a later candidate when earlier ones are absent', () => {
    const exists = (p: string) => p === 'C:/cuda/bin';
    expect(pickFirstExistingDir(['C:/cuda/bin/x64', 'C:/cuda/bin'], exists)).toBe('C:/cuda/bin');
  });

  it('throws a descriptive error when no candidate exists', () => {
    expect(() => pickFirstExistingDir(['a', 'b'], () => false)).toThrow(/none of the candidate/i);
  });
});
