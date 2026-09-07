import {
  catalogModelSupportsLanguage,
  type DictationLanguage,
} from '../language/dictation-language';
import type { ModelManagerState } from './model-install-manager';
import { type CatalogModelRecord, matchesModelTriple } from './model-management-types';

export interface RibbonModelMenuEntry {
  isSelected: boolean;
  model: CatalogModelRecord;
  supportsCurrentLanguage: boolean;
}

type RibbonModelMenuState = Pick<
  ModelManagerState,
  'catalog' | 'compiledAdapters' | 'installedModels' | 'selectedModel'
>;

export function deriveRibbonModelMenuEntries(
  state: RibbonModelMenuState,
  language: DictationLanguage,
): RibbonModelMenuEntry[] {
  return state.catalog.models
    .filter(
      (model) =>
        model.task === 'stt' &&
        state.compiledAdapters.some(
          (adapter) => adapter.runtimeId === model.runtimeId && adapter.familyId === model.familyId,
        ) &&
        state.installedModels.some((installed) =>
          matchesModelTriple(installed, model.runtimeId, model.familyId, model.modelId),
        ),
    )
    .map((model) => ({
      isSelected:
        state.selectedModel?.kind === 'catalog_model' &&
        matchesModelTriple(state.selectedModel, model.runtimeId, model.familyId, model.modelId),
      model,
      supportsCurrentLanguage: catalogModelSupportsLanguage(model, language),
    }));
}
