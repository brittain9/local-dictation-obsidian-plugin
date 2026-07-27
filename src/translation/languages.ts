import type {
  CatalogModelRecord,
  InstalledModelRecord,
  ModelCatalogRecord,
} from '../models/model-management-types';

export const TRANSLATION_LANGUAGES = ['en', 'es', 'de', 'fr', 'pt', 'it', 'nl', 'ja'] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

const LANGUAGE_LABELS: Readonly<Record<TranslationLanguage, string>> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  ja: '日本語',
  nl: 'Nederlands',
  pt: 'Português',
};

export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return (
    typeof value === 'string' &&
    value === value.toLowerCase() &&
    (TRANSLATION_LANGUAGES as readonly string[]).includes(value)
  );
}

export function normalizeTranslationLanguage(value: unknown): TranslationLanguage | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return isTranslationLanguage(normalized) ? normalized : null;
}

export function translationLanguageLabel(language: TranslationLanguage): string {
  return LANGUAGE_LABELS[language];
}

export function isSupportedTranslationPair(
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): boolean {
  return sourceLanguage !== targetLanguage && (sourceLanguage === 'en' || targetLanguage === 'en');
}

export interface InstalledTranslationModel {
  catalogModel: CatalogModelRecord;
  installedModel: InstalledModelRecord;
}

export function findInstalledTranslationModel(
  state: Pick<ModelCatalogRecord, 'models'> & {
    installedModels: readonly InstalledModelRecord[];
  },
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): InstalledTranslationModel | null {
  const catalogModel = state.models.find(
    (model) =>
      model.task === 'translation' &&
      model.translationPairs?.some(
        (pair) => pair.source === sourceLanguage && pair.target === targetLanguage,
      ) === true,
  );
  if (catalogModel === undefined) return null;

  const installedModel = state.installedModels.find(
    (installed) =>
      installed.runtimeId === catalogModel.runtimeId &&
      installed.familyId === catalogModel.familyId &&
      installed.modelId === catalogModel.modelId,
  );
  return installedModel === undefined ? null : { catalogModel, installedModel };
}

export function defaultTranslationLanguages(dictationLanguage: string): {
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
} {
  const sourceLanguage = isTranslationLanguage(dictationLanguage) ? dictationLanguage : 'en';
  return sourceLanguage === 'en'
    ? { sourceLanguage, targetLanguage: 'es' }
    : { sourceLanguage, targetLanguage: 'en' };
}
