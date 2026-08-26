import { describe, expect, it } from 'vitest';

import {
  isSupportedTranslationPair,
  isTranslationLanguage,
  normalizeTranslationLanguage,
  TRANSLATION_LANGUAGES,
  translationSourcesFor,
  translationTargetsFor,
} from '../src/translation/languages';

const hyMt2 = {
  translationSupport: { kind: 'all_to_all' as const, languages: [...TRANSLATION_LANGUAGES] },
};
const bergamot = {
  translationSupport: {
    kind: 'pairs' as const,
    pairs: [
      { source: 'en', target: 'es' },
      { source: 'es', target: 'en' },
    ],
  },
};

describe('translation language capabilities', () => {
  it('exposes every HY-MT 2 language through one canonical translation-language list', () => {
    expect(TRANSLATION_LANGUAGES).toHaveLength(38);
    expect(TRANSLATION_LANGUAGES).toEqual(
      expect.arrayContaining(['zh', 'zh-Hant', 'yue', 'bo', 'ug', 'en', 'ja']),
    );
    expect(normalizeTranslationLanguage(' ZH-hant ')).toBe('zh-Hant');
    expect(isTranslationLanguage('zh-Hant')).toBe(true);
  });

  it('derives pair support from the selected catalog model', () => {
    expect(translationTargetsFor('ja', hyMt2)).toHaveLength(37);
    expect(translationSourcesFor(hyMt2)).toHaveLength(38);
    expect(isSupportedTranslationPair('ja', 'ko', hyMt2)).toBe(true);
    expect(isSupportedTranslationPair('ja', 'ko', bergamot)).toBe(false);
    expect(isSupportedTranslationPair('en', 'es', bergamot)).toBe(true);
    expect(isSupportedTranslationPair('en', 'ar', bergamot)).toBe(false);
    expect(isSupportedTranslationPair('ar', 'en', null)).toBe(true);
  });

  it('resolves source languages from directed pair support', () => {
    const oneWay = {
      translationSupport: {
        kind: 'pairs' as const,
        pairs: [{ source: 'en' as const, target: 'es' as const }],
      },
    };

    expect(translationSourcesFor(oneWay)).toEqual(['en']);
    expect(translationTargetsFor('en', oneWay)).toEqual(['es']);
    expect(translationTargetsFor('es', oneWay)).toEqual([]);
  });
});
