import { describe, expect, it } from 'vitest';

import { catalogs } from '../src/locales';
import { en } from '../src/locales/en';

const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/gu;

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1] as string).sort();
}

describe('locale catalog parity', () => {
  it('registers every shipped locale', () => {
    expect(Object.keys(catalogs).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'ja', 'nl', 'pt']);
  });

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} has no orphan keys or interpolation mismatches`, () => {
      const englishKeys = new Set(Object.keys(en));
      const orphanKeys = Object.keys(catalog).filter((key) => !englishKeys.has(key));
      const placeholderMismatches = Object.entries(catalog).flatMap(([key, translation]) => {
        const source = en[key as keyof typeof en];
        if (source === undefined || translation === undefined) return [];
        return placeholders(source).join('\0') === placeholders(translation).join('\0')
          ? []
          : [key];
      });

      expect(orphanKeys, `${locale} contains keys that are absent from en`).toEqual([]);
      expect(
        placeholderMismatches,
        `${locale} translations must preserve their English interpolation placeholders`,
      ).toEqual([]);
    });

    it(`${locale} reports translation coverage`, () => {
      const translatedCount = Object.keys(catalog).length;
      const englishCount = Object.keys(en).length;
      const coverage = Math.round((translatedCount / englishCount) * 100);

      console.warn(
        `[i18n] ${locale}: ${translatedCount}/${englishCount} keys translated (${coverage}% coverage)`,
      );

      expect(translatedCount).toBeLessThanOrEqual(englishCount);
    });
  }
});
