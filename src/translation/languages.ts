import type {
  CatalogModelRecord,
  InstalledModelRecord,
  ModelCatalogRecord,
} from '../models/model-management-types';
import { translationInstallRequirement } from './translation-packs';

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
  'bg',
  'ca',
  'da',
  'el',
  'et',
  'eu',
  'fi',
  'gl',
  'hu',
  'is',
  'kn',
  'lt',
  'lv',
  'ml',
  'nb',
  'ro',
  'sk',
  'sl',
  'sv',
] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

type TranslationModelSupport = Pick<CatalogModelRecord, 'translationSupport'>;

const LANGUAGE_LABELS: Readonly<Record<TranslationLanguage, string>> = {
  ar: 'العربية',
  bn: 'বাংলা',
  bo: 'བོད་སྐད་',
  bg: 'Български',
  ca: 'Català',
  cs: 'Čeština',
  da: 'Dansk',
  de: 'Deutsch',
  en: 'English',
  el: 'Ελληνικά',
  es: 'Español',
  et: 'Eesti',
  eu: 'Euskara',
  fa: 'فارسی',
  fi: 'Suomi',
  fr: 'Français',
  gl: 'Galego',
  gu: 'ગુજરાતી',
  he: 'עברית',
  hi: 'हिन्दी',
  hu: 'Magyar',
  id: 'Bahasa Indonesia',
  is: 'Íslenska',
  it: 'Italiano',
  ja: '日本語',
  kk: 'Қазақша',
  km: 'ខ្មែរ',
  kn: 'ಕನ್ನಡ',
  ko: '한국어',
  mn: 'Монгол',
  ml: 'മലയാളം',
  mr: 'मराठी',
  ms: 'Bahasa Melayu',
  my: 'မြန်မာဘာသာ',
  nl: 'Nederlands',
  nb: 'Norsk bokmål',
  pl: 'Polski',
  pt: 'Português',
  ro: 'Română',
  ru: 'Русский',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  sv: 'Svenska',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  th: 'ไทย',
  tl: 'Filipino',
  tr: 'Türkçe',
  ug: 'ئۇيغۇرچە',
  uk: 'Українська',
  ur: 'اردو',
  vi: 'Tiếng Việt',
  lt: 'Lietuvių',
  lv: 'Latviešu',
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
  model: TranslationModelSupport | null,
): boolean {
  return (
    sourceLanguage !== targetLanguage &&
    (model === null || catalogSupportsPair(model, sourceLanguage, targetLanguage))
  );
}

export function translationTargetsFor(
  sourceLanguage: TranslationLanguage,
  model: TranslationModelSupport | null,
): TranslationLanguage[] {
  return TRANSLATION_LANGUAGES.filter((language) =>
    isSupportedTranslationPair(sourceLanguage, language, model),
  );
}

export function translationSourcesFor(
  model: TranslationModelSupport | null,
): TranslationLanguage[] {
  return TRANSLATION_LANGUAGES.filter((language) => modelSupportsSourceLanguage(model, language));
}

export function resolveTranslationTarget(
  sourceLanguage: TranslationLanguage,
  preferredTarget: TranslationLanguage | null,
  model: TranslationModelSupport | null,
): TranslationLanguage {
  if (
    preferredTarget !== null &&
    isSupportedTranslationPair(sourceLanguage, preferredTarget, model)
  ) {
    return preferredTarget;
  }
  if (model === null) return sourceLanguage === 'en' ? 'es' : 'en';
  return translationTargetsFor(sourceLanguage, model)[0] ?? (sourceLanguage === 'en' ? 'es' : 'en');
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
  selectedModel: Pick<CatalogModelRecord, 'runtimeId' | 'familyId' | 'modelId'>,
): InstalledTranslationModel | null {
  const catalogModel = state.models.find(
    (candidate) =>
      candidate.task === 'translation' &&
      candidate.runtimeId === selectedModel.runtimeId &&
      candidate.familyId === selectedModel.familyId &&
      candidate.modelId === selectedModel.modelId &&
      catalogSupportsPair(candidate, sourceLanguage, targetLanguage),
  );
  if (catalogModel === undefined) return null;

  const installedModel = state.installedModels.find(
    (installed) =>
      installed.runtimeId === catalogModel.runtimeId &&
      installed.familyId === catalogModel.familyId &&
      installed.modelId === catalogModel.modelId,
  );
  if (installedModel === undefined) return null;
  return translationInstallRequirement(catalogModel, installedModel, sourceLanguage, targetLanguage)
    .kind === 'ready'
    ? { catalogModel, installedModel }
    : null;
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
  model: TranslationModelSupport | null,
): TranslationLanguagePair {
  const defaults = defaultTranslationLanguages(dictationLanguage);
  const sourceLanguage =
    preferredSource !== null && modelSupportsSourceLanguage(model, preferredSource)
      ? preferredSource
      : modelSupportsSourceLanguage(model, defaults.sourceLanguage)
        ? defaults.sourceLanguage
        : (translationSourcesFor(model)[0] ?? defaults.sourceLanguage);
  const targetLanguage = resolveTranslationTarget(sourceLanguage, preferredTarget, model);
  return { sourceLanguage, targetLanguage };
}

function modelSupportsSourceLanguage(
  model: TranslationModelSupport | null,
  language: TranslationLanguage,
): boolean {
  if (model === null) return true;
  if (model.translationSupport === undefined) return false;
  if (model.translationSupport.kind === 'all_to_all') {
    return model.translationSupport.languages.includes(language);
  }
  return model.translationSupport.pairs.some((pair) => pair.source === language);
}
