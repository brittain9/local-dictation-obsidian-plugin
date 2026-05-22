import { setIcon } from 'obsidian';

import type { AudioBandReader } from '../audio/audio-visualizer-tap';
import { AudioVisualizerTap } from '../audio/audio-visualizer-tap';
import type { DictationControllerState } from '../dictation/dictation-session-controller';
import type { QueueBackpressureTier } from '../sidecar/protocol';
import { ValueNoise1D } from './value-noise';

type RibbonIcon = 'animated-bars' | 'audio-lines' | 'mic' | 'loader' | 'mic-off';

/**
 * Custom audio-bars SVG used only while the ribbon is actively animating
 * (`speech_detected`). The resting `listening` state keeps the standard Lucide
 * `audio-lines` wave icon so the static state stays visually distinct from the
 * reactive speech state.
 */
const ANIMATED_BARS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" class="svg-icon">' +
  '<path d="M2 8v8"/>' +
  '<path d="M6 5v14"/>' +
  '<path d="M10 4v16"/>' +
  '<path d="M14 4v16"/>' +
  '<path d="M18 5v14"/>' +
  '<path d="M22 8v8"/>' +
  '</svg>';

/**
 * Per-bar scaleY envelope as [floor, ceiling] tuples, indexed by band 0..5.
 * Quiet speech shrinks bars toward `floor`; loud peaks overshoot above 1.0
 * (the static icon height). Center bars (16-unit, the tallest in the SVG)
 * get the widest dynamic range so a coherent wave bouncing outward reads
 * through the icon; outer bars (8-unit) keep a higher relative floor so
 * they stay visible at rest.
 */
const BAR_ENVELOPE: ReadonlyArray<readonly [floor: number, ceiling: number]> = [
  [0.45, 1.25],
  [0.3, 1.4],
  [0.2, 1.5],
  [0.2, 1.5],
  [0.3, 1.4],
  [0.45, 1.25],
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
const SPEECH_TAIL_HOLD_MS = 10_000;

/**
 * Below this aggregate audio level, bars drift via low-amplitude value noise so
 * the icon never freezes flat between syllables. Above the threshold, the audio
 * signal dominates and drift fades out smoothly.
 *
 * Gating off the loudest band (rather than each band's own level) keeps drift
 * symmetric: per-band pre-emphasis pushes the high bands well above any
 * per-band floor under realistic mic self-noise, which would otherwise produce
 * drift only on the low bars.
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
  private currentIcon: RibbonIcon | null = null;
  private readonly noise: readonly ValueNoise1D[] = NOISE_SEEDS.map(
    (seed) => new ValueNoise1D(seed),
  );

  constructor(private readonly element: HTMLElement) {
    this.reducedMotion = matchMedia(REDUCED_MOTION_QUERY);
    this.reducedMotionListener = (): void => this.onReducedMotionChange();
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
      // visualState lags behind during the tail-hold, but the announced state
      // (aria-label, title) must reflect reality immediately.
      this.renderLabel();
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
    // queueTier is not currently surfaced in the label or icon. Intentionally
    // do not call render() here — re-running paintIcon while speech_detected is
    // active would replace the live <svg> element, killing the in-flight
    // transform/opacity transitions. If a future revision starts reflecting the
    // tier, route it through renderLabel() (label-only), not render().
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
    this.paintIcon(this.visualState);
    this.element.dataset.localSttState = this.visualState;
    this.renderLabel();
  }

  private renderLabel(): void {
    // aria-label and title follow this.state, not visualState — a screen reader
    // or tooltip must announce the real controller state, even during the
    // speech-tail visual hold where visualState lags by up to SPEECH_TAIL_HOLD_MS.
    const label = buildRibbonLabel(this.state);
    this.element.setAttribute('aria-label', label);
    this.element.setAttribute('data-tooltip-position', 'top');
    this.element.title = label;
  }

  private paintIcon(state: DictationControllerState): void {
    const icon = iconForState(state);
    if (icon === this.currentIcon) {
      // Skipping the DOM write is essential: re-injecting innerHTML or running
      // setIcon would destroy the live path nodes that CSS transitions are
      // mid-flight on (and that the RAF loop is writing per-bar CSS vars to).
      return;
    }
    this.currentIcon = icon;
    switch (icon) {
      case 'animated-bars':
        this.element.innerHTML = ANIMATED_BARS_SVG;
        return;
      case 'audio-lines':
        setIcon(this.element, 'audio-lines');
        return;
      case 'mic':
        setIcon(this.element, 'mic');
        return;
      case 'loader':
        setIcon(this.element, 'loader');
        return;
      case 'mic-off':
        setIcon(this.element, 'mic-off');
        return;
      default:
        assertNever(icon);
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

  private onReducedMotionChange(): void {
    // If reduced-motion turns on mid-hold, abandon the visual lag immediately —
    // leaving a still custom-bars icon under a `reduce` preference is exactly
    // the artifact the preference is meant to suppress.
    if (this.reducedMotion.matches && this.visualState !== this.state) {
      this.cancelHold();
      this.visualState = this.state;
      this.render();
    }
    this.syncAnimation();
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
    const audioMax = maxBand(bands);
    // Smooth blend: as audioMax climbs through NOISE_AUDIO_FLOOR the gate fades
    // continuously to 0, so the noise contribution shrinks rather than dropping
    // off a cliff (the prior `Math.max(audio, noise)` formulation could
    // momentarily shave 7% off the bar height at the boundary, producing a
    // visible stutter on quiet vowel onsets).
    const noiseGate = allowNoise ? Math.max(0, 1 - audioMax / NOISE_AUDIO_FLOOR) : 0;
    for (let i = 0; i < BAR_ENVELOPE.length; i++) {
      const [floor, ceiling] = BAR_ENVELOPE[i] as readonly [number, number];
      const audioLevel = clamp01(bands[i] as number);
      const noiseLift = NOISE_FLOOR_AMPLITUDE * this.sampleNoise(i, t) * noiseGate;
      const level = clamp01(audioLevel + noiseLift);
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

function iconForState(state: DictationControllerState): RibbonIcon {
  switch (state) {
    case 'idle':
      return 'mic';
    case 'starting':
      return 'loader';
    case 'listening':
      return 'audio-lines';
    case 'speech_detected':
      return 'animated-bars';
    case 'error':
      return 'mic-off';
    default:
      return assertNever(state);
  }
}

function buildRibbonLabel(state: DictationControllerState): string {
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
    default:
      return assertNever(state);
  }
}

function maxBand(bands: Readonly<Float32Array>): number {
  let max = 0;
  for (let i = 0; i < bands.length; i++) {
    const v = bands[i] as number;
    if (v > max) {
      max = v;
    }
  }
  return max;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled ribbon variant: ${x as string}`);
}
