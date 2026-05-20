import { setIcon } from 'obsidian';

import type { AudioBandReader } from '../audio/audio-visualizer-tap';
import { AudioVisualizerTap } from '../audio/audio-visualizer-tap';
import type { DictationControllerState } from '../dictation/dictation-session-controller';
import type { QueueBackpressureTier } from '../sidecar/protocol';

type RibbonIcon = 'audio-lines' | 'loader' | 'mic' | 'mic-off';
type RibbonVisualState = 'idle' | 'starting' | 'listening' | 'speech_detected' | 'error';

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

export class DictationRibbonController {
  private bandReader: AudioBandReader | null = null;
  private rafId: number | null = null;
  private readonly reducedMotion: MediaQueryList;
  private readonly reducedMotionListener: () => void;
  private state: DictationControllerState = 'idle';
  private queueTier: QueueBackpressureTier = 'normal';

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
    this.state = state;
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
    this.stopAnimation();
    this.reducedMotion.removeEventListener('change', this.reducedMotionListener);
    this.element.remove();
  }

  private render(): void {
    const { icon, label } = buildRibbonState(this.state, this.queueTier);

    setIcon(this.element, icon);
    this.element.setAttribute('aria-label', label);
    this.element.setAttribute('data-tooltip-position', 'top');
    this.element.dataset.localSttState = toVisualState(this.state);
    this.element.title = label;
  }

  private syncAnimation(): void {
    const shouldRun =
      this.state === 'speech_detected' && this.bandReader !== null && !this.reducedMotion.matches;

    if (shouldRun) {
      this.startAnimation();
    } else {
      this.stopAnimation();
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
    for (let i = 0; i < BAR_ENVELOPE.length; i++) {
      const [floor, ceiling] = BAR_ENVELOPE[i] as readonly [number, number];
      const level = clamp01(bands[i] as number);
      const scale = floor + (ceiling - floor) * level;
      this.element.style.setProperty(`--local-stt-bar-${i + 1}`, scale.toFixed(2));
    }
  }

  private resetBars(): void {
    for (let i = 0; i < BAR_ENVELOPE.length; i++) {
      this.element.style.removeProperty(`--local-stt-bar-${i + 1}`);
    }
  }
}

function buildRibbonState(
  state: DictationControllerState,
  _queueTier: QueueBackpressureTier,
): {
  icon: RibbonIcon;
  label: string;
} {
  switch (state) {
    case 'idle':
      return { icon: 'mic', label: 'Local Dictation — start dictation' };

    case 'starting':
      return { icon: 'loader', label: 'Local Dictation — starting…' };

    case 'listening':
      return { icon: 'audio-lines', label: 'Local Dictation — listening' };

    case 'speech_detected':
      return { icon: 'audio-lines', label: 'Local Dictation — hearing speech' };

    case 'error':
      return { icon: 'mic-off', label: 'Local Dictation — error' };
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
