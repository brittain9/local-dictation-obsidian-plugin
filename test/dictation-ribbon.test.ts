import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioBandReader } from '../src/audio/audio-visualizer-tap';
import { AudioVisualizerTap } from '../src/audio/audio-visualizer-tap';
import { DictationRibbonController } from '../src/ui/dictation-ribbon';

class FakeMediaQueryList {
  matches = false;
  addEventListener(_event: 'change', _cb: () => void): void {}
  removeEventListener(_event: 'change', _cb: () => void): void {}
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
    vi.advanceTimersByTime(2_000);

    controller.setState('speech_detected');
    expect(element.dataset.localSttState).toBe('speech_detected');

    vi.advanceTimersByTime(10_000);
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

    vi.advanceTimersByTime(10_000);
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

describe('DictationRibbonController bar icon', () => {
  it('leaves the resting listening state to Lucide (no custom SVG injection)', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    expect(countPaths(element.innerHTML)).toBe(0);
    expect(element.innerHTML).not.toContain('<svg');
  });

  it('injects the custom 6-path SVG only when transitioning into speech_detected', () => {
    const { controller, element } = makeController();
    controller.setState('listening');
    expect(countPaths(element.innerHTML)).toBe(0);

    controller.setState('speech_detected');
    expect(countPaths(element.innerHTML)).toBe(6);
    expect(element.innerHTML).toContain('<svg');
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

    // BAR_ENVELOPE[0] floor is 0.35 — that's the value without noise mix.
    // Across 30 sampled frames, noise must lift the bar above the floor.
    expect(bar1Max).toBeGreaterThan(0.35);
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
