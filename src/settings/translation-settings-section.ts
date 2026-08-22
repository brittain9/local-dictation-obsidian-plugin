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
  TRANSLATION_LANGUAGES,
  type TranslationEngineId,
  type TranslationLanguage,
  translationLanguageLabel,
  translationTargetsFor,
} from '../translation/languages';
import {
  resolveInstalledTranslationEngine,
  TRANSLATION_ENGINES,
  translationEngineAvailability,
  translationEngineOptionLabel,
} from '../translation/translation-engines';
import type { PluginSettings } from './plugin-settings';

interface TranslationSettingsDependencies {
  getSettings: () => PluginSettings;
  manager: ModelInstallManager;
  openModelPicker: (options?: ModelPickerOptions) => Promise<void>;
  persistEngine: (engineId: TranslationEngineId) => Promise<void>;
  persistLanguages: (
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
  ) => Promise<void>;
}

export function translationSettingsFingerprint(
  state: Pick<ModelManagerState, 'catalog' | 'installedModels'>,
): string {
  const models = translationModels(state);
  const installed = models.filter((model) =>
    state.installedModels.some((candidate) =>
      matchesModelTriple(candidate, model.runtimeId, model.familyId, model.modelId),
    ),
  );
  return [
    state.catalog.catalogVersion,
    ...models.map((model) => model.modelId),
    '|',
    ...installed.map((model) => model.modelId),
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
    const models = translationModels(state);
    const installedModels = models.flatMap((model) => {
      const installed = state.installedModels.find((candidate) =>
        matchesModelTriple(candidate, model.runtimeId, model.familyId, model.modelId),
      );
      return installed === undefined ? [] : [{ installed, model }];
    });

    new Setting(container)
      .setName(t('settings.translation.model.name'))
      .setDesc(modelDescription(installedModels))
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(
            installedModels.length === 0
              ? t('settings.translation.model.download')
              : t('settings.translation.model.manage'),
          )
          .onClick(() => {
            void dependencies.openModelPicker({ initialTask: 'translation' });
          });
      });

    const settings = dependencies.getSettings();
    const pair = resolveTranslationLanguages(
      settings.dictationLanguage,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      'tencent_hy_mt',
    );
    const engineResolution = resolveInstalledTranslationEngine(
      state,
      settings.translationEngineId,
      pair.sourceLanguage,
      pair.targetLanguage,
    );
    const effectiveEngine = engineResolution.engineId;
    const availability = translationEngineAvailability(
      state,
      pair.sourceLanguage,
      pair.targetLanguage,
    );

    new Setting(container)
      .setName(t('settings.translation.engine.name'))
      .setDesc(t('settings.translation.engine.desc'))
      .addDropdown((dropdown) => {
        for (const engine of TRANSLATION_ENGINES) {
          const status = availability.find((candidate) => candidate.engineId === engine.id)?.status;
          dropdown.addOption(engine.id, translationEngineOptionLabel(engine.id, status));
          setOptionDisabled(dropdown.selectEl, engine.id, status !== 'available');
        }
        dropdown
          .setValue(effectiveEngine)
          .setDisabled(!availability.some((engine) => engine.status === 'available'));
        dropdown.onChange(async (value) => {
          if (value !== 'bergamot' && value !== 'tencent_hy_mt') return;
          if (
            !availability.some(
              (candidate) => candidate.engineId === value && candidate.status === 'available',
            )
          )
            return;
          await dependencies.persistEngine(value);
          render();
        });
      });

    new Setting(container)
      .setName(t('settings.translation.source.name'))
      .setDesc(t('settings.translation.source.desc'))
      .addDropdown((dropdown) => {
        for (const language of TRANSLATION_LANGUAGES) {
          dropdown.addOption(language, translationLanguageLabel(language));
        }
        dropdown.setValue(pair.sourceLanguage);
        dropdown.onChange(async (value) => {
          if (!isTranslationLanguage(value)) return;
          const targetLanguage = resolveTranslationTarget(
            value,
            pair.targetLanguage,
            'tencent_hy_mt',
          );
          await dependencies.persistEngine(
            resolveInstalledTranslationEngine(
              state,
              settings.translationEngineId,
              value,
              targetLanguage,
            ).engineId,
          );
          await dependencies.persistLanguages(value, targetLanguage);
          render();
        });
      });

    new Setting(container)
      .setName(t('settings.translation.target.name'))
      .setDesc(t('settings.translation.target.desc'))
      .addDropdown((dropdown) => {
        for (const language of translationTargetsFor(pair.sourceLanguage, 'tencent_hy_mt')) {
          dropdown.addOption(language, translationLanguageLabel(language));
        }
        dropdown.setValue(pair.targetLanguage);
        dropdown.onChange(async (value) => {
          if (!isTranslationLanguage(value)) return;
          if (!isSupportedTranslationPair(pair.sourceLanguage, value, 'tencent_hy_mt')) return;
          await dependencies.persistEngine(
            resolveInstalledTranslationEngine(
              state,
              settings.translationEngineId,
              pair.sourceLanguage,
              value,
            ).engineId,
          );
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

function modelDescription(
  installedModels: readonly {
    installed: ModelManagerState['installedModels'][number];
    model: CatalogModelRecord;
  }[],
): string {
  if (installedModels.length === 0) return t('settings.translation.model.noneInstalledDesc');
  if (installedModels.length === 1) {
    const installed = installedModels[0];
    if (installed === undefined) return t('settings.translation.model.noneInstalledDesc');
    return t('settings.translation.model.installedDesc', {
      model: installed.model.displayName,
      size: formatBytes(installed.installed.totalSizeBytes),
    });
  }
  return t('settings.translation.model.multipleInstalledDesc', {
    count: installedModels.length,
    size: formatBytes(
      installedModels.reduce((total, candidate) => total + candidate.installed.totalSizeBytes, 0),
    ),
  });
}

function setOptionDisabled(
  select: HTMLSelectElement,
  engineId: TranslationEngineId,
  disabled: boolean,
): void {
  const option = Array.from(select.options).find((candidate) => candidate.value === engineId);
  if (option !== undefined) option.disabled = disabled;
}
