import type {
  CatalogModelRecord,
  InstalledModelRecord,
  ModelCatalogRecord,
} from '../models/model-management-types';

export const TRANSLATION_LANGUAGES = [
  'zh',
  'en',
  'fr',
  'pt',
  'es',
  'ja',
  'tr',
  'ru',
  'ar',
  'ko',
  'th',
  'it',
  'de',
  'vi',
  'ms',
  'id',
  'tl',
  'hi',
  'zh-Hant',
  'pl',
  'cs',
  'nl',
  'km',
  'my',
  'fa',
  'gu',
  'ur',
  'te',
  'mr',
  'he',
  'bn',
  'ta',
  'uk',
  'bo',
  'kk',
  'mn',
  'ug',
  'yue',
] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

export const TRANSLATION_ENGINE_IDS = ['bergamot', 'tencent_hy_mt'] as const;

export type TranslationEngineId = (typeof TRANSLATION_ENGINE_IDS)[number];

export function normalizeTranslationEngine(value: unknown): TranslationEngineId {
  return value === 'tencent_hy_mt' ? 'tencent_hy_mt' : 'bergamot';
}

const LANGUAGE_LABELS: Readonly<Record<TranslationLanguage, string>> = {
  ar: 'العربية',
  bn: 'বাংলা',
  bo: 'བོད་སྐད་',
  cs: 'Čeština',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fa: 'فارسی',
  fr: 'Français',
  gu: 'ગુજરાતી',
  he: 'עברית',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  ja: '日本語',
  kk: 'Қазақша',
  km: 'ខ្មែរ',
  ko: '한국어',
  mn: 'Монгол',
  mr: 'मराठी',
  ms: 'Bahasa Melayu',
  my: 'မြန်မာဘာသာ',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  ru: 'Русский',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  th: 'ไทย',
  tl: 'Filipino',
  tr: 'Türkçe',
  ug: 'ئۇيغۇرچە',
  uk: 'Українська',
  ur: 'اردو',
  vi: 'Tiếng Việt',
  yue: '粵語',
  zh: '中文',
  'zh-Hant': '繁體中文',
};

export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return typeof value === 'string' && (TRANSLATION_LANGUAGES as readonly string[]).includes(value);
}

export function normalizeTranslationLanguage(value: unknown): TranslationLanguage | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return TRANSLATION_LANGUAGES.find((language) => language.toLowerCase() === normalized) ?? null;
}

export function translationLanguageLabel(language: TranslationLanguage): string {
  return LANGUAGE_LABELS[language];
}

export function isSupportedTranslationPair(
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
  engine: TranslationEngineId = 'bergamot',
): boolean {
  if (sourceLanguage === targetLanguage) return false;
  return engine === 'tencent_hy_mt' || sourceLanguage === 'en' || targetLanguage === 'en';
}

export function translationTargetsFor(
  sourceLanguage: TranslationLanguage,
  engine: TranslationEngineId = 'bergamot',
): TranslationLanguage[] {
  return TRANSLATION_LANGUAGES.filter((language) =>
    isSupportedTranslationPair(sourceLanguage, language, engine),
  );
}

export function resolveTranslationEngine(
  preferredEngine: TranslationEngineId,
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): TranslationEngineId {
  return isSupportedTranslationPair(sourceLanguage, targetLanguage, preferredEngine)
    ? preferredEngine
    : 'tencent_hy_mt';
}

export function resolveTranslationTarget(
  sourceLanguage: TranslationLanguage,
  preferredTarget: TranslationLanguage | null,
  engine: TranslationEngineId = 'bergamot',
): TranslationLanguage {
  return preferredTarget !== null &&
    isSupportedTranslationPair(sourceLanguage, preferredTarget, engine)
    ? preferredTarget
    : sourceLanguage === 'en'
      ? 'es'
      : 'en';
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
  engine: TranslationEngineId = 'bergamot',
): InstalledTranslationModel | null {
  const familyId = engine === 'bergamot' ? 'firefox_translations' : 'tencent_hy_mt';
  const catalogModel = state.models.find(
    (model) =>
      model.task === 'translation' &&
      model.familyId === familyId &&
      catalogSupportsPair(model, sourceLanguage, targetLanguage),
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

export function catalogSupportsPair(
  model: Pick<CatalogModelRecord, 'translationSupport'>,
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): boolean {
  const support = model.translationSupport;
  if (support === undefined || sourceLanguage === targetLanguage) return false;
  if (support.kind === 'all_to_all') {
    return support.languages.includes(sourceLanguage) && support.languages.includes(targetLanguage);
  }
  return support.pairs.some(
    (pair) => pair.source === sourceLanguage && pair.target === targetLanguage,
  );
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

export function resolveTranslationLanguages(
  dictationLanguage: string,
  preferredSource: TranslationLanguage | null,
  preferredTarget: TranslationLanguage | null,
  engine: TranslationEngineId = 'bergamot',
): TranslationLanguagePair {
  const defaults = defaultTranslationLanguages(dictationLanguage);
  const sourceLanguage = preferredSource ?? defaults.sourceLanguage;
  const targetLanguage = resolveTranslationTarget(sourceLanguage, preferredTarget, engine);
  return { sourceLanguage, targetLanguage };
}
