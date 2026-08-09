import { setIcon } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioBandReader, BAND_COUNT } from '../src/audio/audio-bands';
import { DictationRibbonController } from '../src/ui/dictation-ribbon';

class FakeMediaQueryList {
  matches = false;
  private listeners = new Set<() => void>();
  addEventListener(_event: 'change', cb: () => void): void {
    this.listeners.add(cb);
  }
  removeEventListener(_event: 'change', cb: () => void): void {
    this.listeners.delete(cb);
  }
  fireChange(): void {
    for (const cb of this.listeners) cb();
  }
}

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  readonly styleProps: Record<string, string> = {};
  title = '';
  removed = false;
  innerHTML = '';
  readonly style = {
    setProperty: (name: string, value: string): void => {
      this.styleProps[name] = value;
    },
    removeProperty: (name: string): void => {
      delete this.styleProps[name];
    },
  };
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  remove(): void {
    this.removed = true;
  }
}

let mediaQuery: FakeMediaQueryList;

beforeEach(() => {
  mediaQuery = new FakeMediaQueryList();
  vi.stubGlobal('matchMedia', () => mediaQuery);
  vi.useFakeTimers();
  vi.mocked(setIcon).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeController(): { controller: DictationRibbonController; element: FakeElement } {
  const element = new FakeElement();
  const controller = new DictationRibbonController(element as unknown as HTMLElement);
  return { controller, element };
}

describe('DictationRibbonController speech tail hold', () => {
  it('keeps the speech_detected look for 5s after VAD drops, then flips to listening', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    expect(element.dataset.localSttState).toBe('speech_detected');

    controller.setState('listening');
    expect(element.dataset.localSttState).toBe('speech_detected');

    vi.advanceTimersByTime(4_999);
    expect(element.dataset.localSttState).toBe('speech_detected');

    vi.advanceTimersByTime(1);
    expect(element.dataset.localSttState).toBe('listening');
  });

  it('cancels the pending hold when speech resumes inside the window', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    controller.setState('listening');
    // Arm check: the hold timer is the only outstanding timer right now.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(vi.getTimerCount()).toBe(1);

    controller.setState('speech_detected');
    // The cancel must clear the timer — otherwise the late firing would
    // overwrite visualState even after speech resumed.
    expect(vi.getTimerCount()).toBe(0);
    expect(element.dataset.localSttState).toBe('speech_detected');

    vi.advanceTimersByTime(20_000);
    expect(element.dataset.localSttState).toBe('speech_detected');
  });

  it('bypasses the hold for loud transitions like error', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    controller.setState('listening');
    expect(element.dataset.localSttState).toBe('speech_detected');

    controller.setState('error');
    expect(element.dataset.localSttState).toBe('error');

    vi.advanceTimersByTime(20_000);
    expect(element.dataset.localSttState).toBe('error');
  });

  it('skips the hold entirely when prefers-reduced-motion is on', () => {
    mediaQuery.matches = true;
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    controller.setState('listening');
    expect(element.dataset.localSttState).toBe('listening');
  });
});

describe('DictationRibbonController a11y during hold', () => {
  it('announces real state on aria-label/title immediately, even while the visual lags', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    expect(element.attributes['aria-label']).toBe('Speech Kit — hearing speech');
    expect(element.title).toBe('Speech Kit — hearing speech');

    controller.setState('listening');
    // Visual still held on speech_detected — animation/CSS keeps drifting bars.
    expect(element.dataset.localSttState).toBe('speech_detected');
    // But a screen reader / tooltip must see truth right away.
    expect(element.attributes['aria-label']).toBe('Speech Kit — listening');
    expect(element.title).toBe('Speech Kit — listening');

    vi.advanceTimersByTime(5_000);
    expect(element.dataset.localSttState).toBe('listening');
    expect(element.attributes['aria-label']).toBe('Speech Kit — listening');
  });
});

describe('DictationRibbonController paintIcon', () => {
  it('uses the Lucide audio-lines icon for both listening and speech states', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'audio-lines');
    expect(element.innerHTML).toBe('<svg data-icon="audio-lines"></svg>');

    vi.mocked(setIcon).mockClear();
    controller.setState('speech_detected');
    // Same icon name — paintIcon's cache key skips the re-paint so the live
    // SVG paths are preserved across the state change.
    expect(setIcon).not.toHaveBeenCalled();
    expect(element.innerHTML).toBe('<svg data-icon="audio-lines"></svg>');
  });

  it('does not re-inject the SVG on a redundant paintIcon (same icon)', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    const snapshot = element.innerHTML;

    // setState('speech_detected') during the tail hold (real state=listening,
    // visual=speech_detected) triggers paintIcon('speech_detected') again.
    // The icon name is unchanged, so innerHTML must NOT be rewritten —
    // otherwise the live <path> nodes that CSS is mid-transition on get
    // destroyed and replaced, snapping the animation.
    controller.setState('listening');
    controller.setState('speech_detected');
    expect(element.innerHTML).toBe(snapshot);
  });

  it('uses Lucide setIcon for non-animated states', () => {
    const { controller } = makeController();
    // Constructor renders idle → setIcon called with 'mic'.
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'mic');

    controller.setState('starting');
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'loader');

    controller.setState('listening');
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'audio-lines');

    controller.setState('speech_detected');
    controller.setState('error');
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'mic-off');
  });

  it('does not call setIcon when entering the animated speech state', () => {
    const { controller } = makeController();
    controller.setState('listening');
    vi.mocked(setIcon).mockClear();
    controller.setState('speech_detected');
    expect(setIcon).not.toHaveBeenCalled();
  });
});

describe('DictationRibbonController hold lifecycle interactions', () => {
  it('cancels the pending hold timer on dispose', () => {
    const { controller } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    controller.setState('listening');
    expect(vi.getTimerCount()).toBe(1);

    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('setQueueTier during the hold does not rewrite the live SVG', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    controller.setState('listening');
    const snapshot = element.innerHTML;

    controller.setQueueTier('catching_up');
    controller.setQueueTier('saturated');
    expect(element.innerHTML).toBe(snapshot);
  });

  it('surfaces processing pressure without repainting the live icon', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    const snapshot = element.innerHTML;

    controller.setQueueTier('catching_up');
    expect(element.dataset.localSttQueueTier).toBe('catching_up');
    expect(element.attributes['aria-label']).toBe(
      'Speech Kit — listening — processing is catching up',
    );

    controller.setQueueTier('falling_behind');
    expect(element.attributes['aria-label']).toBe(
      'Speech Kit — listening — processing is falling behind; pause briefly',
    );

    controller.setQueueTier('saturated');
    expect(element.attributes['aria-label']).toBe(
      'Speech Kit — listening — processing backlog is full; pause speaking',
    );
    expect(element.innerHTML).toBe(snapshot);
  });

  it('cancels the hold immediately when reduced-motion turns on mid-hold', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    controller.setState('listening');
    expect(element.dataset.localSttState).toBe('speech_detected');
    expect(vi.getTimerCount()).toBe(1);

    mediaQuery.matches = true;
    mediaQuery.fireChange();

    // The hold must be aborted: leaving a still bars icon under a `reduce`
    // preference is exactly the artifact the preference is meant to suppress.
    expect(vi.getTimerCount()).toBe(0);
    expect(element.dataset.localSttState).toBe('listening');
  });
});

function stubRaf(): Array<() => void> {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return callbacks;
}

function silentBandReader(): AudioBandReader {
  return { readBands: () => new Float32Array(BAND_COUNT) };
}

describe('DictationRibbonController bar rendering', () => {
  it('parks bars at the silent-floor scale when audio is silent', () => {
    const rafCallbacks = stubRaf();
    const { controller, element } = makeController();
    controller.setVisualizer(silentBandReader());
    controller.setState('listening');
    controller.setState('speech_detected');

    const cb = rafCallbacks.shift();
    if (!cb) throw new Error('expected a RAF callback');
    cb();

    // At silence every bar must equal BAR_FLOOR exactly — without an idle
    // drift path the value is deterministic; this pin catches accidental
    // re-introduction of noise mixing.
    for (let i = 1; i <= BAND_COUNT; i++) {
      expect(element.styleProps[`--local-stt-bar-${i}`]).toBe('0.25');
    }
  });

  it('does not run the RAF loop when prefers-reduced-motion is on', () => {
    mediaQuery.matches = true;
    const rafCallbacks = stubRaf();
    const { controller } = makeController();
    controller.setVisualizer(silentBandReader());
    controller.setState('listening');
    controller.setState('speech_detected');

    expect(rafCallbacks).toHaveLength(0);
  });
});
