/**
 * Smooth 1D value noise. Hashes integer lattice points and smoothsteps between
 * them, producing a continuous deterministic curve in [0, 1] given a seed and
 * a real-valued time. No per-call allocations; pure function of (seed, time).
 *
 * Used by the ribbon visualizer to drift idle bars when audio is at the floor,
 * so the icon never freezes between syllables. Each bar gets its own seeded
 * instance + per-bar rate/phase so the cluster doesn't beat in lockstep.
 */
export class ValueNoise1D {
  constructor(private readonly seed: number) {}

  /** Sample the noise at `time`. Output in [0, 1]. */
  sample(time: number): number {
    const t0 = Math.floor(time);
    const t1 = t0 + 1;
    const frac = time - t0;
    const a = this.hashAt(t0);
    const b = this.hashAt(t1);
    // smoothstep (3x² − 2x³) — C¹-continuous, cheap, no sin/cos needed.
    const u = frac * frac * (3 - 2 * frac);
    return a + (b - a) * u;
  }

  /** xmxmx finalizer (Murmur-style) over (seed ^ t), mapped to [0, 1). */
  private hashAt(t: number): number {
    let h = (this.seed ^ t) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 0x1_0000_0000;
  }
}
