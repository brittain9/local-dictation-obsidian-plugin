import type { CatalogModelRecord, LanguageSupport } from '../models/model-management-types';
import { t } from '../shared/i18n';

export const DICTATION_LANGUAGE_OPTIONS = [
  { label: t('settings.dictationLanguage.autoDetect'), value: 'auto' },
  { label: 'English', value: 'en' },
  { label: 'Español', value: 'es' },
  { label: 'Deutsch', value: 'de' },
  { label: 'Français', value: 'fr' },
  { label: 'Português', value: 'pt' },
  { label: 'Italiano', value: 'it' },
  { label: 'Nederlands', value: 'nl' },
  { label: '日本語', value: 'ja' },
  { label: 'Hrvatski', value: 'hr' },
  { label: 'Српски', value: 'sr' },
] as const;

export type DictationLanguage = (typeof DICTATION_LANGUAGE_OPTIONS)[number]['value'];

export const DEFAULT_DICTATION_LANGUAGE: DictationLanguage = 'en';

export function dictationLanguageLabel(language: DictationLanguage): string {
  return DICTATION_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? language;
}

export function formatCatalogLanguageLabel(tag: string): string {
  const known = DICTATION_LANGUAGE_OPTIONS.find(
    (option) => option.value !== 'auto' && option.value === tag,
  );
  if (known !== undefined) return known.label;

  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag.toUpperCase();
  } catch {
    return tag.toUpperCase();
  }
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

export interface LanguageFeatureCoverage {
  readAloud: boolean;
  translation: boolean;
}

/// Coverage is per model, so a language can be transcribable without being
/// speakable or translatable — Serbian ships on Whisper alone. Settings reads
/// this to say so up front instead of letting the user discover it by failing.
export function languageFeatureCoverage(
  models: readonly Pick<CatalogModelRecord, 'languageTags' | 'task' | 'translationPairs'>[],
  language: DictationLanguage,
): LanguageFeatureCoverage {
  // Automatic detection has no single language to report on.
  if (language === 'auto') return { readAloud: true, translation: true };
  return {
    readAloud: models.some(
      (model) => model.task === 'tts' && model.languageTags.includes(language),
    ),
    translation: models.some(
      (model) =>
        model.task === 'translation' &&
        (model.translationPairs ?? []).some(
          (pair) => pair.source === language || pair.target === language,
        ),
    ),
  };
}

export function catalogModelSupportsLanguage(
  model: Pick<CatalogModelRecord, 'languageTags' | 'supportsAutomaticLanguageDetection'>,
  language: DictationLanguage,
): boolean {
  return language === 'auto'
    ? model.supportsAutomaticLanguageDetection
    : model.languageTags.includes(language);
}
