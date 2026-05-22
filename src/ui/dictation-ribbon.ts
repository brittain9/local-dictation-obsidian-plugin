import { setIcon } from 'obsidian';

import type { AudioBandReader } from '../audio/audio-visualizer-tap';
import { AudioVisualizerTap } from '../audio/audio-visualizer-tap';
import type { DictationControllerState } from '../dictation/dictation-session-controller';
import type { QueueBackpressureTier } from '../sidecar/protocol';
import { ValueNoise1D } from './value-noise';

type RibbonVisualState = 'idle' | 'starting' | 'listening' | 'speech_detected' | 'error';

/**
 * Custom audio-bars SVG used only while the ribbon is actively animating
 * (`speech_detected`). Heights (10/16/8/14/12/8) are visually varied but
 * sum-balanced left-vs-right (34 vs 34), avoiding both Lucide `audio-lines`'s
 * left-loaded asymmetry (native 3/11/18/7/13/3) and the over-uniform look of a
 * pair-mirrored bell. ViewBox + stroke attributes match Lucide so it blends
 * with the rest of the ribbon iconography. The resting `listening` state keeps
 * the standard Lucide `audio-lines` so the static look matches other Obsidian
 * surfaces (e.g. the LLM sidebar ribbon).
 */
const ANIMATED_BARS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" class="svg-icon">' +
  '<path d="M2 7v10"/>' +
  '<path d="M6 4v16"/>' +
  '<path d="M10 8v8"/>' +
  '<path d="M14 5v14"/>' +
  '<path d="M18 6v12"/>' +
  '<path d="M22 8v8"/>' +
  '</svg>';

/**
 * Per-bar scaleY envelope as [floor, ceiling] tuples. Quiet speech shrinks bars
 * toward the floor; loud peaks overshoot above 1.0 (the static icon height), so
 * the user sees a clear "punch above neutral" instead of bars that only ever shrink.
 * Center bars get the most overshoot — they're the tallest in the icon, so
 * amplifying them reads as a coherent wave bouncing outward.
 */
const BAR_ENVELOPE: ReadonlyArray<readonly [floor: number, ceiling: number]> = [
  [0.35, 1.25],
  [0.25, 1.35],
  [0.15, 1.45],
  [0.15, 1.45],
  [0.25, 1.35],
  [0.35, 1.25],
];
if (BAR_ENVELOPE.length !== AudioVisualizerTap.BAND_COUNT) {
  throw new Error('BAR_ENVELOPE length must match AudioVisualizerTap.BAND_COUNT.');
}
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * After VAD drops from speech_detected back to listening, keep the reactive
 * look alive for this long before easing into the static "resting cymbal".
 * Smooths over natural micro-pauses between phrases so the icon doesn't feel
 * twitchy while the user is mid-thought.
 */
const SPEECH_TAIL_HOLD_MS = 5_000;

/**
 * Below this audio level, bars are silent enough that we mix in low-amplitude
 * value noise so the icon never freezes flat between syllables. Above the
 * threshold, the audio signal dominates and noise is suppressed entirely.
 */
const NOISE_AUDIO_FLOOR = 0.05;

/**
 * Maximum lift the noise can apply to a bar (in the same [0, 1] space as the
 * audio level). Stays inside the lower half of the bar envelope so noise reads
 * as ambient drift, not as fake speech.
 */
const NOISE_FLOOR_AMPLITUDE = 0.12;

/**
 * Per-bar parameters that decorrelate the drift. Irrational-ish rate ratios
 * prevent beating; the phase offsets ensure bars don't all peak together.
 * Seeds are arbitrary 16-bit constants; the visual quality is insensitive to
 * the specific values, only that they differ.
 */
const NOISE_RATES: readonly number[] = [0.55, 0.78, 0.62, 0.91, 0.71, 0.83];
const NOISE_PHASES: readonly number[] = [0, 137.5, 275, 60, 197, 335];
const NOISE_SEEDS: readonly number[] = [0x1f3a, 0x2b7c, 0x4d91, 0x6e54, 0x8c1d, 0xa3b6];
if (
  NOISE_RATES.length !== AudioVisualizerTap.BAND_COUNT ||
  NOISE_PHASES.length !== AudioVisualizerTap.BAND_COUNT ||
  NOISE_SEEDS.length !== AudioVisualizerTap.BAND_COUNT
) {
  throw new Error('NOISE_RATES/PHASES/SEEDS lengths must match AudioVisualizerTap.BAND_COUNT.');
}

export class DictationRibbonController {
  private bandReader: AudioBandReader | null = null;
  private rafId: number | null = null;
  private readonly reducedMotion: MediaQueryList;
  private readonly reducedMotionListener: () => void;
  private state: DictationControllerState = 'idle';
  private visualState: DictationControllerState = 'idle';
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private queueTier: QueueBackpressureTier = 'normal';
  private readonly noise: readonly ValueNoise1D[] = NOISE_SEEDS.map(
    (seed) => new ValueNoise1D(seed),
  );

  constructor(private readonly element: HTMLElement) {
    this.reducedMotion = matchMedia(REDUCED_MOTION_QUERY);
    this.reducedMotionListener = (): void => this.syncAnimation();
    this.reducedMotion.addEventListener('change', this.reducedMotionListener);
    this.render();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  setState(state: DictationControllerState): void {
    if (this.state === state) {
      return;
    }
    const previousState = this.state;
    this.state = state;
    if (this.shouldStartHold(previousState, state)) {
      this.startHold();
      return;
    }
    this.cancelHold();
    this.visualState = state;
    this.render();
    this.syncAnimation();
  }

  setQueueTier(tier: QueueBackpressureTier): void {
    if (this.queueTier === tier) {
      return;
    }
    this.queueTier = tier;
    this.render();
  }

  setVisualizer(bandReader: AudioBandReader | null): void {
    this.bandReader = bandReader;
    this.syncAnimation();
  }

  dispose(): void {
    this.cancelHold();
    this.stopAnimation();
    this.reducedMotion.removeEventListener('change', this.reducedMotionListener);
    this.element.remove();
  }

  private render(): void {
    const label = buildRibbonLabel(this.visualState, this.queueTier);

    this.paintIcon(this.visualState);
    this.element.setAttribute('aria-label', label);
    this.element.setAttribute('data-tooltip-position', 'top');
    this.element.dataset.localSttState = toVisualState(this.visualState);
    this.element.title = label;
  }

  private paintIcon(state: DictationControllerState): void {
    switch (state) {
      case 'speech_detected':
        this.element.innerHTML = ANIMATED_BARS_SVG;
        return;
      case 'listening':
        setIcon(this.element, 'audio-lines');
        return;
      case 'idle':
        setIcon(this.element, 'mic');
        return;
      case 'starting':
        setIcon(this.element, 'loader');
        return;
      case 'error':
        setIcon(this.element, 'mic-off');
        return;
    }
  }

  private syncAnimation(): void {
    const shouldRun =
      this.visualState === 'speech_detected' &&
      this.bandReader !== null &&
      !this.reducedMotion.matches;

    if (shouldRun) {
      this.startAnimation();
    } else {
      this.stopAnimation();
    }
  }

  private shouldStartHold(from: DictationControllerState, to: DictationControllerState): boolean {
    return from === 'speech_detected' && to === 'listening' && !this.reducedMotion.matches;
  }

  private startHold(): void {
    this.cancelHold();
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.visualState = this.state;
      this.render();
      this.syncAnimation();
    }, SPEECH_TAIL_HOLD_MS);
  }

  private cancelHold(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private startAnimation(): void {
    if (this.rafId !== null) {
      return;
    }
    const tick = (): void => {
      const bands = this.bandReader?.readBands();
      if (bands) {
        this.applyBands(bands);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resetBars();
  }

  private applyBands(bands: Readonly<Float32Array>): void {
    const allowNoise = !this.reducedMotion.matches;
    const t = performance.now() / 1000;
    for (let i = 0; i < BAR_ENVELOPE.length; i++) {
      const [floor, ceiling] = BAR_ENVELOPE[i] as readonly [number, number];
      const audioLevel = clamp01(bands[i] as number);
      // Math.max (not addition) so audio always dominates noise when present —
      // sibilants and vowels keep their full punch from the audio-side gain.
      const level =
        allowNoise && audioLevel < NOISE_AUDIO_FLOOR
          ? Math.max(audioLevel, NOISE_FLOOR_AMPLITUDE * this.sampleNoise(i, t))
          : audioLevel;
      const scale = floor + (ceiling - floor) * level;
      this.element.style.setProperty(`--local-stt-bar-${i + 1}`, scale.toFixed(2));
    }
  }

  private sampleNoise(bar: number, timeSeconds: number): number {
    const rate = NOISE_RATES[bar] as number;
    const phase = NOISE_PHASES[bar] as number;
    return (this.noise[bar] as ValueNoise1D).sample(timeSeconds * rate + phase);
  }

  private resetBars(): void {
    for (let i = 0; i < BAR_ENVELOPE.length; i++) {
      this.element.style.removeProperty(`--local-stt-bar-${i + 1}`);
    }
  }
}

function buildRibbonLabel(
  state: DictationControllerState,
  _queueTier: QueueBackpressureTier,
): string {
  switch (state) {
    case 'idle':
      return 'Local Dictation — start dictation';
    case 'starting':
      return 'Local Dictation — starting…';
    case 'listening':
      return 'Local Dictation — listening';
    case 'speech_detected':
      return 'Local Dictation — hearing speech';
    case 'error':
      return 'Local Dictation — error';
  }
}

function toVisualState(state: DictationControllerState): RibbonVisualState {
  switch (state) {
    case 'idle':
      return 'idle';
    case 'starting':
      return 'starting';
    case 'listening':
      return 'listening';
    case 'speech_detected':
      return 'speech_detected';
    case 'error':
      return 'error';
  }
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
