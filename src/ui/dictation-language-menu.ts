import { type DictationLanguage, dictationLanguageLabel } from '../language/dictation-language';
import { t } from '../shared/i18n';

export interface DictationLanguageMenuItem {
  disabled: boolean;
  language: DictationLanguage;
  label: string;
  selected: boolean;
}

export function buildDictationLanguageMenuItems(
  languages: readonly DictationLanguage[],
  current: DictationLanguage,
  disabled: boolean,
): DictationLanguageMenuItem[] {
  const available = [...languages];
  if (!available.includes(current)) available.push(current);
  return available.map((language) => ({
    disabled,
    language,
    label: languages.includes(language)
      ? dictationLanguageLabel(language)
      : t('settings.dictationLanguage.unsupported', {
          language: dictationLanguageLabel(language),
        }),
    selected: language === current,
  }));
}
