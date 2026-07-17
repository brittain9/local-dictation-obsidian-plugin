import { describe, expect, it } from 'vitest';

import {
  catalogModelSupportsLanguage,
  DICTATION_LANGUAGE_OPTIONS,
  languageSupportIncludes,
  supportedDictationLanguageOptions,
} from '../src/language/dictation-language';

describe('dictation language eligibility', () => {
  it('keeps unknown and English-only models on the safe English default', () => {
    expect(supportedDictationLanguageOptions({ kind: 'unknown' })).toEqual([
      { label: 'English', value: 'en' },
    ]);
    expect(languageSupportIncludes({ kind: 'english_only' }, 'ja')).toBe(false);
  });

  it('shows only the verified intersection advertised by the exact model', () => {
    expect(
      supportedDictationLanguageOptions({ kind: 'list', tags: ['en', 'ja', 'xx'] }, true),
    ).toEqual([
      { label: 'Auto detect', value: 'auto' },
      { label: 'English', value: 'en' },
      { label: 'Japanese', value: 'ja' },
    ]);
  });

  it('bounds all-language adapters to the product language matrix', () => {
    expect(supportedDictationLanguageOptions({ kind: 'all' })).toEqual(
      DICTATION_LANGUAGE_OPTIONS.filter((option) => option.value !== 'auto'),
    );
    expect(supportedDictationLanguageOptions({ kind: 'all' }, true)).toEqual(
      DICTATION_LANGUAGE_OPTIONS,
    );
  });

  it('keeps exact model language tags separate from automatic detection', () => {
    const model = {
      languageTags: ['en', 'ja'],
      supportsAutomaticLanguageDetection: true,
    };
    expect(catalogModelSupportsLanguage(model, 'ja')).toBe(true);
    expect(catalogModelSupportsLanguage(model, 'auto')).toBe(true);
    expect(
      catalogModelSupportsLanguage({ ...model, supportsAutomaticLanguageDetection: false }, 'auto'),
    ).toBe(false);
  });
});
