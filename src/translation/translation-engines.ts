import type {
  CatalogModelRecord,
  InstalledModelRecord,
  ModelCatalogRecord,
} from '../models/model-management-types';
import { matchesModelTriple } from '../models/model-management-types';
import { t } from '../shared/i18n';
import {
  catalogSupportsPair,
  resolveTranslationEngine,
  type TranslationEngineId,
  type TranslationLanguage,
} from './languages';

export interface TranslationEngineDefinition {
  familyId: 'firefox_translations' | 'tencent_hy_mt';
  id: TranslationEngineId;
  label: () => string;
  runtimeId: 'bergamot_wasm' | 'llama_cpp';
}

export const TRANSLATION_ENGINES: readonly TranslationEngineDefinition[] = [
  {
    familyId: 'firefox_translations',
    id: 'bergamot',
    label: () => t('translation.engine.bergamot'),
    runtimeId: 'bergamot_wasm',
  },
  {
    familyId: 'tencent_hy_mt',
    id: 'tencent_hy_mt',
    label: () => t('translation.engine.tencentHyMt'),
    runtimeId: 'llama_cpp',
  },
];

export function translationEngineLabel(engineId: TranslationEngineId): string {
  return TRANSLATION_ENGINES.find((engine) => engine.id === engineId)?.label() ?? engineId;
}

export function translationEngineOptionLabel(
  engineId: TranslationEngineId,
  status: TranslationEngineAvailabilityStatus | undefined,
): string {
  const style = translationEngineLabel(engineId);
  if (status === 'not_installed') return t('translation.engine.notInstalled', { style });
  if (status === 'unsupported_pair') return t('translation.engine.unsupportedPair', { style });
  return style;
}

export type TranslationEngineAvailabilityStatus =
  | 'available'
  | 'not_installed'
  | 'unsupported_pair';

export interface TranslationEngineAvailability {
  engineId: TranslationEngineId;
  model: CatalogModelRecord | null;
  status: TranslationEngineAvailabilityStatus;
}

export interface TranslationEngineResolution {
  availability: TranslationEngineAvailabilityStatus;
  engineId: TranslationEngineId;
  status: 'installed_fallback' | 'missing_model' | 'preferred';
}

type TranslationModelState = {
  catalog: Pick<ModelCatalogRecord, 'models'>;
  installedModels: readonly InstalledModelRecord[];
};

export function translationEngineAvailability(
  state: TranslationModelState,
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): TranslationEngineAvailability[] {
  return TRANSLATION_ENGINES.map((engine) => {
    const model = state.catalog.models.find(
      (candidate) =>
        candidate.task === 'translation' &&
        candidate.runtimeId === engine.runtimeId &&
        candidate.familyId === engine.familyId &&
        catalogSupportsPair(candidate, sourceLanguage, targetLanguage),
    );
    if (model === undefined) {
      return { engineId: engine.id, model: null, status: 'unsupported_pair' };
    }
    const installed = state.installedModels.some((candidate) =>
      matchesModelTriple(candidate, model.runtimeId, model.familyId, model.modelId),
    );
    return {
      engineId: engine.id,
      model,
      status: installed ? 'available' : 'not_installed',
    };
  });
}

export function resolveInstalledTranslationEngine(
  state: TranslationModelState,
  preferredEngine: TranslationEngineId,
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): TranslationEngineResolution {
  const availability = translationEngineAvailability(state, sourceLanguage, targetLanguage);
  const preferred = availability.find((engine) => engine.engineId === preferredEngine);
  if (preferred?.status === 'available') {
    return { availability: preferred.status, engineId: preferredEngine, status: 'preferred' };
  }

  const installedFallback = availability.find((engine) => engine.status === 'available');
  if (installedFallback !== undefined) {
    return {
      availability: installedFallback.status,
      engineId: installedFallback.engineId,
      status: 'installed_fallback',
    };
  }

  const engineId = resolveTranslationEngine(preferredEngine, sourceLanguage, targetLanguage);
  const missing = availability.find((engine) => engine.engineId === engineId);
  return {
    availability: missing?.status ?? 'unsupported_pair',
    engineId,
    status: 'missing_model',
  };
}
