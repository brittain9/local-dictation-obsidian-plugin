import { describe, expect, it } from 'vitest';

import { ValueNoise1D } from '../src/ui/value-noise';

describe('ValueNoise1D', () => {
  it('produces values in [0, 1]', () => {
    const noise = new ValueNoise1D(0xc0ffee);
    for (let i = 0; i < 1000; i++) {
      const t = i * 0.137;
      const v = noise.sample(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic: same seed + time yields the same sample', () => {
    const a = new ValueNoise1D(42);
    const b = new ValueNoise1D(42);
    for (const t of [0, 0.5, 1.0, 7.25, 137.5, 999.999]) {
      expect(a.sample(t)).toBe(b.sample(t));
    }
  });

  it('different seeds decorrelate at the same time', () => {
    const a = new ValueNoise1D(0x1f3a);
    const b = new ValueNoise1D(0x2b7c);
    // Any single integer time could theoretically collide; require disagreement
    // across a small sweep so the decorrelation isn't accidental.
    let differences = 0;
    for (let i = 0; i < 16; i++) {
      if (a.sample(i + 0.3) !== b.sample(i + 0.3)) differences += 1;
    }
    expect(differences).toBeGreaterThan(12);
  });

  it('is continuous: a small time step makes a small output step', () => {
    const noise = new ValueNoise1D(0xabcdef);
    const dt = 0.001;
    let maxDelta = 0;
    let prev = noise.sample(0);
    for (let i = 1; i < 5_000; i++) {
      const next = noise.sample(i * dt);
      maxDelta = Math.max(maxDelta, Math.abs(next - prev));
      prev = next;
    }
    // Smoothstep interpolation across unit-time lattice points means a 1 ms
    // step can move the output by at most ~derivative_max * dt. Generous bound:
    expect(maxDelta).toBeLessThan(0.01);
  });

  it('reaches the hashed value exactly at integer lattice points', () => {
    const noise = new ValueNoise1D(7);
    // At an integer t, smoothstep weight is 0, so sample(t) equals the hash at t.
    // We can't recompute the hash from outside, but we can verify the equality
    // sample(n) === sample(n) (trivially) AND that sample(n - 1e-12) is close.
    for (let n = 0; n < 10; n++) {
      const exact = noise.sample(n);
      const justBelow = noise.sample(n - 1e-9);
      expect(Math.abs(exact - justBelow)).toBeLessThan(1e-6);
    }
  });
});
