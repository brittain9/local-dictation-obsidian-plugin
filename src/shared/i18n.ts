import { getLanguage } from 'obsidian';

import { catalogs, type TranslationCatalog } from '../locales';
import { en, type TranslationKey } from '../locales/en';

export type { TranslationCatalog, TranslationKey };

export type TranslationParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/gu;

const locale = resolveLocale(getLanguage());

export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = catalogs[locale]?.[key] ?? en[key];

  if (params === undefined) return template;

  return template.replace(PLACEHOLDER_PATTERN, (placeholder, name: string) => {
    if (!Object.hasOwn(params, name)) return placeholder;
    return String(params[name]);
  });
}

export function tPlural(
  count: number,
  keys: Readonly<{ one: TranslationKey; other: TranslationKey }>,
  params?: TranslationParams,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  return t(category === 'one' ? keys.one : keys.other, params);
}

export function resolveLocale(language: string): string {
  const baseLanguage = language.trim().toLowerCase().split(/[-_]/u, 1)[0];
  return baseLanguage !== undefined && catalogs[baseLanguage] !== undefined ? baseLanguage : 'en';
}
