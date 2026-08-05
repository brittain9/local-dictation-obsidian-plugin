import type { SecretStorage } from 'obsidian';

import type { LlmProviderId } from '../llm/provider';
import { isRecord } from '../shared/type-guards';
import {
  DEFAULT_OPENAI_COMPATIBLE_SECRET_ID,
  type PluginSettings,
  resolvePluginSettings,
} from './plugin-settings';

export const DEFAULT_OPENROUTER_SECRET_ID = 'local-dictation-openrouter-api-key';
export { DEFAULT_OPENAI_COMPATIBLE_SECRET_ID };

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
  let settings = resolvePluginSettings(data);
  const needsSchemaMigration =
    data !== null && data !== undefined && (!isRecord(data) || data.schemaVersion !== 7);

  if (!Object.hasOwn(raw, LEGACY_OPENROUTER_API_KEY)) {
    return { settings, shouldPersist: needsSchemaMigration };
  }

  const legacyApiKey =
    typeof raw[LEGACY_OPENROUTER_API_KEY] === 'string' ? raw[LEGACY_OPENROUTER_API_KEY].trim() : '';

  if (legacyApiKey.length > 0) {
    const secretId =
      settings.llmProviderConfigurations.openrouter.secretId || DEFAULT_OPENROUTER_SECRET_ID;
    // Seed Secret Storage only when nothing is stored at this ID yet. A synced
    // or restored data.json can reintroduce the legacy plaintext field after
    // the user has entered a newer key through the UI; writing unconditionally
    // would clobber that newer key with the stale legacy value on every load.
    const hasStoredSecret = (secretStorage.getSecret(secretId)?.trim() ?? '').length > 0;
    if (!hasStoredSecret) {
      secretStorage.setSecret(secretId, legacyApiKey);
    }
    settings = {
      ...settings,
      llmProviderConfigurations: {
        ...settings.llmProviderConfigurations,
        openrouter: { ...settings.llmProviderConfigurations.openrouter, secretId },
      },
    };
  }

  // Persist regardless of whether the secret was (re)written so the stale
  // plaintext field is always stripped from data.json.
  return { settings, shouldPersist: true };
}

export function getLlmProviderSecret(
  settings: PluginSettings,
  providerId: LlmProviderId,
  secretStorage: Pick<SecretStorage, 'getSecret'>,
): string {
  if (providerId === 'ollama') {
    return '';
  }
  const secretId = settings.llmProviderConfigurations[providerId].secretId;
  if (secretId.length === 0) {
    return '';
  }
  return secretStorage.getSecret(secretId)?.trim() ?? '';
}
