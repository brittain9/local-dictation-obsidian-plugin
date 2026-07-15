import { describe, expect, it } from 'vitest';

import {
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
      supportedDictationLanguageOptions({ kind: 'list', tags: ['auto', 'en', 'ja', 'xx'] }),
    ).toEqual([
      { label: 'Auto detect', value: 'auto' },
      { label: 'English', value: 'en' },
      { label: 'Japanese', value: 'ja' },
    ]);
  });

  it('bounds all-language adapters to the product language matrix', () => {
    expect(supportedDictationLanguageOptions({ kind: 'all' })).toEqual(DICTATION_LANGUAGE_OPTIONS);
  });
});
