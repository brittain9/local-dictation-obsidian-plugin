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

/// The directed pairs the catalog ships a model for, keyed `source>target`.
///
/// Mozilla publishes the two halves of a pair independently, so availability is
/// per direction and cannot be inferred from a language list. Deriving the set
/// from `translationPairs` means the UI can only offer a direction some model
/// actually serves.
export type TranslationDirections = ReadonlySet<string>;

function directionKey(
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): string {
  return `${sourceLanguage}>${targetLanguage}`;
}

export function catalogTranslationDirections(
  models: readonly Pick<CatalogModelRecord, 'task' | 'translationPairs'>[],
): TranslationDirections {
  const directions = new Set<string>();
  for (const model of models) {
    if (model.task !== 'translation') continue;
    for (const pair of model.translationPairs ?? []) {
      if (!isTranslationLanguage(pair.source) || !isTranslationLanguage(pair.target)) continue;
      directions.add(directionKey(pair.source, pair.target));
    }
  }
  return directions;
}

export function isSupportedTranslationPair(
  directions: TranslationDirections,
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): boolean {
  return (
    sourceLanguage !== targetLanguage &&
    directions.has(directionKey(sourceLanguage, targetLanguage))
  );
}

export function translationTargetsFor(
  directions: TranslationDirections,
  sourceLanguage: TranslationLanguage,
): TranslationLanguage[] {
  return TRANSLATION_LANGUAGES.filter((language) =>
    isSupportedTranslationPair(directions, sourceLanguage, language),
  );
}

export function translationSourcesFor(directions: TranslationDirections): TranslationLanguage[] {
  return TRANSLATION_LANGUAGES.filter(
    (language) => translationTargetsFor(directions, language).length > 0,
  );
}

export function resolveTranslationTarget(
  directions: TranslationDirections,
  sourceLanguage: TranslationLanguage,
  preferredTarget: TranslationLanguage | null,
): TranslationLanguage | null {
  if (
    preferredTarget !== null &&
    isSupportedTranslationPair(directions, sourceLanguage, preferredTarget)
  ) {
    return preferredTarget;
  }
  // `TRANSLATION_LANGUAGES` leads with English, so a non-English source defaults
  // back to English and English defaults to the first other language available.
  return translationTargetsFor(directions, sourceLanguage)[0] ?? null;
}

export interface InstalledTranslationModel {
  catalogModel: CatalogModelRecord;
  installedModel: InstalledModelRecord;
}

export interface TranslationLanguagePair {
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
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

/// Returns null when no cataloged model serves any direction, which is the only
/// honest answer: there is no pair to preselect and nothing to offer.
export function resolveTranslationLanguages(
  directions: TranslationDirections,
  dictationLanguage: string,
  preferredSource: TranslationLanguage | null,
  preferredTarget: TranslationLanguage | null,
): TranslationLanguagePair | null {
  const sources = translationSourcesFor(directions);
  const [firstSource] = sources;
  if (firstSource === undefined) return null;

  const preferred =
    preferredSource ?? (isTranslationLanguage(dictationLanguage) ? dictationLanguage : null);
  const sourceLanguage =
    preferred !== null && sources.includes(preferred)
      ? preferred
      : sources.includes('en')
        ? 'en'
        : firstSource;
  const targetLanguage = resolveTranslationTarget(directions, sourceLanguage, preferredTarget);
  return targetLanguage === null ? null : { sourceLanguage, targetLanguage };
}
