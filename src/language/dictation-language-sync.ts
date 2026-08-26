import type { PluginSettings } from '../settings/plugin-settings';
import { resolveBaseLanguageTag } from '../shared/i18n';
import { isRecord } from '../shared/type-guards';
import { isDictationLanguage } from './dictation-language';

export interface DictationLanguageSyncResult {
  settings: PluginSettings;
  shouldPersist: boolean;
}

export function syncDictationLanguageWithObsidian(
  settings: PluginSettings,
  persistedData: unknown,
  obsidianLanguage: string,
): DictationLanguageSyncResult {
  const currentLanguage = resolveBaseLanguageTag(obsidianLanguage);
  const raw = isRecord(persistedData) ? persistedData : {};
  const hasPersistedDictationLanguage = isDictationLanguage(raw.dictationLanguage);
  const isSupportedLanguage = currentLanguage !== 'auto' && isDictationLanguage(currentLanguage);

  if (settings.lastObsidianLanguage === currentLanguage) {
    return { settings, shouldPersist: false };
  }

  const dictationLanguage =
    (!hasPersistedDictationLanguage || settings.lastObsidianLanguage !== null) &&
    isSupportedLanguage
      ? currentLanguage
      : settings.dictationLanguage;

  return {
    settings: {
      ...settings,
      dictationLanguage,
      lastObsidianLanguage: currentLanguage,
    },
    shouldPersist: true,
  };
}
