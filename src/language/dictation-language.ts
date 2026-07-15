import type { CatalogModelRecord, LanguageSupport } from '../models/model-management-types';

export const DICTATION_LANGUAGE_OPTIONS = [
  { label: 'Auto detect', value: 'auto' },
  { label: 'English', value: 'en' },
  { label: 'Spanish', value: 'es' },
  { label: 'German', value: 'de' },
  { label: 'French', value: 'fr' },
  { label: 'Portuguese', value: 'pt' },
  { label: 'Italian', value: 'it' },
  { label: 'Dutch', value: 'nl' },
  { label: 'Japanese', value: 'ja' },
] as const;

export type DictationLanguage = (typeof DICTATION_LANGUAGE_OPTIONS)[number]['value'];

export const DEFAULT_DICTATION_LANGUAGE: DictationLanguage = 'en';

export function dictationLanguageLabel(language: DictationLanguage): string {
  return DICTATION_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? language;
}

export function isDictationLanguage(value: unknown): value is DictationLanguage {
  return DICTATION_LANGUAGE_OPTIONS.some((option) => option.value === value);
}

export function languageSupportIncludes(
  support: LanguageSupport,
  language: DictationLanguage,
  supportsAutomaticLanguageDetection = false,
): boolean {
  if (language === 'auto') return supportsAutomaticLanguageDetection;
  switch (support.kind) {
    case 'all':
      return true;
    case 'english_only':
      return language === 'en';
    case 'list':
      return support.tags.includes(language);
    case 'unknown':
      return language === 'en';
  }
}

export function supportedDictationLanguageOptions(
  support: LanguageSupport,
  supportsAutomaticLanguageDetection = false,
) {
  return DICTATION_LANGUAGE_OPTIONS.filter((option) =>
    languageSupportIncludes(support, option.value, supportsAutomaticLanguageDetection),
  );
}

export function catalogModelSupportsLanguage(
  model: Pick<CatalogModelRecord, 'languageTags' | 'supportsAutomaticLanguageDetection'>,
  language: DictationLanguage,
): boolean {
  return language === 'auto'
    ? model.supportsAutomaticLanguageDetection
    : model.languageTags.includes(language);
}
