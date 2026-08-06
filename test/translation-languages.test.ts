import { describe, expect, it } from 'vitest';

import {
  catalogTranslationDirections,
  isSupportedTranslationPair,
  resolveTranslationLanguages,
  resolveTranslationTarget,
  translationSourcesFor,
  translationTargetsFor,
} from '../src/translation/languages';

const MODELS = [
  {
    task: 'translation' as const,
    translationPairs: [
      { source: 'en', target: 'es' },
      { source: 'es', target: 'en' },
      // Mozilla releases the halves of a pair independently. Croatian has an
      // outbound model and no inbound one, which is the case that must not be
      // rounded up to "English on one side, so it works".
      { source: 'en', target: 'hr' },
    ],
  },
  { task: 'stt' as const },
];

describe('translation directions', () => {
  it('offers only directions a cataloged model actually serves', () => {
    const directions = catalogTranslationDirections(MODELS);

    expect(isSupportedTranslationPair(directions, 'en', 'es')).toBe(true);
    expect(isSupportedTranslationPair(directions, 'es', 'en')).toBe(true);
    // `hr` is outside the persisted translation vocabulary, so an unreleased
    // reverse direction cannot leak in through either half of the pair.
    expect(translationTargetsFor(directions, 'en')).toEqual(['es']);
    expect(translationSourcesFor(directions)).toEqual(['en', 'es']);
  });

  it('does not offer a language whose only direction is unreleased', () => {
    const directions = catalogTranslationDirections(MODELS);

    expect(isSupportedTranslationPair(directions, 'de', 'en')).toBe(false);
    expect(isSupportedTranslationPair(directions, 'en', 'de')).toBe(false);
    expect(resolveTranslationTarget(directions, 'de', 'en')).toBeNull();
  });

  it('drops a persisted pair the catalog no longer serves', () => {
    const directions = catalogTranslationDirections(MODELS);

    expect(resolveTranslationLanguages(directions, 'en', 'de', 'en')).toEqual({
      sourceLanguage: 'en',
      targetLanguage: 'es',
    });
    expect(resolveTranslationLanguages(directions, 'es', null, null)).toEqual({
      sourceLanguage: 'es',
      targetLanguage: 'en',
    });
  });

  it('reports no pair rather than guessing when nothing is cataloged', () => {
    const directions = catalogTranslationDirections([]);

    expect(resolveTranslationLanguages(directions, 'en', 'en', 'es')).toBeNull();
  });
});
