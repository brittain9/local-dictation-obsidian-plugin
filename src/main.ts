import { dirname, join } from 'node:path';
import { IS_PRODUCTION_BUILD } from 'virtual:build-mode';
import { FileSystemAdapter, getLanguage, Menu, Platform, Plugin, setIcon } from 'obsidian';

import { AudioCaptureStream } from './audio/audio-capture-stream';
import { SidecarAudioLevelMeter } from './audio/sidecar-audio-level-meter';
import { registerCommands } from './commands/register-commands';
import { DictationSessionController } from './dictation/dictation-session-controller';
import { FinalizedUtteranceAutoCopy } from './dictation/finalized-utterance-auto-copy';
import { LastUtteranceRecovery } from './dictation/last-utterance-recovery';
import { dictationAnchorExtension } from './editor/dictation-anchor-extension';
import { noteSurfaceUpdateListenerExtension } from './editor/note-surface';
import { provisionalTranscriptExtension } from './editor/provisional-transcript-extension';
import { RawTranscriptRecovery } from './editor/raw-transcript-recovery';
import { sessionProcessingExtension } from './editor/session-processing-extension';
import { TemporaryLeafPinLeaseManager } from './editor/temporary-leaf-pin';
import { syncDictationLanguageWithObsidian } from './language/dictation-language-sync';
import type { LlmCleanupFailure } from './llm/provider';
import { createConfiguredLlmRouter } from './llm/runtime';
import { ManageModelsModal, type ModelPickerOptions } from './models/manage-models-modal';
import { ModelInstallManager } from './models/model-install-manager';
import {
  type CatalogModelRecord,
  type CatalogModelSelection,
  matchesModelTriple,
} from './models/model-management-types';
import {
  openModelPickerWithSetup,
  READ_ALOUD_MODEL_PICKER_OPTIONS,
} from './models/model-picker-routing';
import { Session } from './session/session';
import { logAccelerationFallbacks } from './settings/acceleration-info';
import { LlmPresetStateStore } from './settings/llm-preset-state';
import { restoreLlmTransformationDefaults } from './settings/llm-transformation-reset';
import { handleMicrophoneDeviceFallback } from './settings/microphone-fallback';
import { loadPluginSettings } from './settings/openrouter-secret-storage';
import {
  DEFAULT_PLUGIN_SETTINGS,
  type PluginSettings,
  resolvePluginSettings,
} from './settings/plugin-settings';
import { LocalSttSettingTab } from './settings/settings-tab';
import {
  openSidecarUpdateModal,
  type SidecarInstallActionDeps,
} from './settings/sidecar-settings-section';
import { SetupWizardModal } from './setup/setup-wizard-modal';
import { formatVoiceLabel } from './shared/format-utils';
import { t } from './shared/i18n';
import { createObsidianFeedbackPresenter } from './shared/obsidian-feedback-presenter';
import { createPluginLogger, type PluginLogger } from './shared/plugin-logger';
import { createUserFeedback, type UserFeedback } from './shared/user-feedback';
import {
  createCudaCompatibilityProvider,
  isCudaSidecarUsable,
  resolveCudaSidecarLaunchPolicy,
} from './sidecar/cuda-compatibility';
import { isCudaReleaseTarget } from './sidecar/gpu-precheck';
import { assertSidecarExecutableIsFresh } from './sidecar/sidecar-build-state';
import { SidecarConnection } from './sidecar/sidecar-connection';
import { formatSidecarExecutableName } from './sidecar/sidecar-executable';
import { SidecarInstallManager } from './sidecar/sidecar-install-manager';
import {
  SidecarLifecycleConflictError,
  SidecarLifecycleGate,
} from './sidecar/sidecar-lifecycle-gate';
import {
  type ResolvedSidecarExecutable,
  type ResolveSidecarExecutablePathOptions,
  resolveSidecarExecutablePath,
  SidecarNotInstalledError,
} from './sidecar/sidecar-paths';
import type { SidecarLaunchSpec } from './sidecar/sidecar-process';
import {
  detectSidecarVersionDrift,
  type SidecarVersionDrift,
} from './sidecar/sidecar-version-drift';
import { TranslationController } from './translation/translation-controller';
import { READ_ALOUD_SPEED_PRESETS, readAloudControlLabels } from './tts/read-aloud-control-labels';
import { ReadAloudController, type ReadAloudState } from './tts/read-aloud-controller';
import { didReadAloudSettingsChange, resolveReadAloudVoiceId } from './tts/read-aloud-selection';
import { DictationRibbonController } from './ui/dictation-ribbon';
import { LOCAL_DICTATION_VIEW_TYPE, LocalDictationView } from './ui/local-dictation-view';

export default class LocalSttPlugin extends Plugin {
  private audioCaptureStream: AudioCaptureStream | null = null;
  private audioLevelMeter: SidecarAudioLevelMeter | null = null;
  private dictationController: DictationSessionController | null = null;
  /**
   * Session-scoped so sidecar selection and version-drift repair can never
   * disagree about whether CUDA is usable here. Settings owns a separate
   * per-display provider, which is what picks up a newly installed driver.
   */
  private readonly getCudaCompatibility = createCudaCompatibilityProvider();
  private readonly sidecarLifecycleGate = new SidecarLifecycleGate();
  private logger: PluginLogger = createPluginLogger(() => this.settings.developerMode);
  private readonly feedback: UserFeedback = createUserFeedback({
    logger: this.logger,
    presenter: createObsidianFeedbackPresenter(),
  });
  private readonly finalizedUtteranceAutoCopy = new FinalizedUtteranceAutoCopy({
    feedback: this.feedback,
    getClipboard: () => window.navigator.clipboard,
    getSettings: () => this.settings,
  });
  private llmCleanupFailure: LlmCleanupFailure | null = null;
  private readonly lastUtteranceRecovery = new LastUtteranceRecovery(this.feedback);
  private readonly llmCleanupFailureSubscribers = new Set<() => void>();
  private modelInstallManager: ModelInstallManager | null = null;
  private presetStateStore: LlmPresetStateStore | null = null;
  private readonly rawTranscriptRecovery = new RawTranscriptRecovery({
    feedback: this.feedback,
    getClipboard: () => window.navigator.clipboard,
    workspace: this.app.workspace,
  });
  private ribbonController: DictationRibbonController | null = null;
  private readAloudController: ReadAloudController | null = null;
  private releaseReadAloudModelSubscription: (() => void) | null = null;
  private readAloudStatus: HTMLElement | null = null;
  override settings: PluginSettings = DEFAULT_PLUGIN_SETTINGS;
  private sidecarConnection: SidecarConnection | null = null;
  private sidecarInstallManager: SidecarInstallManager | null = null;
  private readonly temporaryLeafPinLeaseManager = new TemporaryLeafPinLeaseManager();
  private translationController: TranslationController | null = null;

  override async onload(): Promise<void> {
    const persistedData: unknown = await this.loadData();
    const loadedSettings = loadPluginSettings(persistedData, this.app.secretStorage);
    const languageSync = syncDictationLanguageWithObsidian(
      loadedSettings.settings,
      persistedData,
      getLanguage(),
    );
    this.settings = languageSync.settings;
    this.lastUtteranceRecovery.setEnabled(this.settings.retainLastUtterance);
    this.rawTranscriptRecovery.setEnabled(this.settings.retainLastUtterance);
    if (loadedSettings.shouldPersist || languageSync.shouldPersist) {
      await this.saveData(this.settings);
    }
    this.presetStateStore = new LlmPresetStateStore({
      commit: async (nextSettings, options) => {
        await this.applySettings(nextSettings, options);
      },
      getSettings: () => this.settings,
      loadData: async (): Promise<unknown> => {
        const data: unknown = await this.loadData();
        return data;
      },
      onExternalChange: () => {
        this.requestLocalDictationSidebarRefresh();
      },
      warn: (message, error) => {
        this.logger.warn('settings', message, error);
      },
    });

    this.registerEditorExtension(dictationAnchorExtension());
    this.registerEditorExtension(noteSurfaceUpdateListenerExtension());
    this.registerEditorExtension(provisionalTranscriptExtension());
    this.registerEditorExtension(sessionProcessingExtension());
    this.sidecarConnection = new SidecarConnection({
      getRequestTimeoutMs: () => this.settings.sidecarRequestTimeoutSeconds * 1000,
      logger: this.logger,
      resolveLaunchSpec: async () => this.resolveSidecarLaunchSpec(),
    });
    this.audioLevelMeter = new SidecarAudioLevelMeter();
    this.audioCaptureStream = new AudioCaptureStream({
      logger: this.logger,
      onDeviceFallback: async (unavailableDeviceId) => {
        await handleMicrophoneDeviceFallback(unavailableDeviceId, {
          clearSelectionIfMatches: async (deviceId) =>
            this.requirePresetStateStore().commitPreservingPresetStateIf(
              (settings) => settings.audioInputDevice?.deviceId === deviceId,
              (settings) => ({ ...settings, audioInputDevice: null }),
            ),
          feedback: this.feedback,
        });
      },
      onUnexpectedEnd: (sessionId) => {
        void this.dictationController?.handleAudioCaptureEnded(sessionId);
      },
    });
    this.modelInstallManager = new ModelInstallManager({
      commitSettingsIf: (condition, createNextSettings) =>
        this.requirePresetStateStore().commitPreservingPresetStateIf(condition, createNextSettings),
      getSettings: () => this.settings,
      logger: this.logger,
      saveSettings: async (nextSettings) => {
        await this.updateSettings(nextSettings);
      },
      sidecarConnection: this.sidecarConnection,
      sidecarLifecycleGate: this.sidecarLifecycleGate,
    });
    this.sidecarInstallManager = new SidecarInstallManager({
      feedback: this.feedback,
      logger: this.logger,
      sidecarLifecycleGate: this.sidecarLifecycleGate,
    });
    this.registerView(
      LOCAL_DICTATION_VIEW_TYPE,
      (leaf) =>
        new LocalDictationView(leaf, {
          feedback: this.feedback,
          getSecret: (secretId) => this.getSecret(secretId),
          getSettings: () => this.settings,
          getLlmCleanupFailure: () => this.llmCleanupFailure,
          logger: this.logger,
          saveSettings: async (nextSettings) => {
            await this.updateSettings(nextSettings);
          },
          mutatePresetState: async (mutation) => {
            await this.requirePresetStateStore().mutate(mutation);
          },
          synchronizePresets: async () => {
            await this.requirePresetStateStore().synchronize();
          },
          subscribeLlmCleanupFailure: (callback) => {
            this.llmCleanupFailureSubscribers.add(callback);
            return () => {
              this.llmCleanupFailureSubscribers.delete(callback);
            };
          },
        }),
    );

    const ribbonElement = this.addRibbonIcon('mic', t('ribbon.idle'), () => {
      void this.requireDictationController().toggleDictation();
    });
    this.ribbonController = new DictationRibbonController(ribbonElement);
    this.ribbonController.setVisualizer(this.audioLevelMeter);
    this.dictationController = new DictationSessionController({
      audioLevelMeter: this.audioLevelMeter,
      captureStream: this.audioCaptureStream,
      createSession: ({ callbacks, placement, rendererOptions, sessionId }) =>
        Session.createFromActiveEditor(this.app, {
          callbacks,
          leafPinManager: this.temporaryLeafPinLeaseManager,
          logger: this.logger,
          placement,
          rendererOptions,
          sessionId,
        }),
      createLlmRouter: (settings) =>
        createConfiguredLlmRouter(settings, (secretId) => this.getSecret(secretId)),
      getSettings: () => this.settings,
      hasDictationTarget: () => Session.hasDictationTarget(this.app),
      feedback: this.feedback,
      logger: this.logger,
      onBatchTranscriptReplacementAccepted: (text) => {
        void this.finalizedUtteranceAutoCopy.copyAcceptedUtterance(text);
      },
      onLlmCleanupFailure: (failure) => {
        this.llmCleanupFailure = failure;
        this.notifyLlmCleanupFailureSubscribers();
      },
      onLlmCleanupSuccess: () => {
        if (this.llmCleanupFailure !== null) {
          this.llmCleanupFailure = null;
          this.notifyLlmCleanupFailureSubscribers();
        }
      },
      onFinalizedUtteranceAccepted: (text) => {
        this.lastUtteranceRecovery.recordFinalizedUtterance(text);
        void this.finalizedUtteranceAutoCopy.copyAcceptedUtterance(text);
      },
      onRawTranscriptRecoveryAvailable: (receipt) => {
        this.rawTranscriptRecovery.record(receipt);
      },
      onModelMissing: () => {
        void this.openModelPicker();
      },
      onSidecarMissing: () => {
        void this.openSetupWizard();
      },
      setRibbonState: (state) => {
        this.ribbonController?.setState(state);
      },
      setRibbonQueueTier: (tier) => {
        this.ribbonController?.setQueueTier(tier);
      },
      sidecarConnection: this.sidecarConnection,
      sidecarLifecycleGate: this.sidecarLifecycleGate,
      stopConflictingSpeech: () => {
        this.readAloudController?.stop();
      },
    });
    this.readAloudStatus = this.addStatusBarItem();
    this.readAloudStatus.addClass('local-stt-read-aloud-status');
    this.readAloudController = new ReadAloudController({
      feedback: this.feedback,
      getCatalog: () => this.requireModelInstallManager().getState().catalog,
      getSettings: () => this.settings,
      isDictationBusy: () => this.requireDictationController().isCaptureActive(),
      logger: this.logger,
      onModelMissing: () => this.openModelPicker(READ_ALOUD_MODEL_PICKER_OPTIONS),
      onStateChange: (state) => this.renderReadAloudStatus(state),
      sidecarConnection: this.sidecarConnection,
      sidecarLifecycleGate: this.sidecarLifecycleGate,
      stopDictation: () => this.requireDictationController().stopDictation(),
    });
    this.renderReadAloudStatus('idle');
    this.releaseReadAloudModelSubscription = this.requireModelInstallManager().subscribe(() => {
      this.renderReadAloudStatus(this.readAloudController?.getState() ?? 'idle');
    });
    this.translationController = new TranslationController({
      app: this.app,
      feedback: this.feedback,
      getSettings: () => this.settings,
      logger: this.logger,
      modelManager: this.requireModelInstallManager(),
      openModelPicker: () => this.openModelPicker({ initialTask: 'translation' }),
      saveSettings: (nextSettings) => this.updateSettings(nextSettings),
    });

    this.addSettingTab(
      new LocalSttSettingTab(this.app, this, {
        feedback: this.feedback,
        getSettings: () => this.settings,
        isDictationBusy: () => this.dictationController?.isBusy() ?? false,
        logger: this.logger,
        modelInstallManager: this.requireModelInstallManager(),
        openModelPicker: (options) => this.openModelPicker(options),
        openSetupWizard: () => this.openSetupWizard(),
        pluginVersion: this.manifest.version,
        resolvePluginDirectory: () => this.resolvePluginDirectoryPath(),
        resetLlmTransformation: () =>
          restoreLlmTransformationDefaults({
            mutateSettings: (mutation) => this.requirePresetStateStore().mutateSettings(mutation),
          }),
        restartSidecar: async () => {
          await this.restartSidecarConnection();
        },
        saveSettings: async (nextSettings) => {
          await this.updateSettings(nextSettings);
        },
        sidecarConnection: this.requireSidecarConnection(),
        sidecarInstallManager: this.requireSidecarInstallManager(),
        sidecarLifecycleGate: this.sidecarLifecycleGate,
      }),
    );

    registerCommands({
      cancelDictation: async () => this.requireDictationController().cancelDictation(),
      clearLastUtterance: () => {
        this.lastUtteranceRecovery.clear();
        this.feedback.show({
          intent: 'success',
          key: 'last-utterance-cleared',
          message: t('notice.lastUtteranceCleared'),
        });
      },
      clearRawTranscriptRecovery: () => {
        this.rawTranscriptRecovery.clearWithFeedback();
      },
      checkSidecarHealth: async () => this.checkSidecarHealth(),
      copyRawTranscript: () => {
        void this.rawTranscriptRecovery.copyRawTranscript();
      },
      hasLastUtterance: () => this.lastUtteranceRecovery.hasUtterance(),
      hasRawTranscriptRecovery: () => this.rawTranscriptRecovery.hasRecovery(),
      isReadAloudActive: () => this.requireReadAloudController().isActive(),
      plugin: this,
      readAloud: (editor) => this.requireReadAloudController().read(editor),
      reinsertLastUtterance: (editor) => {
        this.lastUtteranceRecovery.reinsert(editor);
      },
      restoreRawTranscript: () => {
        this.rawTranscriptRecovery.restoreRawTranscript();
      },
      restartSidecar: async () => this.restartSidecar(),
      startDictation: async () => this.requireDictationController().startDictation(),
      stopReadAloud: () => this.requireReadAloudController().stop(),
      stopDictation: async () => this.requireDictationController().stopDictation(),
      translateNote: (editor) => this.requireTranslationController().translateNote(editor),
      translateSelection: (editor) =>
        this.requireTranslationController().translateSelection(editor),
      toggleDictation: async () => this.requireDictationController().toggleDictation(),
      toggleReadAloudPaused: () => this.requireReadAloudController().togglePaused(),
    });

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        if (!editor.somethingSelected()) return;
        menu.addItem((item) => {
          item
            .setTitle(t('commands.translateSelection'))
            .setIcon('languages')
            .onClick(() => {
              this.requireTranslationController().translateSelection(editor);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle(t('commands.readAloud'))
            .setIcon('audio-lines')
            .onClick(() => {
              void this.requireReadAloudController().read(editor);
            });
        });
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      void this.runPostLayoutStartup();
    });

    this.modelInstallManager?.init().catch((error: unknown) => {
      if (error instanceof SidecarNotInstalledError) {
        this.logger.debug('model', 'model install manager init skipped — sidecar not installed');
        return;
      }
      this.logger.error('model', 'model install manager init failed', error);
    });
  }

  private async runPostLayoutStartup(): Promise<void> {
    await this.bootstrapLocalDictationSidebar();

    try {
      await this.sidecarLifecycleGate.runUse(async () => {
        // Surface sidecar/plugin version drift before the health handshake. An
        // Obsidian update swaps the plugin files but never the separately-installed
        // sidecar, so a stale sidecar may even be the reason the handshake fails.
        await this.checkSidecarVersionDrift();

        await this.checkSidecarHealth({ showNotice: false, useLease: false });
        const systemInfo = await this.requireSidecarConnection().getSystemInfo();
        logAccelerationFallbacks(systemInfo, this.settings.accelerationPreference, this.logger);
      });
    } catch (error) {
      if (error instanceof SidecarNotInstalledError) {
        this.logger.debug('sidecar', 'sidecar not installed on startup');
        await this.openSetupWizard();
        return;
      }
      this.logger.error('sidecar', 'initial startup check failed', error);
    }
  }

  private async ensureLocalDictationSidebar(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(LOCAL_DICTATION_VIEW_TYPE).length > 0) {
      return;
    }

    const leaf = this.app.workspace.getLeftLeaf(false);
    await leaf?.setViewState({
      active: false,
      type: LOCAL_DICTATION_VIEW_TYPE,
    });
  }

  private async bootstrapLocalDictationSidebar(): Promise<void> {
    if (!this.settings.llmFeaturesEnabled) {
      return;
    }
    if (this.settings.localTranscriptSidebarBootstrapped) {
      return;
    }

    await this.ensureLocalDictationSidebar();
    await this.updateSettings({
      ...this.settings,
      localTranscriptSidebarBootstrapped: true,
    });
  }

  private async syncLocalDictationSidebar(): Promise<void> {
    if (!this.settings.llmFeaturesEnabled) {
      for (const leaf of this.app.workspace.getLeavesOfType(LOCAL_DICTATION_VIEW_TYPE)) {
        leaf.detach();
      }
      return;
    }

    await this.ensureLocalDictationSidebar();
  }

  async openSetupWizard(options: { throwOnFailure?: boolean } = {}): Promise<void> {
    let pluginDirectory: string;

    try {
      pluginDirectory = await this.resolvePluginDirectoryPath();
    } catch (error) {
      this.logger.error('installer', 'unable to resolve plugin directory for setup wizard', error);
      if (options.throwOnFailure ?? false) throw error;
      return;
    }

    const modal = new SetupWizardModal({
      app: this.app,
      feedback: this.feedback,
      hasDictationTarget: () => Session.hasDictationTarget(this.app),
      hasSelectedModel: () => this.settings.selectedModel !== null,
      isDictationBusy: () => this.requireDictationController().isBusy(),
      isSidecarInstalled: () => this.isSidecarInstalled(),
      logger: this.logger,
      modelInstallManager: this.requireModelInstallManager(),
      onCompleted: async () => {
        await this.updateSettings({
          ...this.settings,
          setupCompletedAt: new Date().toISOString(),
        });
      },
      pluginDirectory,
      pluginVersion: this.manifest.version,
      postSidecarInstalled: async () => {
        await this.restartSidecarConnection();
        const systemInfo = await this.requireSidecarConnection().getSystemInfo();
        logAccelerationFallbacks(systemInfo, this.settings.accelerationPreference, this.logger);
        await this.requireModelInstallManager().init();
      },
      sidecarConnection: this.requireSidecarConnection(),
      sidecarInstallManager: this.requireSidecarInstallManager(),
      sidecarStartupTimeoutMs: this.settings.sidecarStartupTimeoutSeconds * 1000,
      startDictation: () => this.requireDictationController().startDictation(),
    });
    modal.open();
  }

  async openModelPicker(options: ModelPickerOptions = {}): Promise<void> {
    await openModelPickerWithSetup(
      {
        isSidecarInstalled: () => this.isSidecarInstalled(),
        openPicker: (pickerOptions) => {
          new ManageModelsModal(this.app, {
            feedback: this.feedback,
            ...(pickerOptions.initialTask === undefined
              ? {}
              : { initialTask: pickerOptions.initialTask }),
            manager: this.requireModelInstallManager(),
            onChanged: pickerOptions.onChanged ?? (() => {}),
            onRunSetup: () => {
              void this.openSetupWizard();
            },
          }).open();
        },
        openSetupWizard: () => this.openSetupWizard({ throwOnFailure: true }),
      },
      options,
    );
  }

  private async isSidecarInstalled(): Promise<boolean> {
    try {
      await this.resolveSidecarExecutable();
      return true;
    } catch (error) {
      if (error instanceof SidecarNotInstalledError) {
        return false;
      }
      throw error;
    }
  }

  override onunload(): void {
    void this.disposeAll();
  }

  private async disposeAll(): Promise<void> {
    this.finalizedUtteranceAutoCopy.dispose();
    this.lastUtteranceRecovery.clear();
    this.rawTranscriptRecovery.clear();
    this.releaseReadAloudModelSubscription?.();
    this.releaseReadAloudModelSubscription = null;

    try {
      this.modelInstallManager?.dispose();
    } catch (error) {
      this.logger.error('model', 'failed to dispose model install manager cleanly', error);
    }

    try {
      this.sidecarInstallManager?.dispose();
    } catch (error) {
      this.logger.error('installer', 'failed to dispose sidecar install manager cleanly', error);
    }

    try {
      this.readAloudController?.dispose();
    } catch (error) {
      this.logger.error('tts', 'failed to dispose read-aloud controller cleanly', error);
    }

    try {
      this.translationController?.dispose();
    } catch (error) {
      this.logger.error('translation', 'failed to dispose translation controller cleanly', error);
    }

    try {
      await this.dictationController?.dispose();
    } catch (error) {
      this.logger.error('session', 'failed to dispose dictation controller cleanly', error);
    }

    try {
      await this.sidecarConnection?.shutdown();
    } catch (error) {
      this.logger.error('sidecar', 'failed to shut down sidecar cleanly', error);
    } finally {
      this.sidecarConnection?.dispose();
    }

    this.feedback.dispose();
    this.ribbonController?.dispose();
  }

  private async checkSidecarHealth(
    options: { showNotice?: boolean; useLease?: boolean } = {},
  ): Promise<void> {
    const sidecarConnection = this.requireSidecarConnection();

    try {
      const health = await ((options.useLease ?? true)
        ? this.sidecarLifecycleGate.runUse(async () =>
            sidecarConnection.healthCheck(this.settings.sidecarStartupTimeoutSeconds * 1000),
          )
        : sidecarConnection.healthCheck(this.settings.sidecarStartupTimeoutSeconds * 1000));

      if (options.showNotice ?? true) {
        this.feedback.show({
          intent: 'success',
          message: t('notice.sidecarReady', { version: health.sidecarVersion }),
        });
      }
    } catch (error) {
      if (error instanceof SidecarLifecycleConflictError) {
        if (options.showNotice ?? true) {
          this.feedback.show({
            intent: 'warning',
            message: t('settings.sidecar.operationInProgress'),
          });
        }
        return;
      }
      this.handleError(t('notice.sidecarHealthCheckFailed'), error, options.showNotice ?? true);
      throw error;
    }
  }

  private handleError(message: string, error: unknown, showNotice: boolean): void {
    if (showNotice) {
      this.feedback.show({
        cause: error,
        intent: 'error',
        key: message,
        message: `${message}.`,
      });
    }
  }

  private async restartSidecar(): Promise<void> {
    try {
      const health = await this.sidecarLifecycleGate.runMutation(() =>
        this.restartSidecarConnection(),
      );
      this.feedback.show({
        intent: 'success',
        message: t('notice.sidecarRestarted', { version: health.sidecarVersion }),
      });
    } catch (error) {
      if (error instanceof SidecarLifecycleConflictError) {
        this.feedback.show({
          intent: 'warning',
          message:
            error.activeKind === 'speech'
              ? t('notice.sidecarRestartRequiresIdle')
              : t('settings.sidecar.operationInProgress'),
        });
        return;
      }
      this.handleError(t('notice.sidecarRestartFailed'), error, true);
    }
  }

  private async restartSidecarConnection() {
    return await this.requireSidecarConnection().restart(
      this.settings.sidecarStartupTimeoutSeconds * 1000,
    );
  }

  private async updateSettings(nextSettings: PluginSettings): Promise<void> {
    await this.requirePresetStateStore().commitPreservingPresetState(nextSettings);
  }

  private getSecret(secretId: string): string {
    if (secretId.length === 0) {
      return '';
    }
    return this.app.secretStorage.getSecret(secretId)?.trim() ?? '';
  }

  private async applySettings(
    nextSettings: PluginSettings,
    options: { persist: boolean },
  ): Promise<void> {
    const previousSettings = this.settings;
    this.settings = resolvePluginSettings(nextSettings);
    const llmWasDisabled = previousSettings.llmFeaturesEnabled && !this.settings.llmFeaturesEnabled;
    if (llmWasDisabled) {
      this.dictationController?.disableLlmForActiveSessions();
    }
    this.lastUtteranceRecovery.setEnabled(this.settings.retainLastUtterance);
    this.rawTranscriptRecovery.setEnabled(this.settings.retainLastUtterance);
    if (options.persist) {
      await this.saveData(this.settings);
    }
    if (didReadAloudSettingsChange(previousSettings, this.settings)) {
      await this.readAloudController?.applySpeed(this.settings.ttsSpeed);
      this.renderReadAloudStatus(this.readAloudController?.getState() ?? 'idle');
    }
    if (previousSettings.llmFeaturesEnabled !== this.settings.llmFeaturesEnabled) {
      await this.syncLocalDictationSidebar();
      return;
    }
  }

  private requestLocalDictationSidebarRefresh(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(LOCAL_DICTATION_VIEW_TYPE)) {
      if (leaf.view instanceof LocalDictationView) {
        leaf.view.requestRefresh();
      }
    }
  }

  private notifyLlmCleanupFailureSubscribers(): void {
    for (const subscriber of this.llmCleanupFailureSubscribers) {
      subscriber();
    }
  }

  private requireDictationController(): DictationSessionController {
    if (this.dictationController === null) {
      throw new Error('Dictation controller has not been initialized.');
    }

    return this.dictationController;
  }

  private requireReadAloudController(): ReadAloudController {
    if (this.readAloudController === null) {
      throw new Error('Read-aloud controller has not been initialized.');
    }
    return this.readAloudController;
  }

  private requireTranslationController(): TranslationController {
    if (this.translationController === null) {
      throw new Error('Translation controller has not been initialized.');
    }
    return this.translationController;
  }

  private renderReadAloudStatus(state: ReadAloudState): void {
    const status = this.readAloudStatus;
    if (status === null) return;
    status.empty();
    status.toggle(state !== 'idle');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('role', 'status');
    if (state === 'idle') return;
    const selectedModel = this.selectedReadAloudModel();
    const installedModels = this.installedReadAloudModels();
    const installedVoices = this.installedReadAloudVoices();
    const selectedVoice =
      resolveReadAloudVoiceId(this.settings.selectedTtsVoice, selectedModel?.defaultVoice) ?? '';
    const labels = readAloudControlLabels(state, {
      modelName: selectedModel?.displayName ?? t('settings.model.noModelSelected'),
      speed: this.settings.ttsSpeed,
      voiceId: selectedVoice,
    });
    status.createSpan({
      text: labels.state,
    });
    if (selectedModel !== null) {
      const model = status.createEl('button', {
        attr: { 'aria-label': labels.model, title: labels.model },
        cls: 'local-stt-read-aloud-status__menu',
        text: selectedModel.displayName,
      });
      model.addEventListener('click', (event) => {
        const menu = new Menu();
        for (const availableModel of installedModels) {
          menu.addItem((item) => {
            item
              .setTitle(availableModel.displayName)
              .setChecked(
                matchesModelTriple(
                  availableModel,
                  selectedModel.runtimeId,
                  selectedModel.familyId,
                  selectedModel.modelId,
                ),
              )
              .onClick(() => {
                void this.selectReadAloudModel({
                  familyId: availableModel.familyId,
                  kind: 'catalog_model',
                  modelId: availableModel.modelId,
                  runtimeId: availableModel.runtimeId,
                });
              });
          });
        }
        menu.showAtMouseEvent(event);
      });
    }
    const speed = status.createEl('button', {
      attr: { 'aria-label': labels.speed, title: labels.speed },
      cls: 'local-stt-read-aloud-status__menu',
      text: labels.speedValue,
    });
    speed.addEventListener('click', (event) => {
      const menu = new Menu();
      for (const value of READ_ALOUD_SPEED_PRESETS) {
        menu.addItem((item) => {
          item
            .setTitle(`${value}×`)
            .setChecked(value === this.settings.ttsSpeed)
            .onClick(() => {
              void this.updateSettings({ ...this.settings, ttsSpeed: value });
            });
        });
      }
      menu.showAtMouseEvent(event);
    });
    if (installedVoices.length > 0) {
      const voice = status.createEl('button', {
        attr: { 'aria-label': labels.voice, title: labels.voice },
        cls: 'clickable-icon',
      });
      setIcon(voice, 'audio-waveform');
      voice.addEventListener('click', (event) => {
        const menu = new Menu();
        for (const voiceId of installedVoices) {
          menu.addItem((item) => {
            item
              .setTitle(formatVoiceLabel(voiceId))
              .setChecked(voiceId === selectedVoice)
              .onClick(() => {
                void this.updateSettings({ ...this.settings, selectedTtsVoice: voiceId });
              });
          });
        }
        menu.showAtMouseEvent(event);
      });
    }
    const pause = status.createEl('button', {
      attr: { 'aria-label': labels.pauseResume, title: labels.pauseResume },
      cls: 'clickable-icon',
    });
    setIcon(pause, state === 'paused' ? 'play' : 'pause');
    pause.addEventListener('click', () => {
      void this.requireReadAloudController().togglePaused();
    });
    const stop = status.createEl('button', {
      attr: { 'aria-label': labels.stop, title: labels.stop },
      cls: 'clickable-icon',
    });
    setIcon(stop, 'square');
    stop.addEventListener('click', () => this.requireReadAloudController().stop());
  }

  private installedReadAloudModels(): CatalogModelRecord[] {
    const state = this.requireModelInstallManager().getState();
    return state.catalog.models.filter(
      (model) =>
        model.task === 'tts' &&
        state.installedModels.some((installed) =>
          matchesModelTriple(installed, model.runtimeId, model.familyId, model.modelId),
        ),
    );
  }

  private selectedReadAloudModel(): CatalogModelRecord | null {
    const selection = this.settings.selectedTtsModel;
    if (selection === null || selection.kind !== 'catalog_model') return null;
    return (
      this.requireModelInstallManager()
        .getState()
        .catalog.models.find((model) =>
          matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
        ) ?? null
    );
  }

  private async selectReadAloudModel(selection: CatalogModelSelection): Promise<void> {
    try {
      await this.requireModelInstallManager().select(selection);
    } catch (error) {
      this.logger.error('tts', 'failed to select read-aloud model', error);
      this.feedback.show({
        cause: error,
        intent: 'error',
        message: t('models.manage.selectFailed'),
      });
    }
  }

  private installedReadAloudVoices(): string[] {
    const selection = this.settings.selectedTtsModel;
    if (selection === null || selection.kind !== 'catalog_model') return [];
    const installed = this.modelInstallManager
      ?.getState()
      .installedModels.find((model) =>
        matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
      );
    return installed?.installedVoiceIds ?? [];
  }

  private requirePresetStateStore(): LlmPresetStateStore {
    if (this.presetStateStore === null) {
      throw new Error('Preset state store is not initialized');
    }
    return this.presetStateStore;
  }

  private requireSidecarConnection(): SidecarConnection {
    if (this.sidecarConnection === null) {
      throw new Error('Sidecar connection has not been initialized.');
    }

    return this.sidecarConnection;
  }

  private requireModelInstallManager(): ModelInstallManager {
    if (this.modelInstallManager === null) {
      throw new Error('Model install manager has not been initialized.');
    }

    return this.modelInstallManager;
  }

  private requireSidecarInstallManager(): SidecarInstallManager {
    if (this.sidecarInstallManager === null) {
      throw new Error('Sidecar install manager has not been initialized.');
    }

    return this.sidecarInstallManager;
  }

  private async resolveSidecarLaunchSpec(): Promise<SidecarLaunchSpec> {
    const resolved = await this.resolveSidecarExecutable();
    const executablePath = resolved.path;
    if (resolved.source === 'installed' && resolved.variant !== null) {
      this.logger.debug(
        'sidecar',
        `using installed ${resolved.variant.toUpperCase()} sidecar at ${resolved.path}`,
      );
    } else if (resolved.source === 'dev' && resolved.variant === 'cuda') {
      this.logger.debug('sidecar', `using CUDA sidecar build at ${resolved.path}`);
    }
    const env =
      Platform.isLinux && this.settings.cudaLibraryPath.length > 0
        ? {
            LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH
              ? `${this.settings.cudaLibraryPath}:${process.env.LD_LIBRARY_PATH}`
              : this.settings.cudaLibraryPath,
          }
        : undefined;

    return {
      command: executablePath,
      cwd: dirname(executablePath),
      ...(env ? { env } : {}),
    };
  }

  private buildSidecarResolutionOptions(
    pluginDirectory: string,
    cudaLaunchPolicy: ResolveSidecarExecutablePathOptions['cudaLaunchPolicy'],
  ): ResolveSidecarExecutablePathOptions {
    return {
      accelerationPreference: this.settings.accelerationPreference,
      cudaLaunchPolicy,
      executableName: getSidecarExecutableName(),
      pluginDirectory,
      sidecarPathOverride: this.settings.sidecarPathOverride,
      sidecarProjectDirectory: join(pluginDirectory, 'native'),
      supportsCuda: isCudaReleaseTarget(process.platform, process.arch),
    };
  }

  private async resolveSidecarExecutable(): Promise<ResolvedSidecarExecutable> {
    const pluginDirectory = await this.resolvePluginDirectoryPath();
    const options = this.buildSidecarResolutionOptions(
      pluginDirectory,
      resolveCudaSidecarLaunchPolicy(await this.getCudaCompatibility()),
    );
    const resolved = await resolveSidecarExecutablePath(options);

    if (resolved.source === 'dev') {
      await assertSidecarExecutableIsFresh(resolved.path, options.sidecarProjectDirectory);
    }

    return resolved;
  }

  /**
   * On startup, compare every release-installed sidecar against the current
   * plugin version and prompt for a one-click update when any differ. Obsidian
   * updates the plugin files but never the separately-installed sidecars, so
   * they silently fall out of sync after an update. Self-contained: every
   * failure path is swallowed so this can never disrupt startup.
   */
  private async checkSidecarVersionDrift(): Promise<void> {
    if (!IS_PRODUCTION_BUILD) {
      this.logger.debug('sidecar', 'version drift check skipped for development plugin build');
      return;
    }

    // A custom executable is managed outside the plugin's installer. Installed
    // bin/* variants may still exist, but prompting to update them would be
    // unrelated to the executable the user chose.
    if (this.settings.sidecarPathOverride.trim().length > 0) {
      this.logger.debug('sidecar', 'version drift check skipped for sidecar path override');
      return;
    }

    let pluginDirectory: string;
    try {
      pluginDirectory = await this.resolvePluginDirectoryPath();
    } catch (error) {
      this.logger.error('sidecar', 'version drift check could not resolve plugin directory', error);
      return;
    }

    let drift: SidecarVersionDrift[];
    try {
      drift = await detectSidecarVersionDrift({
        pluginDirectory,
        pluginVersion: this.manifest.version,
        preferredVariant: this.settings.accelerationPreference === 'cpu_only' ? 'cpu' : 'cuda',
        supportsCuda: isCudaSidecarUsable(await this.getCudaCompatibility()),
      });
    } catch (error) {
      this.logger.error('sidecar', 'version drift check failed', error);
      return;
    }

    if (drift.length === 0) return;

    this.notifySidecarVersionDrift(drift, pluginDirectory);
  }

  private notifySidecarVersionDrift(
    drift: readonly SidecarVersionDrift[],
    pluginDirectory: string,
  ): void {
    const variants = drift.map((entry) => entry.variant);
    this.feedback.show({
      action: {
        label:
          variants.length === 2
            ? t('notice.sidecarVersionDrift.actionMultiple')
            : t('notice.sidecarVersionDrift.actionOne'),
        run: () => {
          openSidecarUpdateModal(this.buildSidecarInstallActionDeps(), {
            pluginDirectory,
            variants,
          });
        },
      },
      intent: 'action-required',
      key: 'sidecar-version-drift',
      message:
        variants.length === 2
          ? t('notice.sidecarVersionDrift.cpuAndCuda', { version: this.manifest.version })
          : variants[0] === 'cuda'
            ? t('notice.sidecarVersionDrift.cuda', { version: this.manifest.version })
            : t('notice.sidecarVersionDrift.cpu', { version: this.manifest.version }),
    });
  }

  private buildSidecarInstallActionDeps(): SidecarInstallActionDeps {
    return {
      app: this.app,
      feedback: this.feedback,
      logger: this.logger,
      modelInstallManager: this.requireModelInstallManager(),
      pluginVersion: this.manifest.version,
      refreshSettingsTab: () => {
        // No-op: the settings tab re-reads install manifests on each render, so
        // a reinstall from this startup notice needs no explicit refresh.
      },
      restartSidecar: async () => {
        await this.restartSidecarConnection();
      },
      sidecarConnection: this.requireSidecarConnection(),
      sidecarInstallManager: this.requireSidecarInstallManager(),
      sidecarLifecycleGate: this.sidecarLifecycleGate,
    };
  }

  private async resolvePluginDirectoryPath(): Promise<string> {
    if (!Platform.isDesktopApp) {
      throw new Error('Speech Kit requires Obsidian desktop.');
    }

    const vaultAdapter = this.app.vault.adapter;

    if (!(vaultAdapter instanceof FileSystemAdapter)) {
      throw new Error('The current vault adapter does not expose a filesystem path.');
    }

    return join(vaultAdapter.getBasePath(), this.app.vault.configDir, 'plugins', this.manifest.id);
  }
}

function getSidecarExecutableName(): string {
  return formatSidecarExecutableName(Platform.isWin);
}
