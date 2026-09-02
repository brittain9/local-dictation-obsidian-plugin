import { describe, expect, it } from 'vitest';

import {
  isSupportedTranslationPair,
  isTranslationLanguage,
  normalizeTranslationLanguage,
  TRANSLATION_LANGUAGES,
  translationSourcesFor,
  translationTargetsFor,
} from '../src/translation/languages';

const hyMt2Languages = TRANSLATION_LANGUAGES.filter(
  (language) =>
    ![
      'bg',
      'ca',
      'da',
      'el',
      'et',
      'eu',
      'fi',
      'gl',
      'hu',
      'is',
      'kn',
      'lt',
      'lv',
      'ml',
      'nb',
      'ro',
      'sk',
      'sl',
      'sv',
    ].includes(language),
);
const hyMt2 = {
  translationSupport: { kind: 'all_to_all' as const, languages: [...hyMt2Languages] },
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
  it('exposes the union of catalog translation languages through one canonical list', () => {
    expect(TRANSLATION_LANGUAGES).toHaveLength(57);
    expect(TRANSLATION_LANGUAGES).toEqual(
      expect.arrayContaining(['zh', 'zh-Hant', 'yue', 'bo', 'ug', 'en', 'ja', 'bg', 'sv']),
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
