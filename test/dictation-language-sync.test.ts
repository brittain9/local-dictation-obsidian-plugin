import { describe, expect, it } from 'vitest';

import { syncDictationLanguageWithObsidian } from '../src/language/dictation-language-sync';
import { resolvePluginSettings } from '../src/settings/plugin-settings';

describe('dictation language sync', () => {
  it('seeds a new installation from Obsidian’s supported regional UI language', () => {
    const result = syncDictationLanguageWithObsidian(
      resolvePluginSettings(undefined),
      undefined,
      'ES_mx',
    );

    expect(result).toMatchObject({
      settings: {
        dictationLanguage: 'es',
        lastObsidianLanguage: 'es',
      },
      shouldPersist: true,
    });
  });

  it('remembers an unsupported UI language without changing the new-install default', () => {
    const result = syncDictationLanguageWithObsidian(
      resolvePluginSettings(undefined),
      undefined,
      'ru-RU',
    );

    expect(result).toMatchObject({
      settings: {
        dictationLanguage: 'en',
        lastObsidianLanguage: 'ru',
      },
      shouldPersist: true,
    });
  });

  it('preserves an existing manual choice while establishing the migration baseline', () => {
    const persisted = { dictationLanguage: 'ja' };
    const result = syncDictationLanguageWithObsidian(
      resolvePluginSettings(persisted),
      persisted,
      'es',
    );

    expect(result).toMatchObject({
      settings: {
        dictationLanguage: 'ja',
        lastObsidianLanguage: 'es',
      },
      shouldPersist: true,
    });
  });

  it('leaves a manual choice untouched while the remembered UI language is unchanged', () => {
    const persisted = {
      dictationLanguage: 'en',
      lastObsidianLanguage: 'es',
      schemaVersion: 5,
    };
    const settings = resolvePluginSettings(persisted);

    expect(syncDictationLanguageWithObsidian(settings, persisted, 'es-MX')).toEqual({
      settings,
      shouldPersist: false,
    });
  });

  it('syncs once when the remembered UI language changes to a supported language', () => {
    const persisted = {
      dictationLanguage: 'ja',
      lastObsidianLanguage: 'es',
      schemaVersion: 5,
    };
    const result = syncDictationLanguageWithObsidian(
      resolvePluginSettings(persisted),
      persisted,
      'DE_at',
    );

    expect(result).toMatchObject({
      settings: {
        dictationLanguage: 'de',
        lastObsidianLanguage: 'de',
      },
      shouldPersist: true,
    });
  });

  it('remembers an unsupported UI language change without changing dictation language', () => {
    const persisted = {
      dictationLanguage: 'ja',
      lastObsidianLanguage: 'es',
      schemaVersion: 5,
    };
    const result = syncDictationLanguageWithObsidian(
      resolvePluginSettings(persisted),
      persisted,
      'ru',
    );

    expect(result).toMatchObject({
      settings: {
        dictationLanguage: 'ja',
        lastObsidianLanguage: 'ru',
      },
      shouldPersist: true,
    });
  });

  it('syncs after moving from a remembered unsupported UI language to a supported one', () => {
    const persisted = {
      dictationLanguage: 'ja',
      lastObsidianLanguage: 'ru',
      schemaVersion: 5,
    };
    const result = syncDictationLanguageWithObsidian(
      resolvePluginSettings(persisted),
      persisted,
      'pt-BR',
    );

    expect(result.settings).toMatchObject({
      dictationLanguage: 'pt',
      lastObsidianLanguage: 'pt',
    });
  });
});
