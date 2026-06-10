/**
 * Parallel AnalyserNode tap off the live mic source. Splits the FFT into 6
 * log-spaced speech bands and normalizes each band to its own slow-decaying
 * peak so visual response stays balanced regardless of speech spectral tilt.
 *
 * Pure: no DOM, no Obsidian APIs. Owned at the same layer as AudioCaptureStream.
 */

const BAND_COUNT = 6;
const FFT_SIZE = 512;
const BAND_EDGES_HZ: readonly number[] = [80, 200, 500, 1000, 2000, 4000, 8000];

/**
 * dB window. `MIN_DECIBELS` doubles as a noise gate: anything below it maps to
 * byte 0 before any per-band logic runs. Room tone sits around −55 to −65
 * dBFS, so −60 keeps idle bars at the floor. `MAX_DECIBELS = −30` widens the
 * byte range so typical speech reaches the upper half of [0, 255].
 */
const MIN_DECIBELS = -60;
const MAX_DECIBELS = -30;

/**
 * Per-band peak AGC: each band keeps a slow-decaying running max so its
 * normalized output fills [0, 1] regardless of absolute energy. Static gain
 * curves cannot follow per-speaker / per-phoneme variation; AGC solves
 * that structurally — high bands self-calibrate against their own recent
 * sibilant peaks instead of competing with vowels for headroom.
 *
 * `PEAK_DECAY_PER_FRAME = exp(-1/60)` ≈ 1 s time constant at 60 fps.
 * `PEAK_FLOOR` is the smallest the divisor may hit; prevents idle pumping
 * and means a new onset must clear the floor before normalizing.
 */
const PEAK_DECAY_PER_FRAME = Math.exp(-1 / 60);
const PEAK_FLOOR = 0.02;

/**
 * Visual ballistics applied to the normalized band level. Fast attack so
 * onsets register; moderate release (~8-12 frames to halve at 60fps,
 * ~140-200ms half-life) so bars glide down between syllables instead of
 * snapping. Irrational-ish spread on release keeps no two bars decaying
 * on the same frame.
 */
const BAND_ATTACK: readonly number[] = [0.95, 0.95, 0.95, 0.95, 0.99, 0.99];
const BAND_RELEASE: readonly number[] = [0.055, 0.075, 0.065, 0.085, 0.095, 0.065];

if (BAND_ATTACK.length !== BAND_COUNT || BAND_RELEASE.length !== BAND_COUNT) {
  throw new Error('Per-band attack/release arrays must each have BAND_COUNT entries.');
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
  private frequencyBuffer: ReturnType<typeof allocFrequencyBuffer> | null = null;
  private readonly smoothed: Float32Array = new Float32Array(BAND_COUNT);
  private readonly peaks: Float32Array = new Float32Array(BAND_COUNT);

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
    this.frequencyBuffer = allocFrequencyBuffer(analyser.frequencyBinCount);
    this.bandRanges = computeBandRanges(audioContext.sampleRate, analyser.frequencyBinCount);
    this.smoothed.fill(0);
    this.peaks.fill(PEAK_FLOOR);
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
    this.peaks.fill(PEAK_FLOOR);
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
      const raw = meanNormalized(buffer, range[0], range[1]);

      // Per-band peak AGC.
      const previousPeak = this.peaks[band] as number;
      const peak = Math.max(raw, previousPeak * PEAK_DECAY_PER_FRAME, PEAK_FLOOR);
      this.peaks[band] = peak;
      const normalized = Math.min(1, raw / peak);

      const previous = this.smoothed[band] as number;
      const coefficient =
        normalized > previous ? (BAND_ATTACK[band] as number) : (BAND_RELEASE[band] as number);
      this.smoothed[band] = previous + (normalized - previous) * coefficient;
    }

    return this.smoothed;
  }
}

/**
 * `frequencyBuffer` borrows this return type instead of being annotated
 * `Uint8Array<ArrayBuffer>` (required by `getByteFrequencyData`): generic
 * typed-array syntax needs TS >= 5.7, and the Obsidian code scanner lints
 * with an older TypeScript that would turn it into an unresolved type.
 */
function allocFrequencyBuffer(length: number) {
  return new Uint8Array(length);
}

function meanNormalized(buffer: Uint8Array, lo: number, hi: number): number {
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
