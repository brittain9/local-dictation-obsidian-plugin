import { describe, expect, it } from 'vitest';

import {
  isSupportedTranslationPair,
  isTranslationLanguage,
  normalizeTranslationLanguage,
  resolveTranslationEngine,
  TRANSLATION_LANGUAGES,
  translationTargetsFor,
} from '../src/translation/languages';

describe('translation language capabilities', () => {
  it('exposes every HY-MT language through one canonical translation-language list', () => {
    expect(TRANSLATION_LANGUAGES).toHaveLength(38);
    expect(TRANSLATION_LANGUAGES).toEqual(
      expect.arrayContaining(['zh', 'zh-Hant', 'yue', 'bo', 'ug', 'en', 'ja']),
    );
    expect(normalizeTranslationLanguage(' ZH-hant ')).toBe('zh-Hant');
    expect(isTranslationLanguage('zh-Hant')).toBe(true);
  });

  it('allows HY-MT to translate every non-identity pair without widening Bergamot', () => {
    expect(translationTargetsFor('ja', 'tencent_hy_mt')).toHaveLength(37);
    expect(isSupportedTranslationPair('ja', 'ko', 'tencent_hy_mt')).toBe(true);
    expect(isSupportedTranslationPair('ja', 'ko', 'bergamot')).toBe(false);
    expect(isSupportedTranslationPair('ja', 'en', 'bergamot')).toBe(true);
  });

  it('keeps the preferred engine when compatible and selects Natural otherwise', () => {
    expect(resolveTranslationEngine('bergamot', 'en', 'es')).toBe('bergamot');
    expect(resolveTranslationEngine('bergamot', 'ja', 'ko')).toBe('tencent_hy_mt');
    expect(resolveTranslationEngine('tencent_hy_mt', 'en', 'es')).toBe('tencent_hy_mt');
  });
});
