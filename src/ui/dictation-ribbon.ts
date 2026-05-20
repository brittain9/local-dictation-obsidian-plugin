import { setIcon } from 'obsidian';

import type { AudioBandReader } from '../audio/audio-visualizer-tap';
import { AudioVisualizerTap } from '../audio/audio-visualizer-tap';
import type { DictationControllerState } from '../dictation/dictation-session-controller';
import type { QueueBackpressureTier } from '../sidecar/protocol';

type RibbonIcon = 'audio-lines' | 'loader' | 'mic' | 'mic-off';
type RibbonVisualState = 'idle' | 'starting' | 'listening' | 'speech_detected' | 'error';

const BAR_MIN_SCALE: readonly number[] = [0.65, 0.45, 0.3, 0.3, 0.45, 0.65];
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export class DictationRibbonController {
  private bandReader: AudioBandReader | null = null;
  private rafId: number | null = null;
  private readonly reducedMotion: MediaQueryList | null;
  private readonly reducedMotionListener: (() => void) | null;
  private state: DictationControllerState = 'idle';
  private queueTier: QueueBackpressureTier = 'normal';

  constructor(private readonly element: HTMLElement) {
    const reducedMotion = globalThis.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
    this.reducedMotion = reducedMotion;
    if (reducedMotion !== null) {
      const listener = (): void => this.syncAnimation();
      this.reducedMotionListener = listener;
      reducedMotion.addEventListener('change', listener);
    } else {
      this.reducedMotionListener = null;
    }
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
    if (this.reducedMotion !== null && this.reducedMotionListener !== null) {
      this.reducedMotion.removeEventListener('change', this.reducedMotionListener);
    }
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
      this.state === 'speech_detected' &&
      this.bandReader !== null &&
      this.reducedMotion?.matches !== true &&
      typeof globalThis.requestAnimationFrame === 'function';

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
      if (bands !== null && bands !== undefined) {
        this.applyBands(bands);
      }
      this.rafId = globalThis.requestAnimationFrame(tick);
    };
    this.rafId = globalThis.requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.rafId !== null) {
      globalThis.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resetBars();
  }

  private applyBands(bands: Readonly<Float32Array>): void {
    const count = Math.min(bands.length, AudioVisualizerTap.BAND_COUNT, BAR_MIN_SCALE.length);
    for (let i = 0; i < count; i++) {
      const level = clamp01(bands[i] as number);
      const min = BAR_MIN_SCALE[i] as number;
      const scale = min + (1 - min) * level;
      this.element.style.setProperty(`--local-stt-bar-${i + 1}`, scale.toFixed(3));
    }
  }

  private resetBars(): void {
    for (let i = 0; i < BAR_MIN_SCALE.length; i++) {
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
