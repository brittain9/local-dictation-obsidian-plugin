import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
