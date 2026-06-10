import { vi } from 'vitest';

export abstract class AbstractInputSuggest<T> {
  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
  limit = 100;
  setValue(_value: string): void {}
  getValue(): string {
    return '';
  }
  close(): void {}
}

// Export-resolution stub so modules importing `Setting` load under vitest's
// node environment; tests that exercise render paths need a real DOM stub.
export class Setting {}

export const Platform = {
  isMacOS: false,
  isWin: false,
  isLinux: true,
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
};

export class Notice {
  static instances: Array<{ message: string }> = [];
  constructor(public readonly message: string) {
    Notice.instances.push({ message });
  }
}

/**
 * Tracked spy: tests can assert on calls (`expect(setIcon).toHaveBeenCalledWith`)
 * and the side effect mirrors the real Obsidian API's contract of replacing the
 * parent's child SVG. The stub markup uses a data-icon attribute so assertions
 * like `element.innerHTML.includes('data-icon="mic"')` are exact.
 */
export const setIcon = vi.fn((parent: unknown, iconId: string): void => {
  if (parent && typeof parent === 'object' && 'innerHTML' in parent) {
    (parent as { innerHTML: string }).innerHTML = `<svg data-icon="${iconId}"></svg>`;
  }
});
