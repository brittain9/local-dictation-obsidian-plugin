/**
 * Parallel AnalyserNode tap off the live mic source. Splits the FFT into 6
 * log-spaced speech bands and applies asymmetric attack/release smoothing so
 * the UI behaves like a VU meter (snappy onset, graceful decay).
 *
 * Pure: no DOM, no Obsidian APIs. Owned at the same layer as AudioCaptureStream.
 */

const BAND_COUNT = 6;
const FFT_SIZE = 512;
const BAND_EDGES_HZ: readonly number[] = [80, 200, 500, 1000, 2000, 4000, 8000];

/**
 * dB window calibrated for normal-speech levels post-AGC. Voice rarely hits
 * −10 dBFS, so the previous (−85, −10) window left the top ~15 dB of byte
 * range dead. (−85, −25) matches audioMotion.dev's production default and
 * stretches typical conversation across the full 0–255 output.
 */
const MIN_DECIBELS = -85;
const MAX_DECIBELS = -25;

/**
 * Per-band pre-emphasis to counter the −6 dB/octave net far-field spectral
 * tilt of speech (Flanagan via PMC4818273). Mean-bin aggregation averages
 * broadband sibilant noise ~3 dB below peak-bin, so the curve is a hair
 * hotter than pure tilt compensation. /s/ (3.8–8.5 kHz) and /ʃ/ (2.3–7 kHz)
 * land in bands 5–6, which get the most lift. This curve is engineering
 * judgment, not a published spec value — expect to iterate.
 */
const BAND_GAIN_DB: readonly number[] = [0, 0, 2, 5, 8, 11];
const BAND_GAIN_LINEAR: readonly number[] = BAND_GAIN_DB.map((db) => 10 ** (db / 20));
/**
 * Per-band normalization for the tanh soft saturator below: `tanh(gain)` is
 * the saturator's output at mean = 1 (a fully-driven band), so dividing by it
 * keeps the calibrated ceiling at 1.0 regardless of per-band pre-emphasis.
 * Without this, low-gain bands would top out at tanh(1) ≈ 0.76 and never
 * appear "fully lit" even at maxDecibels.
 */
const BAND_TANH_NORM: readonly number[] = BAND_GAIN_LINEAR.map((gain) => Math.tanh(gain));

/**
 * `getByteFrequencyData` already maps dB linearly into [0, 255], so the byte
 * is already log-amplitude. A second `Math.sqrt` on top is double-compression.
 * Stevens' loudness law sits near 0.6; 0.7 is a soft middle that keeps moderate
 * sounds visible without over-flattening peaks. If mid-range vowels look weak,
 * drop to 0.6 (closer to Stevens) or remove the curve entirely.
 */
const PERCEPTUAL_EXPONENT = 0.7;

/**
 * PPM-style asymmetric smoothing, per band.
 *
 * ATTACK 0.99 on bands 5–6 only — sibilants are 30–100 ms bursts and the prior
 * 0.95 took ~48 ms (3 frames @ 60 fps) to settle, clipping short fricatives.
 *
 * RELEASE has irrational spread around the prior 0.06 so no two bars share a
 * coefficient. Audio-driven decays no longer collapse on the same frame.
 */
const BAND_ATTACK: readonly number[] = [0.95, 0.95, 0.95, 0.95, 0.99, 0.99];
const BAND_RELEASE: readonly number[] = [0.053, 0.061, 0.057, 0.067, 0.071, 0.059];

if (
  BAND_GAIN_DB.length !== BAND_COUNT ||
  BAND_ATTACK.length !== BAND_COUNT ||
  BAND_RELEASE.length !== BAND_COUNT
) {
  throw new Error('Per-band gain/attack/release arrays must each have BAND_COUNT entries.');
}

export interface AudioBandReader {
  /** Returns smoothed band levels in [0, 1], length {@link BAND_COUNT}, or null when detached. */
  readBands(): Readonly<Float32Array> | null;
}

export interface AudioVisualizerAttachable {
  attach(audioContext: AudioContext, sourceNode: AudioNode): void;
  detach(): void;
}

type BandRange = readonly [number, number];

export class AudioVisualizerTap implements AudioBandReader, AudioVisualizerAttachable {
  static readonly BAND_COUNT = BAND_COUNT;

  private analyser: AnalyserNode | null = null;
  private bandRanges: readonly BandRange[] = [];
  private frequencyBuffer: Uint8Array<ArrayBuffer> | null = null;
  private readonly smoothed: Float32Array = new Float32Array(BAND_COUNT);

  attach(audioContext: AudioContext, sourceNode: AudioNode): void {
    if (this.analyser !== null) {
      throw new Error('AudioVisualizerTap is already attached.');
    }

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = MIN_DECIBELS;
    analyser.maxDecibels = MAX_DECIBELS;
    sourceNode.connect(analyser);

    this.analyser = analyser;
    this.frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);
    this.bandRanges = computeBandRanges(audioContext.sampleRate, analyser.frequencyBinCount);
    this.smoothed.fill(0);
  }

  detach(): void {
    if (this.analyser === null) {
      return;
    }
    try {
      this.analyser.disconnect();
    } catch {
      // Already disconnected — safe to ignore.
    }
    this.analyser = null;
    this.frequencyBuffer = null;
    this.bandRanges = [];
    this.smoothed.fill(0);
  }

  readBands(): Readonly<Float32Array> | null {
    const analyser = this.analyser;
    const buffer = this.frequencyBuffer;
    if (analyser === null || buffer === null) {
      return null;
    }

    analyser.getByteFrequencyData(buffer);

    for (let band = 0; band < BAND_COUNT; band++) {
      const range = this.bandRanges[band] as BandRange;
      const mean = meanNormalized(buffer, range[0], range[1]);
      // Soft saturator via tanh: a hard Math.min(1, mean*gain) caused gained
      // bands to saturate at mean ≥ 1/gain (byte ~72 in band 5), making soft
      // /s/ and loud /s/ indistinguishable. tanh stays linear-ish below the
      // knee, then asymptotes — soft and loud sibilants now produce
      // distinguishable peaks. Dividing by tanh(gain) keeps the ceiling at 1.0.
      const gained = mean * (BAND_GAIN_LINEAR[band] as number);
      const lifted = Math.tanh(gained) / (BAND_TANH_NORM[band] as number);
      const raw = lifted ** PERCEPTUAL_EXPONENT;
      const previous = this.smoothed[band] as number;
      const coefficient =
        raw > previous ? (BAND_ATTACK[band] as number) : (BAND_RELEASE[band] as number);
      this.smoothed[band] = previous + (raw - previous) * coefficient;
    }

    return this.smoothed;
  }
}

function meanNormalized(buffer: Uint8Array<ArrayBuffer>, lo: number, hi: number): number {
  if (hi <= lo) {
    return 0;
  }
  let sum = 0;
  for (let i = lo; i < hi; i++) {
    sum += buffer[i] as number;
  }
  return sum / (hi - lo) / 255;
}

function computeBandRanges(sampleRate: number, binCount: number): readonly BandRange[] {
  const hzPerBin = sampleRate / 2 / binCount;
  const ranges: BandRange[] = [];
  for (let band = 0; band < BAND_COUNT; band++) {
    const loHz = BAND_EDGES_HZ[band] as number;
    const hiHz = BAND_EDGES_HZ[band + 1] as number;
    const loBin = Math.max(1, Math.floor(loHz / hzPerBin));
    const hiBin = Math.min(binCount, Math.max(loBin + 1, Math.floor(hiHz / hzPerBin)));
    ranges.push([loBin, hiBin] as const);
  }
  return ranges;
}
