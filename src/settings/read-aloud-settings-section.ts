import type { SliderComponent } from 'obsidian';
import { Setting } from 'obsidian';

import type { ModelPickerOptions } from '../models/manage-models-modal';
import type { ModelInstallManager, ModelManagerState } from '../models/model-install-manager';
import { matchesModelTriple } from '../models/model-management-types';
import { formatVoiceLabel } from '../shared/format-utils';
import { t } from '../shared/i18n';
import { resolveReadAloudVoiceId } from '../tts/read-aloud-selection';
import { MAX_TTS_SPEED, MIN_TTS_SPEED, type PluginSettings } from './plugin-settings';

interface ReadAloudSettingsSectionDependencies {
  getSettings: () => PluginSettings;
  manager: ModelInstallManager;
  openSelectedModelDetails: () => void;
  openModelPicker: (options?: ModelPickerOptions) => Promise<void>;
  persistVoice: (voice: string | null) => Promise<void>;
}

export function configureReadAloudSpeedSlider(
  slider: SliderComponent,
  speed: number,
  persistSpeed: (speed: number) => Promise<void>,
): void {
  slider.setLimits(MIN_TTS_SPEED, MAX_TTS_SPEED, 0.05).setValue(speed);

  // Obsidian 1.13 shows values inline, but supported 1.11/1.12 hosts need this tooltip.
  const legacyTooltipSlider = slider as { setDynamicTooltip(): SliderComponent };
  legacyTooltipSlider.setDynamicTooltip().onChange(persistSpeed);
}

export function readAloudControlsFingerprint(
  state: Pick<ModelManagerState, 'catalog' | 'installedModels' | 'selectedTtsModel'>,
): string {
  const selection = state.selectedTtsModel;
  if (selection?.kind !== 'catalog_model') {
    return `${state.catalog.catalogVersion}:none`;
  }
  const catalogModel = state.catalog.models.find((model) =>
    matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
  );
  const installed = state.installedModels.find((model) =>
    matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
  );
  return [
    state.catalog.catalogVersion,
    selection.runtimeId,
    selection.familyId,
    selection.modelId,
    catalogModel === undefined ? 'unresolved' : 'resolved',
    ...(installed?.installedVoiceIds ?? []),
  ].join(':');
}

export function renderTextToSpeechSettings(
  modelContainer: HTMLDivElement,
  modelBefore: HTMLElement,
  readAloudContainer: HTMLDivElement,
  readAloudBefore: HTMLElement,
  dependencies: ReadAloudSettingsSectionDependencies,
): () => void {
  let fingerprint = readAloudControlsFingerprint(dependencies.manager.getState());
  let modelSettingEl: HTMLElement | null = null;
  let voiceSettingEl: HTMLElement | null = null;

  const render = (): void => {
    if (modelSettingEl !== null) modelContainer.removeChild(modelSettingEl);
    if (voiceSettingEl !== null) readAloudContainer.removeChild(voiceSettingEl);
    const settings = dependencies.getSettings();
    const state = dependencies.manager.getState();
    const selection = settings.selectedTtsModel;
    const catalogModel =
      selection?.kind === 'catalog_model'
        ? (state.catalog.models.find((model) =>
            matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
          ) ?? null)
        : null;

    const modelSetting = new Setting(modelContainer)
      .setName(t('settings.model.textToSpeech'))
      .setDesc(catalogModel?.displayName ?? t('settings.model.noModelSelected'))
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(t('settings.model.manageModels'))
          .onClick(() => {
            void dependencies.openModelPicker({ initialTask: 'tts' });
          });
      });
    if (catalogModel !== null) {
      modelSetting.addExtraButton((button) => {
        button
          .setIcon('info')
          .setTooltip(t('settings.model.details'))
          .onClick(() => {
            dependencies.openSelectedModelDetails();
          });
      });
    }
    modelSettingEl = modelSetting.settingEl;
    modelContainer.insertBefore(modelSettingEl, modelBefore);

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
    const voiceSetting = new Setting(readAloudContainer)
      .setName(t('settings.readAloud.voice'))
      .setDesc(t('settings.readAloud.voiceDesc'))
      .addDropdown((dropdown) => {
        if (installedVoices.length === 0) {
          dropdown.addOption('', t('settings.readAloud.noVoices'));
        }
        for (const voice of installedVoices) {
          dropdown.addOption(voice, formatVoiceLabel(voice));
        }
        dropdown.setValue(
          resolveReadAloudVoiceId(settings.selectedTtsVoice, catalogModel?.defaultVoice) ?? '',
        );
        dropdown.setDisabled(installedVoices.length === 0);
        dropdown.onChange(async (voice) => {
          await dependencies.persistVoice(voice.length === 0 ? null : voice);
        });
      });
    voiceSettingEl = voiceSetting.settingEl;
    readAloudContainer.insertBefore(voiceSettingEl, readAloudBefore);
  };

  render();
  return dependencies.manager.subscribe(() => {
    const nextFingerprint = readAloudControlsFingerprint(dependencies.manager.getState());
    if (nextFingerprint === fingerprint) return;
    fingerprint = nextFingerprint;
    render();
  });
}
