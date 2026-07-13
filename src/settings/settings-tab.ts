import type { App, Plugin } from 'obsidian';
import { Platform, PluginSettingTab, Setting } from 'obsidian';

import { formatSystemAudioProbeResultMessage } from '../audio/system-audio-permission-message';
import { resolveEngineCapabilities } from '../models/capability-view';
import type { ModelInstallManager } from '../models/model-install-manager';
import { updateInstallProgressElement } from '../models/model-install-progress';
import { ExternalModelFileModal, ModelDetailsModal } from '../models/model-management-modals';
import { matchesModelTriple } from '../models/model-management-types';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { SpeakingStyle } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import {
  buildSidecarProgressState,
  type SidecarInstallManager,
} from '../sidecar/sidecar-install-manager';
import { readInstallManifest, variantDirectoryPath } from '../sidecar/sidecar-installer';
import { diarizationSettingDescription } from './diarization-setting';
import { renderActiveInstallCard } from './install-progress-row';
import { renderMicrophonePicker } from './microphone-picker';
import { renderModelSection } from './model-settings-section';
import {
  PHRASE_FINALIZATION_TOOLTIP,
  phraseFinalizationDescription,
} from './phrase-finalization-setting';
import {
  type DictationAnchor,
  isDictationAnchor,
  isListeningMode,
  isRemoteLlmEffectivelyEnabled,
  isSpeakingStyle,
  isTimestampClock,
  isTimestampDensity,
  isTranscriptFormattingMode,
  MAX_TIMESTAMP_SPARSE_INTERVAL_MS,
  MIN_TIMESTAMP_SPARSE_INTERVAL_MS,
  type PluginSettings,
  type TimestampClock,
  type TimestampDensity,
  type TranscriptFormattingMode,
} from './plugin-settings';
import {
  addEnumSetting,
  addTextSetting,
  addToggleSetting,
  appendInfoTooltip,
  createSettingGroup,
  type DropdownOption,
  type SettingAccess,
} from './setting-helpers';
import {
  resolvePluginDirectorySafe,
  type SidecarInstallActionDeps,
  SidecarSettingsSection,
} from './sidecar-settings-section';
import { SmartParagraphSettingsModal } from './smart-paragraph-settings-modal';
import { isSystemAudioSupportedOnCurrentPlatform } from './system-audio-support';

interface SettingsTabDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getSettings: () => PluginSettings;
  isDictationBusy: () => boolean;
  logger?: PluginLogger | undefined;
  modelInstallManager: ModelInstallManager;
  openModelPicker: (options?: { onChanged?: () => void }) => Promise<void>;
  openSetupWizard: () => Promise<void>;
  pluginVersion: string;
  resolvePluginDirectory: () => Promise<string>;
  restartSidecar: () => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  sidecarConnection: Pick<SidecarConnection, 'probeSystemAudio' | 'shutdown'>;
  sidecarInstallManager: SidecarInstallManager;
}

const LISTENING_MODE_OPTIONS: ReadonlyArray<DropdownOption<'always_on' | 'one_sentence'>> = [
  { label: 'Always on', value: 'always_on' },
  { label: 'One sentence', value: 'one_sentence' },
];

const DICTATION_ANCHOR_OPTIONS: ReadonlyArray<DropdownOption<DictationAnchor>> = [
  { label: 'At cursor', value: 'at_cursor' },
  { label: 'End of note', value: 'end_of_note' },
];

const TRANSCRIPT_FORMATTING_OPTIONS: ReadonlyArray<DropdownOption<TranscriptFormattingMode>> = [
  { label: 'Smart paragraphs', value: 'smart' },
  { label: 'Space', value: 'space' },
  { label: 'New line', value: 'new_line' },
  { label: 'New paragraph', value: 'new_paragraph' },
];

const SPEAKING_STYLE_OPTIONS: ReadonlyArray<DropdownOption<SpeakingStyle>> = [
  { label: 'Responsive — short pauses', value: 'responsive' },
  { label: 'Balanced — standard', value: 'balanced' },
  { label: 'Patient — long pauses', value: 'patient' },
];

const TIMESTAMP_CLOCK_OPTIONS: ReadonlyArray<DropdownOption<TimestampClock>> = [
  { label: 'Elapsed', value: 'elapsed' },
  { label: 'Wall clock', value: 'wallclock' },
];

const TIMESTAMP_DENSITY_OPTIONS: ReadonlyArray<DropdownOption<TimestampDensity>> = [
  { label: 'Sparse', value: 'sparse' },
  { label: 'Every phrase', value: 'every_utterance' },
];

export class LocalSttSettingTab extends PluginSettingTab {
  override readonly icon = 'audio-lines';

  private readonly access: SettingAccess;
  private disposeDiarizationDesc: (() => void) | null = null;
  private disposeEngineSection: (() => void) | null = null;
  private disposeMicrophoneSection: (() => void) | null = null;
  private disposeMissingSidecarBanner: (() => void) | null = null;
  private disposeModelSection: (() => void) | null = null;
  private disposeSidecarSection: (() => void) | null = null;
  private missingSidecarProgressEl: HTMLDivElement | null = null;

  constructor(
    app: App,
    plugin: Plugin,
    private readonly dependencies: SettingsTabDependencies,
  ) {
    super(app, plugin);
    this.access = {
      getSettings: () => this.dependencies.getSettings(),
      persistOne: async (key, value) => {
        await this.dependencies.saveSettings({
          ...this.dependencies.getSettings(),
          [key]: value,
        });
      },
    };
  }

  override display(): void {
    this.tearDown();

    const { containerEl } = this;
    const settings = this.dependencies.getSettings();

    containerEl.empty();

    const missingSidecarGroup = containerEl.createDiv({ cls: 'setting-group' });
    this.disposeMissingSidecarBanner = this.renderMissingSidecarBanner(missingSidecarGroup);

    // --- Model ---
    const modelSection = createSettingGroup(containerEl, 'Model');
    const manager = this.dependencies.modelInstallManager;
    this.disposeModelSection = renderModelSection(modelSection, manager, {
      onManageModels: () => {
        void this.dependencies.openModelPicker({
          onChanged: () => {
            this.display();
          },
        });
      },
      onExternalFile: () => {
        const selectedModel = this.dependencies.getSettings().selectedModel;
        new ExternalModelFileModal(
          this.app,
          selectedModel?.kind === 'external_file' ? selectedModel.filePath : '',
          {
            feedback: this.dependencies.feedback,
            manager,
            onChanged: async () => {
              this.display();
            },
          },
        ).open();
      },
      onModelInfo: this.buildModelInfoCallback(manager, settings),
    });

    // --- Capture ---
    const captureCard = createSettingGroup(containerEl, 'Capture');

    const systemAudioSupported = isSystemAudioSupportedOnCurrentPlatform();

    this.disposeMicrophoneSection = renderMicrophonePicker(captureCard, {
      access: this.access,
      feedback: this.dependencies.feedback,
      isDictationBusy: this.dependencies.isDictationBusy,
      logger: this.dependencies.logger,
    });

    if (systemAudioSupported) {
      addToggleSetting(captureCard, this.access, {
        name: 'Include system audio',
        desc: "Also capture this computer's default audio output for meetings, calls, and videos.",
        key: 'includeSystemAudio',
        onChange: async (value) => {
          // First-ever probe is the designed moment for the macOS TCC prompt.
          if (value && Platform.isMacOS && !(await this.probeSystemAudio())) {
            // Capture cannot work; leaving the toggle on would just fail
            // every session start with the same error.
            await this.access.persistOne('includeSystemAudio', false);
            this.display();
          }
        },
      });
    }

    addEnumSetting(captureCard, this.access, {
      name: 'Listening mode',
      desc: 'Continuous, or stop after one sentence.',
      key: 'listeningMode',
      options: LISTENING_MODE_OPTIONS,
      isValid: isListeningMode,
    });

    const phraseFinalizationSetting = new Setting(captureCard)
      .setName('Phrase finalization')
      .setDesc(phraseFinalizationDescription(settings.speakingStyle));
    phraseFinalizationSetting.addDropdown((dropdown) => {
      for (const option of SPEAKING_STYLE_OPTIONS) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(settings.speakingStyle);
      dropdown.onChange(async (value) => {
        if (!isSpeakingStyle(value)) return;
        await this.access.persistOne('speakingStyle', value);
        phraseFinalizationSetting.setDesc(phraseFinalizationDescription(value));
      });
    });
    appendInfoTooltip(phraseFinalizationSetting, PHRASE_FINALIZATION_TOOLTIP);

    const outputCard = createSettingGroup(containerEl, 'Transcript output');

    addEnumSetting(outputCard, this.access, {
      name: 'Insert text',
      desc: 'Where dictated text appears.',
      key: 'dictationAnchor',
      options: DICTATION_ANCHOR_OPTIONS,
      isValid: isDictationAnchor,
    });

    this.renderTranscriptFormattingSetting(outputCard);

    const diarizationSetting = addToggleSetting(outputCard, this.access, {
      name: 'Speaker labels (diarization)',
      desc: '',
      key: 'diarizationEnabled',
    });
    const updateDiarizationDesc = (): void => {
      const caps = manager.getState().selectedModelCapabilities;
      diarizationSetting.setDesc(
        diarizationSettingDescription(
          caps.status === 'ready' && caps.capabilities.family.supportsStreaming,
        ),
      );
    };
    updateDiarizationDesc();
    this.disposeDiarizationDesc = manager.subscribe(updateDiarizationDesc);

    addToggleSetting(outputCard, this.access, {
      name: 'Keep recovery text in memory',
      desc: 'Keep the latest utterance and one raw/transformed batch-cleanup record with its document snapshot. Nothing is saved to disk; disabling this clears it immediately.',
      key: 'retainLastUtterance',
    });

    const timestampsCard = createSettingGroup(containerEl, 'Timestamps');
    this.renderTimestampSettings(timestampsCard, settings);

    const llmCard = createSettingGroup(containerEl, 'LLM transformation');
    const enableLlmSetting = new Setting(llmCard)
      .setName('Enable LLM features')
      .setDesc('Make LLM transformations available. Turn transformation on or off in the sidebar.');
    enableLlmSetting.addToggle((toggle) => {
      toggle.setValue(settings.llmFeaturesEnabled);
      toggle.onChange(async (value) => {
        await this.access.persistOne('llmFeaturesEnabled', value);
        this.display();
      });
    });

    const remoteLlmSetting = new Setting(llmCard)
      .setName('Enable remote LLM')
      .setDesc(
        'Allow transcript text and included note context to be sent to OpenRouter. Audio is never sent.',
      );
    remoteLlmSetting.addToggle((toggle) => {
      toggle.setValue(isRemoteLlmEffectivelyEnabled(settings));
      toggle.setDisabled(!settings.llmFeaturesEnabled);
      toggle.onChange(async (value) => {
        if (!this.dependencies.getSettings().llmFeaturesEnabled) return;
        await this.access.persistOne('llmRemoteFeaturesEnabled', value);
      });
    });

    // --- Engine options ---
    // Built inline (rather than via createSettingGroup) so renderEngineOptions
    // can hide the whole card when no rows apply (e.g. macOS + a model with
    // no initial-prompt support).
    const engineGroup = containerEl.createDiv({ cls: 'setting-group' });
    const engineHeading = new Setting(engineGroup).setName('Engine').setHeading();
    const engineSection = engineGroup.createDiv({ cls: 'setting-items' });
    const renderEngine = (): void => {
      this.renderEngineOptions(engineGroup, engineHeading, engineSection);
    };
    renderEngine();
    this.disposeEngineSection = manager.subscribe(renderEngine);

    // --- Advanced (includes sidecar install/uninstall) ---
    const advancedSection = createSettingGroup(containerEl, 'Advanced');

    // Sidecar rows live in their own owned container so re-renders can simply
    // empty + rebuild without disturbing the rest of the Advanced section.
    const sidecarContainer = advancedSection.createDiv();
    const sidecarSection = new SidecarSettingsSection(sidecarContainer, {
      ...this.buildSidecarInstallActionDeps(),
      access: this.access,
      resolvePluginDirectory: this.dependencies.resolvePluginDirectory,
    });
    this.disposeSidecarSection = sidecarSection.init();

    addTextSetting(advancedSection, this.access, {
      name: 'Model store folder override',
      desc: 'Custom folder for managed model downloads.',
      key: 'modelStorePathOverride',
      placeholder: 'Use the shared default model store',
    });

    new Setting(advancedSection)
      .setName('Run setup')
      .setDesc('Re-run the first-time setup wizard.')
      .addButton((button) => {
        button.setButtonText('Run setup').onClick(() => {
          void this.dependencies.openSetupWizard();
        });
      });

    const developerModeSetting = new Setting(advancedSection)
      .setName('Developer mode')
      .setDesc('Show verbose diagnostics and developer-only settings.');
    developerModeSetting.addToggle((toggle) => {
      toggle.setValue(this.dependencies.getSettings().developerMode);
      toggle.onChange(async (value) => {
        await this.access.persistOne('developerMode', value);
        this.display();
      });
    });
  }

  override hide(): void {
    this.tearDown();
  }

  private tearDown(): void {
    this.disposeModelSection?.();
    this.disposeModelSection = null;
    this.disposeDiarizationDesc?.();
    this.disposeDiarizationDesc = null;
    this.disposeEngineSection?.();
    this.disposeEngineSection = null;
    this.disposeMicrophoneSection?.();
    this.disposeMicrophoneSection = null;
    this.disposeSidecarSection?.();
    this.disposeSidecarSection = null;
    this.disposeMissingSidecarBanner?.();
    this.disposeMissingSidecarBanner = null;
    this.missingSidecarProgressEl = null;
  }

  /** Returns whether the probe confirmed capture is usable. */
  private async probeSystemAudio(): Promise<boolean> {
    try {
      const result = await this.dependencies.sidecarConnection.probeSystemAudio();
      if (result.ok) {
        this.dependencies.feedback.show({ intent: 'success', message: 'System audio is ready.' });
        return true;
      }

      this.dependencies.feedback.show({
        intent: 'action-required',
        key: 'system-audio-permission',
        message: formatSystemAudioProbeResultMessage(result),
      });
    } catch (error) {
      this.dependencies.feedback.show({
        cause: error,
        intent: 'error',
        message:
          'Could not test system audio. Check that the speech engine is installed and try again.',
      });
    }
    return false;
  }

  private renderTranscriptFormattingSetting(parent: HTMLElement): void {
    const setting = addEnumSetting(parent, this.access, {
      name: 'Transcript formatting',
      desc: 'How phrases are joined together.',
      tooltip: 'Smart paragraphs use longer pauses as line or paragraph breaks.',
      key: 'transcriptFormatting',
      options: TRANSCRIPT_FORMATTING_OPTIONS,
      isValid: isTranscriptFormattingMode,
    });

    setting.addExtraButton((button) => {
      button
        .setIcon('sliders-horizontal')
        .setTooltip('Smart paragraph settings')
        .onClick(() => {
          new SmartParagraphSettingsModal(this.app, {
            getSettings: () => this.dependencies.getSettings(),
            onSave: () => {
              this.display();
            },
            saveSettings: async (settings) => {
              await this.dependencies.saveSettings(settings);
            },
          }).open();
        });
    });
  }

  private renderTimestampSettings(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent)
      .setName('Use timestamps')
      .setDesc('Stamp each phrase with the time it was spoken.')
      .addToggle((toggle) => {
        toggle.setValue(settings.timestampsEnabled);
        toggle.onChange(async (value) => {
          await this.access.persistOne('timestampsEnabled', value);
          this.display();
        });
      });

    if (!settings.timestampsEnabled) return;

    addToggleSetting(parent, this.access, {
      name: 'Session header',
      desc: 'Insert [YYYY-MM-DD HH:MM] at the top of the session.',
      key: 'timestampSessionHeader',
    });

    addEnumSetting(parent, this.access, {
      name: 'Reference clock',
      desc: 'Elapsed time, or wall-clock time.',
      key: 'timestampClock',
      options: TIMESTAMP_CLOCK_OPTIONS,
      isValid: isTimestampClock,
    });

    addEnumSetting(parent, this.access, {
      name: 'Density',
      desc: 'Stamp every phrase, or at fixed intervals.',
      key: 'timestampDensity',
      options: TIMESTAMP_DENSITY_OPTIONS,
      isValid: isTimestampDensity,
    });

    const minSeconds = MIN_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
    const maxSeconds = MAX_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
    new Setting(parent)
      .setName('Sparse interval')
      .setDesc(`Seconds between landmarks (${minSeconds}-${maxSeconds}).`)
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = String(minSeconds);
        text.inputEl.max = String(maxSeconds);
        text.inputEl.step = '1';
        text.setValue(String(Math.round(settings.timestampSparseIntervalMs / 1000)));
        text.onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isInteger(parsed)) return;
          const clamped = Math.min(maxSeconds, Math.max(minSeconds, parsed));
          await this.access.persistOne('timestampSparseIntervalMs', clamped * 1000);
        });
      });
  }

  private buildModelInfoCallback(
    manager: ModelInstallManager,
    settings: PluginSettings,
  ): (() => void) | null {
    const sel = settings.selectedModel;

    if (sel === null || sel.kind !== 'catalog_model') {
      return null;
    }

    const { runtimeId, familyId, modelId } = sel;

    return () => {
      const state = manager.getState();
      const catalogModel = state.catalog.models.find((m) =>
        matchesModelTriple(m, runtimeId, familyId, modelId),
      );
      if (catalogModel === undefined) return;
      const installedModel = state.installedModels.find((m) =>
        matchesModelTriple(m, runtimeId, familyId, modelId),
      );
      const capabilities = resolveEngineCapabilities(
        state.compiledRuntimes,
        state.compiledAdapters,
        catalogModel.runtimeId,
        catalogModel.familyId,
      );
      new ModelDetailsModal(
        this.app,
        catalogModel,
        installedModel?.installPath ?? null,
        capabilities,
      ).open();
    };
  }

  private renderEngineOptions(
    group: HTMLDivElement,
    heading: Setting,
    containerEl: HTMLDivElement,
  ): void {
    const settings = this.dependencies.getSettings();
    const state = this.dependencies.modelInstallManager.getState();
    const sel = settings.selectedModel;
    const selectedAdapter =
      sel === null
        ? null
        : (state.compiledAdapters.find(
            (a) => a.runtimeId === sel.runtimeId && a.familyId === sel.familyId,
          ) ?? null);
    const selectedRuntime =
      sel === null
        ? null
        : (state.compiledRuntimes.find((r) => r.runtimeId === sel.runtimeId) ?? null);

    containerEl.empty();
    heading.setName(selectedAdapter === null ? 'Engine' : `${selectedAdapter.displayName} engine`);

    let rendered = 0;

    const hasNonCpuAccelerator =
      selectedRuntime?.runtimeCapabilities.availableAccelerators.some((id) => id !== 'cpu') ??
      false;

    if (!Platform.isMacOS && hasNonCpuAccelerator) {
      // accelerationPreference is a string enum mapped onto a boolean toggle, so
      // the addEnumSetting / addToggleSetting helpers don't fit.
      new Setting(containerEl)
        .setName('Hardware acceleration')
        .setDesc('Run inference on the GPU when available.')
        .addToggle((toggle) => {
          toggle.setValue(settings.accelerationPreference === 'auto');
          toggle.onChange(async (value) => {
            if (this.dependencies.isDictationBusy()) {
              this.dependencies.feedback.show({
                intent: 'warning',
                message: 'Cannot change hardware acceleration while dictating.',
              });
              toggle.setValue(!value);
              return;
            }
            await this.access.persistOne('accelerationPreference', value ? 'auto' : 'cpu_only');
            try {
              await this.dependencies.restartSidecar();
              this.dependencies.feedback.show({
                intent: 'success',
                message: value ? 'Hardware acceleration on.' : 'Hardware acceleration off.',
              });
            } catch (error) {
              this.dependencies.feedback.show({
                cause: error,
                intent: 'error',
                message:
                  'Hardware acceleration was saved, but the speech engine could not restart. Restart Obsidian to apply it.',
              });
            }
          });
        });
      rendered += 1;
    }

    const caps = state.selectedModelCapabilities;
    if (caps.status === 'ready' && caps.capabilities.family.supportsInitialPrompt) {
      addToggleSetting(containerEl, this.access, {
        name: 'Use note as context',
        desc: 'Send distinctive terms from the open note to help spelling.',
        tooltip:
          'Sends a glossary of proper nouns and technical terms as the engine’s initial prompt. Only used by engines that support initial prompts.',
        key: 'useNoteAsContext',
      });
      rendered += 1;
    }

    group.toggleClass('local-stt-hidden', rendered === 0);
  }

  private renderMissingSidecarBanner(group: HTMLDivElement): () => void {
    let disposed = false;

    const render = async (): Promise<void> => {
      this.missingSidecarProgressEl = null;
      group.empty();

      const pluginDirectory = await this.resolvePluginDirectorySafe();
      if (disposed || pluginDirectory === null || !group.isConnected) return;

      const [cpuManifest, cudaManifest] = await Promise.all([
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu')),
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cuda')),
      ]);
      if (disposed || !group.isConnected) return;

      const activeInstall = this.dependencies.sidecarInstallManager.getState().activeInstall;
      const sidecarInstalled = cpuManifest !== null || cudaManifest !== null;
      group.toggleClass('local-stt-hidden', sidecarInstalled);
      if (sidecarInstalled) {
        return;
      }

      const items = group.createDiv({ cls: 'setting-items' });

      if (activeInstall !== null) {
        const { progressEl } = renderActiveInstallCard(items, {
          isCancelling: activeInstall.phase === 'canceling',
          name: `Installing: ${activeInstall.variant.toUpperCase()} sidecar`,
          onCancel: () => {
            this.dependencies.sidecarInstallManager.cancel();
          },
          progressState: buildSidecarProgressState(activeInstall),
        });
        this.missingSidecarProgressEl = progressEl;
        return;
      }

      const setting = new Setting(items)
        .setName('Set up Local Dictation')
        .setDesc(
          "Local Dictation isn't ready yet. Run the setup wizard to install the speech engine and a model.",
        );
      setting.addButton((button) => {
        button
          .setCta()
          .setButtonText('Run setup')
          .onClick(() => {
            void this.dependencies.openSetupWizard();
          });
      });
    };

    const handleChange = (): void => {
      const activeInstall = this.dependencies.sidecarInstallManager.getState().activeInstall;

      if (activeInstall !== null && this.missingSidecarProgressEl !== null) {
        updateInstallProgressElement(
          this.missingSidecarProgressEl,
          buildSidecarProgressState(activeInstall),
        );
        return;
      }

      void render();
    };

    void render();
    const unsubscribe = this.dependencies.sidecarInstallManager.subscribe(handleChange);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }

  private resolvePluginDirectorySafe(): Promise<string | null> {
    return resolvePluginDirectorySafe(
      this.dependencies.resolvePluginDirectory,
      this.dependencies.logger,
    );
  }

  private buildSidecarInstallActionDeps(): SidecarInstallActionDeps {
    return {
      app: this.app,
      feedback: this.dependencies.feedback,
      isDictationBusy: this.dependencies.isDictationBusy,
      logger: this.dependencies.logger,
      modelInstallManager: this.dependencies.modelInstallManager,
      pluginVersion: this.dependencies.pluginVersion,
      refreshSettingsTab: () => {
        this.display();
      },
      restartSidecar: this.dependencies.restartSidecar,
      sidecarConnection: this.dependencies.sidecarConnection,
      sidecarInstallManager: this.dependencies.sidecarInstallManager,
    };
  }
}
