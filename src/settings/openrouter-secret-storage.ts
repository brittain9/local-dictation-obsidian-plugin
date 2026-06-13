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
  secretStorage: Pick<SecretStorage, 'setSecret'>,
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
    secretStorage.setSecret(secretId, legacyApiKey);
    settings = { ...settings, llmOpenRouterSecretId: secretId };
  }

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
