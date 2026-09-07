import { setIcon } from 'obsidian';

import { type AudioBandReader, BAND_COUNT } from '../audio/audio-bands';
import type { DictationControllerState } from '../dictation/dictation-session-controller';
import type { AcceleratorId } from '../models/model-management-types';
import { t } from '../shared/i18n';
import type { QueueBackpressureTier } from '../sidecar/protocol';

type RibbonIcon = 'audio-lines' | 'mic' | 'loader' | 'mic-off';

/**
 * Per-bar scaleY envelope. Lucide `audio-lines` has path heights
 * [3, 11, 18, 7, 13, 3] — band 5 is six times shorter than band 2 in the
 * SVG, so a uniform ceiling makes /s/ visually disappear next to vowels
 * even when the audio levels are equal. We compensate by giving the small
 * outer bars (and the right-side mid-bars) wider ceilings so they swing
 * harder visually when their band is active.
 *
 * Floors are kept uniform so the at-rest icon still reads as Lucide.
 */
const BAR_FLOOR = 0.25;
const BAR_CEILINGS: readonly number[] = [1.6, 1.3, 1.4, 1.8, 1.7, 2.8];
if (BAR_CEILINGS.length !== BAND_COUNT) {
  throw new Error('BAR_CEILINGS length must match BAND_COUNT.');
}
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * After VAD drops from speech_detected back to listening, keep the reactive
 * look alive for this long before easing into the static "resting cymbal".
 * Smooths over natural micro-pauses between phrases so the icon doesn't feel
 * twitchy while the user is mid-thought.
 */
const SPEECH_TAIL_HOLD_MS = 5_000;

export class DictationRibbonController {
  private bandReader: AudioBandReader | null = null;
  private rafId: number | null = null;
  private readonly reducedMotion: MediaQueryList;
  private readonly reducedMotionListener: () => void;
  private state: DictationControllerState = 'idle';
  private visualState: DictationControllerState = 'idle';
  private holdTimer: number | null = null;
  private queueTier: QueueBackpressureTier = 'normal';
  private currentIcon: RibbonIcon | null = null;
  private accelerator: AcceleratorId | null = null;
  private bufferLength = 0;
  private readonly acceleratorBadge: HTMLSpanElement;
  private readonly bufferBadge: HTMLSpanElement;

  constructor(private readonly element: HTMLElement) {
    this.reducedMotion = matchMedia(REDUCED_MOTION_QUERY);
    this.reducedMotionListener = (): void => this.onReducedMotionChange();
    this.reducedMotion.addEventListener('change', this.reducedMotionListener);
    const elementWithDom = this.element as HTMLElement & {
      classList?: DOMTokenList;
      append?: (...nodes: Node[]) => void;
    };
    elementWithDom.classList?.add('local-stt-ribbon-action');
    if (typeof document !== 'undefined' && elementWithDom.append !== undefined) {
      this.acceleratorBadge = this.element.createSpan({ cls: 'local-stt-ribbon__accelerator' });
      this.bufferBadge = this.element.createSpan({ cls: 'local-stt-ribbon__buffer' });
      elementWithDom.append(this.acceleratorBadge, this.bufferBadge);
    } else {
      this.acceleratorBadge = { textContent: '' } as HTMLSpanElement;
      this.bufferBadge = { textContent: '' } as HTMLSpanElement;
    }
    this.renderBadges();
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

  setAccelerator(accelerator: AcceleratorId | null): void {
    this.accelerator = accelerator;
    this.renderBadges();
  }

  setBufferLength(queuedUtterances: number): void {
    this.bufferLength = Math.max(0, Math.floor(queuedUtterances));
    this.renderBadges();
  }

  dispose(): void {
    this.cancelHold();
    this.stopAnimation();
    this.reducedMotion.removeEventListener('change', this.reducedMotionListener);
    this.element.remove();
  }

  private render(): void {
    this.paintIcon(this.visualState);
    this.appendBadges();
    this.element.dataset.localSttState = this.visualState;
    this.renderLabel();
  }

  private appendBadges(): void {
    const elementWithDom = this.element as HTMLElement & {
      append?: (...nodes: Node[]) => void;
    };
    // Obsidian's setIcon() replaces the action's children. Re-appending moves
    // existing badges back after the SVG without duplicating them.
    elementWithDom.append?.(this.acceleratorBadge, this.bufferBadge);
  }

  private renderBadges(): void {
    this.acceleratorBadge.textContent = acceleratorBadgeText(this.accelerator);
    this.bufferBadge.textContent = `${this.bufferLength}`;
    this.element.dataset.localSttAccelerator = this.accelerator ?? 'none';
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
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      this.visualState = this.state;
      this.render();
      this.syncAnimation();
    }, SPEECH_TAIL_HOLD_MS);
  }

  private cancelHold(): void {
    if (this.holdTimer !== null) {
      window.clearTimeout(this.holdTimer);
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
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resetBars();
  }

  private applyBands(bands: Readonly<Float32Array>): void {
    for (let i = 0; i < BAND_COUNT; i++) {
      const level = clamp01(bands[i] as number);
      const ceiling = BAR_CEILINGS[i] as number;
      const scale = BAR_FLOOR + (ceiling - BAR_FLOOR) * level;
      this.element.style.setProperty(`--local-stt-bar-${i + 1}`, scale.toFixed(2));
    }
  }

  private resetBars(): void {
    for (let i = 0; i < BAND_COUNT; i++) {
      this.element.style.removeProperty(`--local-stt-bar-${i + 1}`);
    }
  }
}

function acceleratorBadgeText(accelerator: AcceleratorId | null): string {
  switch (accelerator) {
    case 'cuda':
      return 'N';
    case 'vulkan':
      return 'V';
    case 'cpu':
      return 'C';
    case 'metal':
      return 'M';
    case 'direct_ml':
      return 'D';
    case null:
      return '';
  }
}

function iconForState(state: DictationControllerState): RibbonIcon {
  switch (state) {
    case 'idle':
      return 'mic';
    case 'starting':
      return 'loader';
    case 'listening':
    case 'speech_detected':
      return 'audio-lines';
    case 'error':
      return 'mic-off';
    default:
      return assertNever(state);
  }
}

function buildRibbonLabel(state: DictationControllerState): string {
  switch (state) {
    case 'idle':
      return t('ribbon.idle');
    case 'starting':
      return t('ribbon.starting');
    case 'listening':
      return t('ribbon.listening');
    case 'speech_detected':
      return t('ribbon.speechDetected');
    case 'error':
      return t('ribbon.error');
    default:
      return assertNever(state);
  }
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled ribbon variant: ${x as string}`);
}
