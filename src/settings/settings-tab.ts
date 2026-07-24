import type { App, Plugin, SettingDefinitionItem } from 'obsidian';
import { Platform, PluginSettingTab, Setting } from 'obsidian';

import { formatSystemAudioProbeResultMessage } from '../audio/system-audio-permission-message';
import {
  dictationLanguageLabel,
  isDictationLanguage,
  supportedDictationLanguageOptions,
} from '../language/dictation-language';
import type { ModelPickerOptions } from '../models/manage-models-modal';
import type { ModelInstallManager } from '../models/model-install-manager';
import {
  ExternalModelFileModal,
  openSelectedModelDetailsModal,
} from '../models/model-management-modals';
import { deriveCurrentModelDisplay } from '../models/model-row-state';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { SpeakingStyle } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import type { SidecarInstallManager } from '../sidecar/sidecar-install-manager';
import type { SidecarLifecycleGate } from '../sidecar/sidecar-lifecycle-gate';
import { ConfirmModal } from '../ui/confirm-modal';
import { styleDestructiveButton } from '../ui/destructive-button';
import { diarizationSettingDescription } from './diarization-setting';
import { DiarizationSettingsModal } from './diarization-settings-modal';
import { changeHardwareAcceleration } from './hardware-acceleration-action';
import { renderHardwareAccelerationSetting } from './hardware-acceleration-setting';
import { renderMicrophonePicker } from './microphone-picker';
import { renderModelSection } from './model-settings-section';
import { openFilteredHotkeySettings } from './open-hotkey-settings';
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
  isTranscriptFormattingMode,
  MAX_TTS_SPEED,
  MIN_TTS_SPEED,
  type PluginSettings,
  type TranscriptFormattingMode,
} from './plugin-settings';
import { renderTextToSpeechSettings } from './read-aloud-settings-section';
import {
  addEnumSetting,
  addTextSetting,
  addToggleSetting,
  appendInfoTooltip,
  createSettingGroup,
  type DropdownOption,
  type SettingAccess,
} from './setting-helpers';
import { mountSettingsSidecarSurfaces } from './settings-sidecar-surfaces';
import {
  openCudaInstallModal,
  openSidecarUpdateModal,
  type SidecarInstallActionDeps,
} from './sidecar-settings-section';
import { SmartParagraphSettingsModal } from './smart-paragraph-settings-modal';
import { isSystemAudioSupportedOnCurrentPlatform } from './system-audio-support';
import { TimestampSettingsModal } from './timestamp-settings-modal';

interface SettingsTabDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getSettings: () => PluginSettings;
  isDictationBusy: () => boolean;
  logger?: PluginLogger | undefined;
  modelInstallManager: ModelInstallManager;
  openModelPicker: (options?: ModelPickerOptions) => Promise<void>;
  openSetupWizard: () => Promise<void>;
  pluginVersion: string;
  resolvePluginDirectory: () => Promise<string>;
  resetLlmTransformation: () => Promise<void>;
  restartSidecar: () => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  sidecarConnection: Pick<SidecarConnection, 'probeSystemAudio' | 'shutdown'>;
  sidecarInstallManager: SidecarInstallManager;
  sidecarLifecycleGate: SidecarLifecycleGate;
}

const LISTENING_MODE_OPTIONS: ReadonlyArray<DropdownOption<'always_on' | 'one_sentence'>> = [
  { label: t('settings.listeningMode.alwaysOn'), value: 'always_on' },
  { label: t('settings.listeningMode.oneSentence'), value: 'one_sentence' },
];

const DICTATION_ANCHOR_OPTIONS: ReadonlyArray<DropdownOption<DictationAnchor>> = [
  { label: t('settings.insertText.atCursor'), value: 'at_cursor' },
  { label: t('settings.insertText.endOfNote'), value: 'end_of_note' },
];

const TRANSCRIPT_FORMATTING_OPTIONS: ReadonlyArray<DropdownOption<TranscriptFormattingMode>> = [
  { label: t('settings.transcriptFormatting.smartParagraphs'), value: 'smart' },
  { label: t('settings.transcriptFormatting.space'), value: 'space' },
  { label: t('settings.transcriptFormatting.newLine'), value: 'new_line' },
  { label: t('settings.transcriptFormatting.newParagraph'), value: 'new_paragraph' },
];

const SPEAKING_STYLE_OPTIONS: ReadonlyArray<DropdownOption<SpeakingStyle>> = [
  { label: t('settings.phraseFinalization.responsiveOption'), value: 'responsive' },
  { label: t('settings.phraseFinalization.balancedOption'), value: 'balanced' },
  { label: t('settings.phraseFinalization.patientOption'), value: 'patient' },
];

// The settings tab is highly dynamic: model/install state, platform capabilities,
// microphone enumeration, and several controls with side effects all affect its
// contents. Obsidian's declarative `render` escape hatch lets 1.13+ index that UI
// without duplicating it. Keep every user-facing setting name here so global
// settings search can match the single composite definition in the active locale.
const SETTINGS_SEARCH_ALIAS_KEYS = [
  'settings.groups.model',
  'settings.model.speechToText',
  'settings.model.textToSpeech',
  'settings.model.manageModels',
  'settings.model.useExternalFile',
  'settings.model.details',
  'settings.dictationLanguage.name',
  'settings.groups.readAloud',
  'settings.readAloud.hotkey',
  'settings.readAloud.voice',
  'settings.readAloud.speed',
  'settings.groups.capture',
  'settings.microphone.name',
  'settings.microphone.default',
  'settings.systemAudio.name',
  'settings.listeningMode.name',
  'settings.listeningMode.alwaysOn',
  'settings.listeningMode.oneSentence',
  'settings.phraseFinalization.name',
  'settings.phraseFinalization.responsiveOption',
  'settings.phraseFinalization.balancedOption',
  'settings.phraseFinalization.patientOption',
  'settings.groups.transcriptOutput',
  'settings.insertText.name',
  'settings.insertText.atCursor',
  'settings.insertText.endOfNote',
  'settings.transcriptFormatting.name',
  'settings.transcriptFormatting.smartParagraphs',
  'settings.transcriptFormatting.space',
  'settings.transcriptFormatting.newLine',
  'settings.transcriptFormatting.newParagraph',
  'settings.smartParagraph.modal.title',
  'settings.smartParagraph.lineBreakPause.name',
  'settings.smartParagraph.paragraphPause.name',
  'settings.speakerLabels.name',
  'settings.speakerLabels.modal.title',
  'settings.speakerLabels.maximumSpeakers.name',
  'settings.groups.timestamps',
  'settings.timestamps.enable.name',
  'settings.timestamps.modal.title',
  'settings.timestamps.sessionHeader.name',
  'settings.timestamps.referenceClock.name',
  'settings.timestamps.frequency.name',
  'settings.timestamps.interval.name',
  'settings.groups.llmTransformation',
  'settings.llm.enableFeatures.name',
  'settings.llm.enableRemote.name',
  'settings.llm.restoreDefaults.name',
  'settings.groups.engine',
  'settings.hardwareAcceleration.name',
  'settings.noteContext.name',
  'settings.groups.advanced',
  'settings.attention.heading',
  'setup.sidecar.update.title_one',
  'setup.sidecar.update.title_other',
  'settings.attention.installCuda.name',
  'settings.attention.enableCuda.name',
  'settings.missingSidecar.name',
  'settings.sidecar.name',
  'settings.sidecar.cpuName',
  'settings.sidecar.gpuName',
  'settings.sidecar.cudaLibraryPath.name',
  'settings.recoveryMemory.name',
  'settings.modelStoreOverride.name',
  'settings.runSetup.name',
] as const;

const SETTINGS_SEARCH_LITERAL_ALIASES = [
  'Developer mode',
  'Sidecar path override',
  'Startup timeout',
  'Request timeout',
] as const;

export class LocalSttSettingTab extends PluginSettingTab {
  override readonly icon = 'audio-lines';

  private readonly access: SettingAccess;
  private disposeDiarizationDesc: (() => void) | null = null;
  private disposeEngineSection: (() => void) | null = null;
  private disposeMicrophoneSection: (() => void) | null = null;
  private disposeModelSection: (() => void) | null = null;
  private disposeReadAloudSection: (() => void) | null = null;
  private disposeSidecarSurfaces: (() => void) | null = null;

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

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        aliases: [
          ...new Set([
            ...SETTINGS_SEARCH_ALIAS_KEYS.map((key) => t(key)),
            ...SETTINGS_SEARCH_LITERAL_ALIASES,
          ]),
        ],
        name: t('plugin.name'),
        render: (setting) => {
          // Replace the declarative row instead of nesting the existing setting
          // groups inside `.setting-item`, which would change Obsidian's layout.
          const parent = setting.settingEl.parentElement;
          if (parent === null) return;
          const host = parent.createDiv();
          setting.settingEl.replaceWith(host);
          this.renderSettings(host);

          return () => {
            this.tearDown();
            host.remove();
          };
        },
      },
    ];
  }

  override display(): void {
    this.renderSettings(this.containerEl);
  }

  private renderSettings(containerEl: HTMLElement): void {
    this.tearDown();
    const settings = this.dependencies.getSettings();
    const sidecarActionDeps = this.buildSidecarInstallActionDeps();

    containerEl.empty();

    const attentionContainer = containerEl.createDiv();

    // --- Model ---
    const modelSection = createSettingGroup(containerEl, t('settings.groups.model'));
    const modelSummary = modelSection.createDiv();
    const manager = this.dependencies.modelInstallManager;
    this.disposeModelSection = renderModelSection(modelSummary, manager, {
      onManageModels: () => {
        void this.dependencies.openModelPicker({
          initialTask: 'stt',
          onChanged: () => {
            this.refreshSettingsTab();
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
              this.refreshSettingsTab();
            },
          },
        ).open();
      },
      onModelInfo:
        settings.selectedModel?.kind === 'catalog_model'
          ? this.buildModelInfoCallback(manager, 'stt')
          : null,
    });

    const modelState = manager.getState();
    const selectedCapabilities = modelState.selectedModelCapabilities;
    const languageSupport =
      selectedCapabilities.status === 'ready'
        ? selectedCapabilities.capabilities.family.supportedLanguages
        : ({ kind: 'english_only' } as const);
    const isSelectedModelEnglishOnly =
      selectedCapabilities.status === 'ready' && languageSupport.kind === 'english_only';
    const supportsAutomaticLanguageDetection =
      selectedCapabilities.status === 'ready' &&
      selectedCapabilities.capabilities.family.supportsAutomaticLanguageDetection;
    const languageOptions = supportedDictationLanguageOptions(
      languageSupport,
      supportsAutomaticLanguageDetection,
    );
    const selectedLanguage = settings.dictationLanguage;
    const languageSetting = new Setting(modelSection)
      .setName(t('settings.dictationLanguage.name'))
      .setDesc(
        isSelectedModelEnglishOnly
          ? t('settings.dictationLanguage.englishOnlyDesc', {
              model: deriveCurrentModelDisplay(modelState).displayName,
            })
          : t('settings.dictationLanguage.desc'),
      );
    languageSetting.addDropdown((dropdown) => {
      for (const option of languageOptions) {
        dropdown.addOption(option.value, option.label);
      }
      if (!languageOptions.some((option) => option.value === selectedLanguage)) {
        dropdown.addOption(
          selectedLanguage,
          t('settings.dictationLanguage.unsupported', {
            language: dictationLanguageLabel(selectedLanguage),
          }),
        );
      }
      dropdown.setValue(selectedLanguage);
      dropdown.setDisabled(
        languageOptions.length === 1 &&
          languageOptions.some((option) => option.value === selectedLanguage),
      );
      dropdown.onChange(async (value) => {
        if (!isDictationLanguage(value)) return;
        await this.access.persistOne('dictationLanguage', value);
      });
    });

    // --- Capture ---
    const captureCard = createSettingGroup(containerEl, t('settings.groups.capture'));

    const systemAudioSupported = isSystemAudioSupportedOnCurrentPlatform();

    this.disposeMicrophoneSection = renderMicrophonePicker(captureCard, {
      access: this.access,
      feedback: this.dependencies.feedback,
      isDictationBusy: this.dependencies.isDictationBusy,
      logger: this.dependencies.logger,
    });

    if (systemAudioSupported) {
      addToggleSetting(captureCard, this.access, {
        name: t('settings.systemAudio.name'),
        desc: t('settings.systemAudio.desc'),
        key: 'includeSystemAudio',
        onChange: async (value) => {
          // First-ever probe is the designed moment for the macOS TCC prompt.
          if (value && Platform.isMacOS && !(await this.probeSystemAudio())) {
            // Capture cannot work; leaving the toggle on would just fail
            // every session start with the same error.
            await this.access.persistOne('includeSystemAudio', false);
            this.refreshSettingsTab();
          }
        },
      });
    }

    addEnumSetting(captureCard, this.access, {
      name: t('settings.listeningMode.name'),
      desc: t('settings.listeningMode.desc'),
      key: 'listeningMode',
      options: LISTENING_MODE_OPTIONS,
      isValid: isListeningMode,
    });

    const phraseFinalizationSetting = new Setting(captureCard)
      .setName(t('settings.phraseFinalization.name'))
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

    const outputCard = createSettingGroup(containerEl, t('settings.groups.transcriptOutput'));

    addEnumSetting(outputCard, this.access, {
      name: t('settings.insertText.name'),
      desc: t('settings.insertText.desc'),
      key: 'dictationAnchor',
      options: DICTATION_ANCHOR_OPTIONS,
      isValid: isDictationAnchor,
    });

    this.renderTranscriptFormattingSetting(outputCard);

    const diarizationSetting = addToggleSetting(outputCard, this.access, {
      name: t('settings.speakerLabels.name'),
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
    diarizationSetting.addExtraButton((button) => {
      button
        .setIcon('sliders-horizontal')
        .setTooltip(t('settings.speakerLabels.modal.title'))
        .onClick(() => {
          new DiarizationSettingsModal(this.app, {
            getSettings: () => this.dependencies.getSettings(),
            onSave: () => {
              this.refreshSettingsTab();
            },
            saveSettings: async (nextSettings) => {
              await this.dependencies.saveSettings(nextSettings);
            },
          }).open();
        });
      button.extraSettingsEl.setAttribute('aria-label', t('settings.speakerLabels.modal.title'));
    });

    const timestampsCard = createSettingGroup(containerEl, t('settings.groups.timestamps'));
    this.renderTimestampSettings(timestampsCard, settings);

    // --- Read aloud ---
    const readAloudSection = createSettingGroup(containerEl, t('settings.groups.readAloud'));
    const hotkeySetting = new Setting(readAloudSection)
      .setName(t('settings.readAloud.hotkey'))
      .setDesc(t('settings.readAloud.hotkeyDesc'))
      .addButton((button) => {
        button.setButtonText(t('setup.wizard.openHotkeySettings')).onClick(() => {
          openFilteredHotkeySettings(this.app, t('commands.readAloud'), (error) => {
            this.dependencies.feedback.show({
              cause: error,
              intent: 'warning',
              message: t('setup.wizard.openHotkeySettingsFallback'),
            });
          });
        });
      });

    new Setting(readAloudSection)
      .setName(t('settings.readAloud.speed'))
      .setDesc(t('settings.readAloud.speedDesc'))
      .addSlider((slider) => {
        slider
          .setLimits(MIN_TTS_SPEED, MAX_TTS_SPEED, 0.05)
          .setValue(settings.ttsSpeed)
          .setDynamicTooltip()
          .onChange(async (speed) => {
            await this.access.persistOne('ttsSpeed', speed);
          });
      });

    this.disposeReadAloudSection = renderTextToSpeechSettings(
      modelSection,
      languageSetting.settingEl,
      readAloudSection,
      hotkeySetting.settingEl,
      {
        getSettings: () => this.dependencies.getSettings(),
        manager,
        openSelectedModelDetails: this.buildModelInfoCallback(manager, 'tts'),
        openModelPicker: (options) => this.dependencies.openModelPicker(options),
        persistVoice: (voice) => this.access.persistOne('selectedTtsVoice', voice),
      },
    );

    const llmCard = createSettingGroup(containerEl, t('settings.groups.llmTransformation'));
    const enableLlmSetting = new Setting(llmCard)
      .setName(t('settings.llm.enableFeatures.name'))
      .setDesc(t('settings.llm.enableFeatures.desc'));
    enableLlmSetting.addToggle((toggle) => {
      toggle.setValue(settings.llmFeaturesEnabled);
      toggle.onChange(async (value) => {
        await this.access.persistOne('llmFeaturesEnabled', value);
        this.refreshSettingsTab();
      });
    });

    const remoteLlmSetting = new Setting(llmCard)
      .setName(t('settings.llm.enableRemote.name'))
      .setDesc(t('settings.llm.enableRemote.desc'));
    remoteLlmSetting.addToggle((toggle) => {
      toggle.setValue(isRemoteLlmEffectivelyEnabled(settings));
      toggle.setDisabled(!settings.llmFeaturesEnabled);
      toggle.onChange(async (value) => {
        if (!this.dependencies.getSettings().llmFeaturesEnabled) return;
        await this.access.persistOne('llmRemoteFeaturesEnabled', value);
      });
    });

    new Setting(llmCard)
      .setName(t('settings.llm.restoreDefaults.name'))
      .setDesc(t('settings.llm.restoreDefaults.desc'))
      .addButton((button) => {
        styleDestructiveButton(
          button.setButtonText(t('settings.llm.restoreDefaults.button')),
        ).onClick(() => {
          new ConfirmModal(this.app, {
            confirmLabel: t('settings.llm.restoreDefaults.button'),
            destructive: true,
            message: t('settings.llm.restoreDefaults.confirmMessage'),
            onConfirm: async () => {
              await this.dependencies.resetLlmTransformation();
              this.refreshSettingsTab();
            },
            title: t('settings.llm.restoreDefaults.name'),
          }).open();
        });
      });

    // --- Engine options ---
    // Built inline (rather than via createSettingGroup) so renderEngineOptions
    // can hide the whole card when no rows apply (e.g. macOS + a model with
    // no initial-prompt support).
    const engineGroup = containerEl.createDiv({ cls: 'setting-group' });
    const engineHeading = new Setting(engineGroup)
      .setName(t('settings.groups.engine'))
      .setHeading();
    const engineSection = engineGroup.createDiv({ cls: 'setting-items' });
    const renderEngine = (): void => {
      this.renderEngineOptions(engineGroup, engineHeading, engineSection);
    };
    renderEngine();
    this.disposeEngineSection = manager.subscribe(renderEngine);

    // --- Advanced (includes sidecar install/uninstall) ---
    const advancedSection = createSettingGroup(containerEl, t('settings.groups.advanced'));

    // Sidecar rows live in their own owned container so re-renders can simply
    // empty + rebuild without disturbing the rest of the Advanced section.
    const sidecarContainer = advancedSection.createDiv();
    this.disposeSidecarSurfaces = mountSettingsSidecarSurfaces(
      attentionContainer,
      sidecarContainer,
      {
        advanced: {
          ...sidecarActionDeps,
          access: this.access,
          resolvePluginDirectory: this.dependencies.resolvePluginDirectory,
        },
        attention: {
          actions: {
            enableCuda: async () => {
              await changeHardwareAcceleration(
                {
                  access: this.access,
                  feedback: this.dependencies.feedback,
                  restartSidecar: this.dependencies.restartSidecar,
                  sidecarLifecycleGate: this.dependencies.sidecarLifecycleGate,
                },
                true,
              );
              this.refreshSettingsTab();
            },
            installCuda: (pluginDirectory) => {
              openCudaInstallModal(sidecarActionDeps, this.access, pluginDirectory);
            },
            openSetup: this.dependencies.openSetupWizard,
            updateSidecars: (pluginDirectory, variants) => {
              openSidecarUpdateModal(sidecarActionDeps, { pluginDirectory, variants });
            },
          },
          getSettings: this.dependencies.getSettings,
          logger: this.dependencies.logger,
          pluginVersion: this.dependencies.pluginVersion,
          resolvePluginDirectory: this.dependencies.resolvePluginDirectory,
          sidecarInstallManager: this.dependencies.sidecarInstallManager,
        },
      },
    );

    addToggleSetting(advancedSection, this.access, {
      name: t('settings.recoveryMemory.name'),
      desc: t('settings.recoveryMemory.desc'),
      key: 'retainLastUtterance',
    });

    addTextSetting(advancedSection, this.access, {
      name: t('settings.modelStoreOverride.name'),
      desc: t('settings.modelStoreOverride.desc'),
      key: 'modelStorePathOverride',
      placeholder: t('settings.modelStoreOverride.placeholder'),
    });

    new Setting(advancedSection)
      .setName(t('settings.runSetup.name'))
      .setDesc(t('settings.runSetup.desc'))
      .addButton((button) => {
        button.setButtonText(t('settings.runSetup.name')).onClick(() => {
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
        this.refreshSettingsTab();
      });
    });
  }

  override hide(): void {
    this.tearDown();
  }

  private tearDown(): void {
    this.disposeModelSection?.();
    this.disposeModelSection = null;
    this.disposeReadAloudSection?.();
    this.disposeReadAloudSection = null;
    this.disposeDiarizationDesc?.();
    this.disposeDiarizationDesc = null;
    this.disposeEngineSection?.();
    this.disposeEngineSection = null;
    this.disposeMicrophoneSection?.();
    this.disposeMicrophoneSection = null;
    this.disposeSidecarSurfaces?.();
    this.disposeSidecarSurfaces = null;
  }

  private refreshSettingsTab(): void {
    // `update()` was added in Obsidian 1.13. Keep the runtime feature check so
    // the legacy display path continues to work at the manifest's 1.11.5 floor.
    const update = (this as { update?: () => void }).update;
    if (typeof update === 'function') {
      update.call(this);
      return;
    }
    const display = (this as { display: () => void }).display;
    display.call(this);
  }

  /** Returns whether the probe confirmed capture is usable. */
  private async probeSystemAudio(): Promise<boolean> {
    try {
      const result = await this.dependencies.sidecarConnection.probeSystemAudio();
      if (result.ok) {
        this.dependencies.feedback.show({
          intent: 'success',
          message: t('settings.systemAudio.ready'),
        });
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
        message: t('settings.systemAudio.testFailed'),
      });
    }
    return false;
  }

  private renderTranscriptFormattingSetting(parent: HTMLElement): void {
    const setting = addEnumSetting(parent, this.access, {
      name: t('settings.transcriptFormatting.name'),
      desc: t('settings.transcriptFormatting.desc'),
      key: 'transcriptFormatting',
      options: TRANSCRIPT_FORMATTING_OPTIONS,
      isValid: isTranscriptFormattingMode,
    });

    setting.addExtraButton((button) => {
      button
        .setIcon('sliders-horizontal')
        .setTooltip(t('settings.smartParagraph.modal.title'))
        .onClick(() => {
          new SmartParagraphSettingsModal(this.app, {
            getSettings: () => this.dependencies.getSettings(),
            onSave: () => {
              this.refreshSettingsTab();
            },
            saveSettings: async (settings) => {
              await this.dependencies.saveSettings(settings);
            },
          }).open();
        });
      button.extraSettingsEl.setAttribute('aria-label', t('settings.smartParagraph.modal.title'));
    });
  }

  private renderTimestampSettings(parent: HTMLElement, settings: PluginSettings): void {
    const setting = new Setting(parent)
      .setName(t('settings.timestamps.enable.name'))
      .setDesc(t('settings.timestamps.enable.desc'))
      .addToggle((toggle) => {
        toggle.setValue(settings.timestampsEnabled);
        toggle.onChange(async (value) => {
          await this.access.persistOne('timestampsEnabled', value);
        });
      });

    setting.addExtraButton((button) => {
      button
        .setIcon('sliders-horizontal')
        .setTooltip(t('settings.timestamps.modal.title'))
        .onClick(() => {
          new TimestampSettingsModal(this.app, {
            getSettings: () => this.dependencies.getSettings(),
            onSave: () => {
              this.refreshSettingsTab();
            },
            saveSettings: async (nextSettings) => {
              await this.dependencies.saveSettings(nextSettings);
            },
          }).open();
        });
      button.extraSettingsEl.setAttribute('aria-label', t('settings.timestamps.modal.title'));
    });
  }

  private buildModelInfoCallback(manager: ModelInstallManager, task: 'stt' | 'tts'): () => void {
    return () => {
      openSelectedModelDetailsModal(this.app, manager, task);
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
    heading.setName(
      selectedAdapter === null
        ? t('settings.groups.engine')
        : t('settings.engine.named', { engine: selectedAdapter.displayName }),
    );

    let rendered = 0;

    const hasNonCpuAccelerator =
      selectedRuntime?.runtimeCapabilities.availableAccelerators.some((id) => id !== 'cpu') ??
      false;

    if (!Platform.isMacOS && hasNonCpuAccelerator) {
      renderHardwareAccelerationSetting(containerEl, {
        access: this.access,
        feedback: this.dependencies.feedback,
        restartSidecar: this.dependencies.restartSidecar,
        sidecarLifecycleGate: this.dependencies.sidecarLifecycleGate,
      });
      rendered += 1;
    }

    const caps = state.selectedModelCapabilities;
    if (caps.status === 'ready' && caps.capabilities.family.supportsInitialPrompt) {
      addToggleSetting(containerEl, this.access, {
        name: t('settings.noteContext.name'),
        desc: t('settings.noteContext.desc'),
        tooltip: t('settings.noteContext.tooltip'),
        key: 'useNoteAsContext',
      });
      rendered += 1;
    }

    group.toggleClass('local-stt-hidden', rendered === 0);
  }

  private buildSidecarInstallActionDeps(): SidecarInstallActionDeps {
    return {
      app: this.app,
      feedback: this.dependencies.feedback,
      logger: this.dependencies.logger,
      modelInstallManager: this.dependencies.modelInstallManager,
      pluginVersion: this.dependencies.pluginVersion,
      refreshSettingsTab: () => {
        this.refreshSettingsTab();
      },
      restartSidecar: this.dependencies.restartSidecar,
      sidecarConnection: this.dependencies.sidecarConnection,
      sidecarInstallManager: this.dependencies.sidecarInstallManager,
      sidecarLifecycleGate: this.dependencies.sidecarLifecycleGate,
    };
  }
}
