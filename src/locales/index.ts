import { de } from './de';
import { en, type TranslationKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { hr } from './hr';
import { it } from './it';
import { ja } from './ja';
import { nl } from './nl';
import { pt } from './pt';
import { zh } from './zh';

export type TranslationCatalog = Partial<Record<TranslationKey, string>>;

export const catalogs: Readonly<Record<string, TranslationCatalog>> = {
  de,
  en,
  es,
  fr,
  hr,
  it,
  ja,
  nl,
  pt,
  zh,
};
