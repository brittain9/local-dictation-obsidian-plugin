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

  it('spans most of [0, 1] across a sweep — rejects constant-return mutants', () => {
    const noise = new ValueNoise1D(0xabcdef);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const v = noise.sample(i * 0.213);
      samples.push(v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // Real implementation produces spread ~0.997 and variance ~0.058 here.
    // A `return 0.5` mutant has spread 0 and variance 0; both bounds catch it.
    expect(max - min).toBeGreaterThan(0.7);
    const mean = samples.reduce((acc, v) => acc + v, 0) / samples.length;
    const variance = samples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / samples.length;
    expect(variance).toBeGreaterThan(0.04);
  });

  it('is continuous: a small time step makes a small output step (rejects step-function mutants)', () => {
    const noise = new ValueNoise1D(0xabcdef);
    const dt = 0.001;
    let maxDelta = 0;
    let prev = noise.sample(0);
    for (let i = 1; i < 5_000; i++) {
      const next = noise.sample(i * dt);
      maxDelta = Math.max(maxDelta, Math.abs(next - prev));
      prev = next;
    }
    // Smoothstep across the unit-time lattice means a 1ms step moves at most
    // ~derivative_max * dt. An uninterpolated `return hashAt(floor(t))` mutant
    // would step by up to 1 at every integer boundary.
    expect(maxDelta).toBeLessThan(0.01);
  });

  it('matches a canonical reference vector — pins the hash/smoothstep math', () => {
    // Captured once from the actual implementation (seed 7). If the lattice
    // hash, smoothstep weights, or finalizer constants change accidentally,
    // this vector pins the regression — the prior implementation-detail test
    // (sample(n) ≈ sample(n - 1e-9)) was vacuous against constant-return mutants.
    const noise = new ValueNoise1D(7);
    expect(noise.sample(0)).toBeCloseTo(0.09682743344456, 12);
    expect(noise.sample(0.5)).toBeCloseTo(0.22989642014727, 12);
    expect(noise.sample(1)).toBeCloseTo(0.36296540684998, 12);
    expect(noise.sample(2.7)).toBeCloseTo(0.284293478744104, 12);
    expect(noise.sample(10)).toBeCloseTo(0.584892128128558, 12);
    expect(noise.sample(137.25)).toBeCloseTo(0.732061173017428, 12);
  });
});
