import { setIcon } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioBandReader } from '../src/audio/audio-visualizer-tap';
import { AudioVisualizerTap } from '../src/audio/audio-visualizer-tap';
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
  it('keeps the speech_detected look for 10s after VAD drops, then flips to listening', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    expect(element.dataset.localSttState).toBe('speech_detected');

    controller.setState('listening');
    expect(element.dataset.localSttState).toBe('speech_detected');

    vi.advanceTimersByTime(9_999);
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
    expect(element.attributes['aria-label']).toBe('Local Dictation — hearing speech');
    expect(element.title).toBe('Local Dictation — hearing speech');

    controller.setState('listening');
    // Visual still held on speech_detected — animation/CSS keeps drifting bars.
    expect(element.dataset.localSttState).toBe('speech_detected');
    // But a screen reader / tooltip must see truth right away.
    expect(element.attributes['aria-label']).toBe('Local Dictation — listening');
    expect(element.title).toBe('Local Dictation — listening');

    vi.advanceTimersByTime(10_000);
    expect(element.dataset.localSttState).toBe('listening');
    expect(element.attributes['aria-label']).toBe('Local Dictation — listening');
  });
});

describe('DictationRibbonController paintIcon', () => {
  it('shares the bars SVG between listening and speech_detected (no DOM swap on the flip)', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    // The 6-bar SVG is the listening icon — keeps path identities across the
    // listening↔speech_detected flip so styles.css transitions can fire.
    expect(countPaths(element.innerHTML)).toBe(6);

    const beforeFlip = element.innerHTML;
    controller.setState('speech_detected');
    expect(element.innerHTML).toBe(beforeFlip);
  });

  it('does not re-inject the SVG on a redundant paintIcon (same icon)', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    controller.setState('speech_detected');
    const snapshot = element.innerHTML;

    // setState('speech_detected') during the tail hold (real state=listening,
    // visual=speech_detected) triggers paintIcon('speech_detected') again. The
    // icon hasn't changed (still 'bars'), so innerHTML must NOT be rewritten —
    // otherwise the live <path> nodes that CSS is mid-transition on get
    // destroyed and replaced, snapping the animation.
    controller.setState('listening');
    controller.setState('speech_detected');
    expect(element.innerHTML).toBe(snapshot);
  });

  it('uses Lucide setIcon for idle/starting/error states', () => {
    const { controller } = makeController();
    // Constructor renders idle → setIcon called with 'mic'.
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'mic');

    controller.setState('starting');
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'loader');

    controller.setState('listening');
    controller.setState('speech_detected');
    controller.setState('error');
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'mic-off');
  });

  it('does not call setIcon when entering the bars-driven states', () => {
    const { controller } = makeController();
    vi.mocked(setIcon).mockClear();
    controller.setState('listening');
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

function countPaths(html: string): number {
  return (html.match(/<path\b/g) ?? []).length;
}

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
  return { readBands: () => new Float32Array(AudioVisualizerTap.BAND_COUNT) };
}

describe('DictationRibbonController idle-floor noise drift', () => {
  it('lifts bars above their unmixed floor when audio is silent', () => {
    const rafCallbacks = stubRaf();
    const { controller, element } = makeController();
    controller.setVisualizer(silentBandReader());
    controller.setState('listening');
    controller.setState('speech_detected');

    let bar1Max = 0;
    const distinctRendered = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const cb = rafCallbacks.shift();
      if (!cb) break;
      cb();
      const rendered = element.styleProps['--local-stt-bar-1'];
      if (rendered !== undefined) {
        bar1Max = Math.max(bar1Max, parseFloat(rendered));
        distinctRendered.add(rendered);
      }
      vi.advanceTimersByTime(100);
    }

    // BAR_ENVELOPE[0] floor is 0.45 — the value at level=0. Across 30 sampled
    // frames the value-noise drift must lift the bar above the floor at least
    // once, otherwise the icon would visibly freeze between syllables.
    expect(bar1Max).toBeGreaterThan(0.45);
    // And the value must move between frames, not just bump once.
    expect(distinctRendered.size).toBeGreaterThan(3);
  });

  it('suppresses drift entirely under prefers-reduced-motion: reduce', () => {
    mediaQuery.matches = true;
    const rafCallbacks = stubRaf();
    const { controller, element } = makeController();
    controller.setVisualizer(silentBandReader());
    controller.setState('listening');
    controller.setState('speech_detected');

    // syncAnimation short-circuits when reducedMotion is on, so the RAF loop
    // never starts and bar CSS variables are never written.
    expect(rafCallbacks).toHaveLength(0);
    expect(element.styleProps['--local-stt-bar-1']).toBeUndefined();
  });
});
