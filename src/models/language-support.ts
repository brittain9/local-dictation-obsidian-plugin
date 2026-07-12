export const CURRENT_LANGUAGE_SUPPORT_NOTICE =
  'Local Dictation currently supports English dictation only. Some upstream model families support additional languages, but this app does not enable them yet.';

export function describeCatalogLanguageSupport(languageTags: readonly string[]): string {
  const normalizedTags = [...new Set(languageTags.map(normalizeLanguageTag).filter(isPresent))];
  const englishTags = normalizedTags.filter(isEnglishLanguageTag);

  if (normalizedTags.length === 0) {
    return 'Language support unverified';
  }

  if (englishTags.length === 0) {
    return 'Not available for English';
  }

  return englishTags.length === normalizedTags.length ? 'English only' : 'Includes English';
}

function normalizeLanguageTag(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isEnglishLanguageTag(value: string): boolean {
  return value === 'en' || value.startsWith('en-');
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
