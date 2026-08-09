import { describe, expect, it } from 'vitest';

import {
  catalogModelSupportsLanguage,
  DICTATION_LANGUAGE_OPTIONS,
  dictationLanguageOptionsForSelection,
  languageFeatureCoverage,
  languageSupportIncludes,
  supportedDictationLanguageOptions,
} from '../src/language/dictation-language';

describe('dictation language eligibility', () => {
  it('presents Serbian as one option', () => {
    expect(DICTATION_LANGUAGE_OPTIONS.filter((option) => option.value === 'sr')).toEqual([
      { label: 'Српски', value: 'sr' },
    ]);
  });

  it('keeps unknown and English-only models on the safe English default', () => {
    expect(supportedDictationLanguageOptions({ kind: 'unknown' })).toEqual([
      { label: 'English', value: 'en' },
    ]);
    expect(languageSupportIncludes({ kind: 'english_only' }, 'ja')).toBe(false);
  });

  it('offers every product language before a transcription model is selected', () => {
    expect(dictationLanguageOptionsForSelection(false, { kind: 'unknown' })).toEqual(
      DICTATION_LANGUAGE_OPTIONS,
    );
  });

  it('continues to restrict languages to verified capabilities after selection', () => {
    expect(
      dictationLanguageOptionsForSelection(true, { kind: 'list', tags: ['en', 'hr'] }, false),
    ).toEqual([
      { label: 'English', value: 'en' },
      { label: 'Hrvatski', value: 'hr' },
    ]);
  });

  it('shows only the verified intersection advertised by the exact model', () => {
    expect(
      supportedDictationLanguageOptions({ kind: 'list', tags: ['en', 'ja', 'xx'] }, true),
    ).toEqual([
      { label: 'Auto detect', value: 'auto' },
      { label: 'English', value: 'en' },
      { label: '日本語', value: 'ja' },
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

  it('reports the adjacent features a dictation language does not reach', () => {
    const models = [
      { languageTags: ['en', 'hr', 'sr'], task: 'stt' as const },
      { languageTags: ['en', 'hr'], task: 'tts' as const },
      {
        languageTags: ['en', 'es'],
        task: 'translation' as const,
        translationPairs: [
          { source: 'en', target: 'es' },
          { source: 'es', target: 'en' },
        ],
      },
    ];

    expect(languageFeatureCoverage(models, 'es')).toEqual({ readAloud: false, translation: true });
    // Croatian is speakable but has no released translation direction.
    expect(languageFeatureCoverage(models, 'hr')).toEqual({ readAloud: true, translation: false });
    // Serbian is transcription only, which is what Settings has to say out loud.
    expect(languageFeatureCoverage(models, 'sr')).toEqual({ readAloud: false, translation: false });
    expect(languageFeatureCoverage(models, 'auto')).toEqual({ readAloud: true, translation: true });
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
