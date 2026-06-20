import type { AudioLevelEvent } from '../sidecar/protocol';
import type { AudioBandReader } from './audio-visualizer-tap';
import { AudioVisualizerTap } from './audio-visualizer-tap';

const BAND_COUNT = AudioVisualizerTap.BAND_COUNT;
const STALE_AFTER_MS = 250;

/**
 * Per-band peak AGC + ballistics, mirroring {@link AudioVisualizerTap}. The
 * sidecar now emits dB-companded spectral bands (it owns the mixed mic+system
 * stream the renderer can't see); this meter supplies the visual feel the old
 * client-side tap used to: each band self-calibrates against its own recent
 * peak so bars fill [0, 1] regardless of absolute loudness, with fast attack
 * and per-band release so onsets snap and tails glide.
 *
 * Ballistics run per {@link readBands} call (the ribbon's ~60 fps render loop),
 * so `PEAK_DECAY_PER_FRAME`'s ~1 s time constant matches that cadence.
 */
const PEAK_DECAY_PER_FRAME = Math.exp(-1 / 60);
const PEAK_FLOOR = 0.02;
const BAND_ATTACK: readonly number[] = [0.95, 0.95, 0.95, 0.95, 0.99, 0.99];
const BAND_RELEASE: readonly number[] = [0.055, 0.075, 0.065, 0.085, 0.095, 0.065];

if (BAND_ATTACK.length !== BAND_COUNT || BAND_RELEASE.length !== BAND_COUNT) {
  throw new Error('Per-band attack/release arrays must each have BAND_COUNT entries.');
}

export class SidecarAudioLevelMeter implements AudioBandReader {
  private activeSessionId: string | null = null;
  private lastUpdateMs = 0;
  private readonly smoothed = new Float32Array(BAND_COUNT);
  private readonly target = new Float32Array(BAND_COUNT);
  private readonly peaks = new Float32Array(BAND_COUNT);

  constructor(private readonly now: () => number = () => Date.now()) {}

  bindSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    this.lastUpdateMs = this.now();
    this.reset();
  }

  clearSession(sessionId: string): void {
    if (this.activeSessionId !== sessionId) {
      return;
    }
    this.activeSessionId = null;
    this.lastUpdateMs = 0;
    this.reset();
  }

  update(event: AudioLevelEvent): void {
    if (event.sessionId !== this.activeSessionId) {
      return;
    }

    this.lastUpdateMs = this.now();
    for (let i = 0; i < BAND_COUNT; i++) {
      this.target[i] = clamp01(event.bands[i] ?? 0);
    }
  }

  readBands(): Readonly<Float32Array> | null {
    if (this.activeSessionId === null) {
      return null;
    }

    const stale = this.now() - this.lastUpdateMs > STALE_AFTER_MS;
    for (let i = 0; i < BAND_COUNT; i++) {
      const raw = stale ? 0 : (this.target[i] as number);

      // Per-band peak AGC: divide by a slow-decaying running max so quiet but
      // steady speech still fills the bar, while a hard floor gates room tone.
      const peak = Math.max(raw, (this.peaks[i] as number) * PEAK_DECAY_PER_FRAME, PEAK_FLOOR);
      this.peaks[i] = peak;
      const normalized = Math.min(1, raw / peak);

      const previous = this.smoothed[i] as number;
      const coefficient =
        normalized > previous ? (BAND_ATTACK[i] as number) : (BAND_RELEASE[i] as number);
      this.smoothed[i] = previous + (normalized - previous) * coefficient;
    }

    return this.smoothed;
  }

  private reset(): void {
    this.smoothed.fill(0);
    this.target.fill(0);
    this.peaks.fill(PEAK_FLOOR);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
