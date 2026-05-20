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
const ATTACK = 0.6;
const RELEASE = 0.15;

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
    sourceNode.connect(analyser);

    this.analyser = analyser;
    this.frequencyBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
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
      const raw = meanNormalized(buffer, range[0], range[1]);
      const previous = this.smoothed[band] as number;
      const coefficient = raw > previous ? ATTACK : RELEASE;
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
