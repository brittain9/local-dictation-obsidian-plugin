import { Setting } from 'obsidian';

import type { ModelPickerOptions } from '../models/manage-models-modal';
import type { ModelInstallManager, ModelManagerState } from '../models/model-install-manager';
import { type CatalogModelRecord, matchesModelTriple } from '../models/model-management-types';
import { formatBytes } from '../shared/format-utils';
import { t } from '../shared/i18n';
import {
  isSupportedTranslationPair,
  isTranslationLanguage,
  resolveTranslationLanguages,
  resolveTranslationTarget,
  type TranslationLanguage,
  translationLanguageLabel,
  translationSourcesFor,
  translationTargetsFor,
} from '../translation/languages';
import type { PluginSettings } from './plugin-settings';

interface TranslationSettingsDependencies {
  getSettings: () => PluginSettings;
  manager: ModelInstallManager;
  openModelPicker: (options?: ModelPickerOptions) => Promise<void>;
  persistLanguages: (
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
  ) => Promise<void>;
}

export function translationSettingsFingerprint(
  state: Pick<ModelManagerState, 'catalog' | 'installedModels' | 'selectedTranslationModel'>,
): string {
  const models = translationModels(state);
  const installed = models.filter((model) =>
    state.installedModels.some((candidate) =>
      matchesModelTriple(candidate, model.runtimeId, model.familyId, model.modelId),
    ),
  );
  const selected = state.selectedTranslationModel;
  return [
    state.catalog.catalogVersion,
    ...models.map((model) => model.modelId),
    '|',
    ...installed.map((model) => model.modelId),
    '|',
    selected?.runtimeId ?? '',
    selected?.familyId ?? '',
    selected?.kind === 'catalog_model' ? selected.modelId : '',
  ].join(':');
}

export function renderTranslationSettings(
  container: HTMLDivElement,
  dependencies: TranslationSettingsDependencies,
): () => void {
  let disposed = false;
  let fingerprint = translationSettingsFingerprint(dependencies.manager.getState());

  const render = (): void => {
    if (disposed) return;
    container.empty();
    const state = dependencies.manager.getState();
    const selectedModel = selectedTranslationCatalogModel(state);
    const installedRecord =
      selectedModel === null
        ? null
        : (state.installedModels.find((candidate) =>
            matchesModelTriple(
              candidate,
              selectedModel.runtimeId,
              selectedModel.familyId,
              selectedModel.modelId,
            ),
          ) ?? null);

    new Setting(container)
      .setName(t('settings.translation.model.name'))
      .setDesc(modelDescription(selectedModel, installedRecord?.totalSizeBytes ?? null))
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(t('settings.translation.model.manage'))
          .onClick(() => {
            void dependencies.openModelPicker({ initialTask: 'translation' });
          });
      });

    const settings = dependencies.getSettings();
    const pair = resolveTranslationLanguages(
      settings.dictationLanguage,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      selectedModel,
    );

    new Setting(container)
      .setName(t('settings.translation.source.name'))
      .setDesc(t('settings.translation.source.desc'))
      .addDropdown((dropdown) => {
        for (const language of translationSourcesFor(selectedModel)) {
          dropdown.addOption(language, translationLanguageLabel(language));
        }
        dropdown.setValue(pair.sourceLanguage);
        dropdown.onChange(async (value) => {
          if (!isTranslationLanguage(value)) return;
          if (!translationSourcesFor(selectedModel).includes(value)) return;
          const targetLanguage = resolveTranslationTarget(
            value,
            pair.targetLanguage,
            selectedModel,
          );
          await dependencies.persistLanguages(value, targetLanguage);
          render();
        });
      });

    new Setting(container)
      .setName(t('settings.translation.target.name'))
      .setDesc(t('settings.translation.target.desc'))
      .addDropdown((dropdown) => {
        for (const language of translationTargetsFor(pair.sourceLanguage, selectedModel)) {
          dropdown.addOption(language, translationLanguageLabel(language));
        }
        dropdown.setValue(pair.targetLanguage);
        dropdown.onChange(async (value) => {
          if (!isTranslationLanguage(value)) return;
          if (!isSupportedTranslationPair(pair.sourceLanguage, value, selectedModel)) return;
          await dependencies.persistLanguages(pair.sourceLanguage, value);
          render();
        });
      });
  };

  render();
  const unsubscribe = dependencies.manager.subscribe(() => {
    const nextFingerprint = translationSettingsFingerprint(dependencies.manager.getState());
    if (nextFingerprint === fingerprint) return;
    fingerprint = nextFingerprint;
    render();
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}

function translationModels(state: Pick<ModelManagerState, 'catalog'>): CatalogModelRecord[] {
  return state.catalog.models.filter((model) => model.task === 'translation');
}

function selectedTranslationCatalogModel(
  state: Pick<ModelManagerState, 'catalog' | 'selectedTranslationModel'>,
): CatalogModelRecord | null {
  const selected = state.selectedTranslationModel;
  if (selected?.kind !== 'catalog_model') return null;
  return (
    state.catalog.models.find(
      (model) =>
        model.task === 'translation' &&
        matchesModelTriple(model, selected.runtimeId, selected.familyId, selected.modelId),
    ) ?? null
  );
}

function modelDescription(model: CatalogModelRecord | null, installedSize: number | null): string {
  if (model === null) return t('settings.translation.model.unavailable');
  const size =
    installedSize ??
    model.artifacts
      .filter((artifact) => artifact.required)
      .reduce((total, artifact) => total + artifact.sizeBytes, 0);
  return t(
    installedSize === null
      ? 'settings.translation.model.availableDesc'
      : 'settings.translation.model.installedDesc',
    {
      model: model.displayName,
      size: formatBytes(size),
    },
  );
}
