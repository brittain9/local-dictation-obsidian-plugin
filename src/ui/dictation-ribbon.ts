import { setIcon } from 'obsidian';

import type { DictationControllerState } from '../dictation/dictation-session-controller';
import type { QueueBackpressureTier } from '../sidecar/protocol';

type RibbonIcon = 'audio-lines' | 'loader' | 'mic' | 'mic-off';
type RibbonVisualState = 'idle' | 'starting' | 'listening' | 'speech_detected' | 'error';

export class DictationRibbonController {
  private state: DictationControllerState = 'idle';
  private queueTier: QueueBackpressureTier = 'normal';

  constructor(private readonly element: HTMLElement) {
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
  }

  setQueueTier(tier: QueueBackpressureTier): void {
    if (this.queueTier === tier) {
      return;
    }
    this.queueTier = tier;
    this.render();
  }

  dispose(): void {
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
