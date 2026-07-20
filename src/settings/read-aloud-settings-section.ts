import { Setting } from 'obsidian';

import type { ModelPickerOptions } from '../models/manage-models-modal';
import type { ModelInstallManager, ModelManagerState } from '../models/model-install-manager';
import { matchesModelTriple } from '../models/model-management-types';
import { formatVoiceLabel } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { PluginSettings } from './plugin-settings';

interface ReadAloudSettingsSectionDependencies {
  getSettings: () => PluginSettings;
  manager: ModelInstallManager;
  openModelPicker: (options?: ModelPickerOptions) => Promise<void>;
  persistVoice: (voice: string | null) => Promise<void>;
}

export function readAloudControlsFingerprint(
  state: Pick<ModelManagerState, 'catalog' | 'installedModels' | 'selectedTtsModel'>,
): string {
  const selection = state.selectedTtsModel;
  if (selection?.kind !== 'catalog_model') {
    return `${state.catalog.catalogVersion}:none`;
  }
  const installed = state.installedModels.find((model) =>
    matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
  );
  return [
    state.catalog.catalogVersion,
    selection.runtimeId,
    selection.familyId,
    selection.modelId,
    ...(installed?.installedVoiceIds ?? []),
  ].join(':');
}

export function renderReadAloudModelControls(
  container: HTMLDivElement,
  dependencies: ReadAloudSettingsSectionDependencies,
): () => void {
  let fingerprint = readAloudControlsFingerprint(dependencies.manager.getState());

  const render = (): void => {
    container.empty();
    const settings = dependencies.getSettings();
    const state = dependencies.manager.getState();
    const selection = settings.selectedTtsModel;
    const catalogModel =
      selection?.kind === 'catalog_model'
        ? (state.catalog.models.find((model) =>
            matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
          ) ?? null)
        : null;

    new Setting(container)
      .setName(catalogModel?.displayName ?? t('settings.readAloud.noModel'))
      .setDesc(t('settings.readAloud.modelDesc'))
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(t('settings.model.manageModels'))
          .onClick(() => {
            void dependencies.openModelPicker({ initialTask: 'tts' });
          });
      });

    const installed =
      catalogModel === null
        ? null
        : (state.installedModels.find((model) =>
            matchesModelTriple(
              model,
              catalogModel.runtimeId,
              catalogModel.familyId,
              catalogModel.modelId,
            ),
          ) ?? null);
    const installedVoices = installed?.installedVoiceIds ?? [];
    new Setting(container)
      .setName(t('settings.readAloud.voice'))
      .setDesc(t('settings.readAloud.voiceDesc'))
      .addDropdown((dropdown) => {
        if (installedVoices.length === 0) {
          dropdown.addOption('', t('settings.readAloud.noVoices'));
        }
        for (const voice of installedVoices) {
          dropdown.addOption(voice, formatVoiceLabel(voice));
        }
        dropdown.setValue(settings.selectedTtsVoice ?? installedVoices[0] ?? '');
        dropdown.setDisabled(installedVoices.length === 0);
        dropdown.onChange(async (voice) => {
          await dependencies.persistVoice(voice.length === 0 ? null : voice);
        });
      });
  };

  render();
  return dependencies.manager.subscribe(() => {
    const nextFingerprint = readAloudControlsFingerprint(dependencies.manager.getState());
    if (nextFingerprint === fingerprint) return;
    fingerprint = nextFingerprint;
    render();
  });
}
