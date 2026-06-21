import type { SecretStorage } from 'obsidian';

import { isRecord } from '../shared/type-guards';
import { type PluginSettings, resolvePluginSettings } from './plugin-settings';

export const DEFAULT_OPENROUTER_SECRET_ID = 'local-dictation-openrouter-api-key';

const LEGACY_OPENROUTER_API_KEY = 'llmOpenRouterApiKey';

export interface LoadedPluginSettings {
  settings: PluginSettings;
  shouldPersist: boolean;
}

export function loadPluginSettings(
  data: unknown,
  secretStorage: Pick<SecretStorage, 'getSecret' | 'setSecret'>,
): LoadedPluginSettings {
  const raw = isRecord(data) ? data : {};
  let settings = resolvePluginSettings(raw);

  if (!Object.hasOwn(raw, LEGACY_OPENROUTER_API_KEY)) {
    return { settings, shouldPersist: false };
  }

  const legacyApiKey =
    typeof raw[LEGACY_OPENROUTER_API_KEY] === 'string' ? raw[LEGACY_OPENROUTER_API_KEY].trim() : '';

  if (legacyApiKey.length > 0) {
    const secretId = settings.llmOpenRouterSecretId || DEFAULT_OPENROUTER_SECRET_ID;
    // Seed Secret Storage only when nothing is stored at this ID yet. A synced
    // or restored data.json can reintroduce the legacy plaintext field after
    // the user has entered a newer key through the UI; writing unconditionally
    // would clobber that newer key with the stale legacy value on every load.
    const hasStoredSecret = (secretStorage.getSecret(secretId)?.trim() ?? '').length > 0;
    if (!hasStoredSecret) {
      secretStorage.setSecret(secretId, legacyApiKey);
    }
    settings = { ...settings, llmOpenRouterSecretId: secretId };
  }

  // Persist regardless of whether the secret was (re)written so the stale
  // plaintext field is always stripped from data.json.
  return { settings, shouldPersist: true };
}

export function getOpenRouterApiKey(
  settings: PluginSettings,
  secretStorage: Pick<SecretStorage, 'getSecret'>,
): string {
  if (settings.llmOpenRouterSecretId.length === 0) {
    return '';
  }
  return secretStorage.getSecret(settings.llmOpenRouterSecretId)?.trim() ?? '';
}
