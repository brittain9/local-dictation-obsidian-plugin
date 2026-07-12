import { dirname, join } from 'node:path';
import { IS_PRODUCTION_BUILD } from 'virtual:build-mode';
import { FileSystemAdapter, Platform, Plugin } from 'obsidian';

import { AudioCaptureStream } from './audio/audio-capture-stream';
import { SidecarAudioLevelMeter } from './audio/sidecar-audio-level-meter';
import { registerCommands } from './commands/register-commands';
import { DictationSessionController } from './dictation/dictation-session-controller';
import { dictationAnchorExtension } from './editor/dictation-anchor-extension';
import { noteSurfaceUpdateListenerExtension } from './editor/note-surface';
import { provisionalTranscriptExtension } from './editor/provisional-transcript-extension';
import {
  canCaptureSelectionRedictation,
  captureSelectionRedictation,
  SelectionRedictationSession,
} from './editor/selection-redictation';
import { sessionProcessingExtension } from './editor/session-processing-extension';
import { TemporaryLeafPinLeaseManager } from './editor/temporary-leaf-pin';
import type { LlmCleanupFailure } from './llm/provider';
import { createLlmRouter } from './llm/router';
import { ManageModelsModal } from './models/manage-models-modal';
import { ModelInstallManager } from './models/model-install-manager';
import { Session } from './session/session';
import { logAccelerationFallbacks } from './settings/acceleration-info';
import { LlmPresetStateStore } from './settings/llm-preset-state';
import { getOpenRouterApiKey, loadPluginSettings } from './settings/openrouter-secret-storage';
import {
  DEFAULT_PLUGIN_SETTINGS,
  type PluginSettings,
  resolvePluginSettings,
  shouldRefreshLlmSidebar,
} from './settings/plugin-settings';
import { LocalSttSettingTab } from './settings/settings-tab';
import {
  openSidecarUpdateModal,
  type SidecarInstallActionDeps,
} from './settings/sidecar-settings-section';
import { SetupWizardModal } from './setup/setup-wizard-modal';
import { createObsidianFeedbackPresenter } from './shared/obsidian-feedback-presenter';
import { createPluginLogger, type PluginLogger } from './shared/plugin-logger';
import { createUserFeedback, type UserFeedback } from './shared/user-feedback';
import { assertSidecarExecutableIsFresh } from './sidecar/sidecar-build-state';
import { SidecarConnection } from './sidecar/sidecar-connection';
import { formatSidecarExecutableName } from './sidecar/sidecar-executable';
import { SidecarInstallManager } from './sidecar/sidecar-install-manager';
import {
  type ResolveSidecarExecutablePathOptions,
  resolveSidecarExecutablePath,
  SidecarNotInstalledError,
} from './sidecar/sidecar-paths';
import type { SidecarLaunchSpec } from './sidecar/sidecar-process';
import {
  detectSidecarVersionDrift,
  type SidecarVersionDrift,
} from './sidecar/sidecar-version-drift';
import { DictationRibbonController } from './ui/dictation-ribbon';
import { LOCAL_DICTATION_VIEW_TYPE, LocalDictationView } from './ui/local-dictation-view';

export default class LocalSttPlugin extends Plugin {
  private audioCaptureStream: AudioCaptureStream | null = null;
  private audioLevelMeter: SidecarAudioLevelMeter | null = null;
  private dictationController: DictationSessionController | null = null;
  private logger: PluginLogger = createPluginLogger(() => this.settings.developerMode);
  private readonly feedback: UserFeedback = createUserFeedback({
    logger: this.logger,
    presenter: createObsidianFeedbackPresenter(),
  });
  private llmCleanupFailure: LlmCleanupFailure | null = null;
  private readonly llmCleanupFailureSubscribers = new Set<() => void>();
  private modelInstallManager: ModelInstallManager | null = null;
  private presetStateStore: LlmPresetStateStore | null = null;
  private ribbonController: DictationRibbonController | null = null;
  private settings: PluginSettings = DEFAULT_PLUGIN_SETTINGS;
  private sidecarConnection: SidecarConnection | null = null;
  private sidecarInstallManager: SidecarInstallManager | null = null;
  private readonly temporaryLeafPinLeaseManager = new TemporaryLeafPinLeaseManager();

  override async onload(): Promise<void> {
    const loadedSettings = loadPluginSettings(await this.loadData(), this.app.secretStorage);
    this.settings = loadedSettings.settings;
    if (loadedSettings.shouldPersist) {
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
      onDeviceFallback: () => {
        this.feedback.show({
          intent: 'warning',
          key: 'microphone-device-fallback',
          message: 'Saved microphone unavailable. Using the default input device.',
        });
      },
    });
    this.modelInstallManager = new ModelInstallManager({
      getSettings: () => this.settings,
      logger: this.logger,
      saveSettings: async (nextSettings) => {
        await this.updateSettings(nextSettings);
      },
      sidecarConnection: this.sidecarConnection,
    });
    this.sidecarInstallManager = new SidecarInstallManager({
      feedback: this.feedback,
      logger: this.logger,
    });
    this.registerView(
      LOCAL_DICTATION_VIEW_TYPE,
      (leaf) =>
        new LocalDictationView(leaf, {
          feedback: this.feedback,
          getOpenRouterApiKey: () => this.getOpenRouterApiKey(),
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

    const ribbonElement = this.addRibbonIcon('mic', 'Local Dictation — start dictation', () => {
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
      createSelectionRedictationSession: ({ callbacks, selection }) =>
        new SelectionRedictationSession({
          app: this.app,
          callbacks,
          feedback: this.feedback,
          snapshot: selection,
        }),
      createLlmRouter: (settings) =>
        createLlmRouter(
          settings,
          undefined,
          () => this.settings.llmRemoteFeaturesEnabled,
          () => this.getOpenRouterApiKey(),
        ),
      getSettings: () => this.settings,
      feedback: this.feedback,
      logger: this.logger,
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
        restartSidecar: async () => {
          await this.requireSidecarConnection().restart(
            this.settings.sidecarStartupTimeoutSeconds * 1000,
          );
        },
        saveSettings: async (nextSettings) => {
          await this.updateSettings(nextSettings);
        },
        sidecarConnection: this.requireSidecarConnection(),
        sidecarInstallManager: this.requireSidecarInstallManager(),
      }),
    );

    registerCommands({
      cancelDictation: async () => this.requireDictationController().cancelDictation(),
      canRedictateSelection: (editor, file) =>
        !this.requireDictationController().isBusy() && canCaptureSelectionRedictation(editor, file),
      checkSidecarHealth: async () => this.checkSidecarHealth(),
      plugin: this,
      restartSidecar: async () => this.restartSidecar(),
      startDictation: async () => this.requireDictationController().startDictation(),
      startSelectionRedictation: async (editor, file) => {
        const controller = this.requireDictationController();
        if (controller.isBusy()) {
          this.feedback.show({
            intent: 'information',
            key: 'selection-redictation-busy',
            message: 'Finish or cancel the current dictation before re-dictating a selection.',
          });
          return;
        }

        const capture = captureSelectionRedictation(editor, file);
        if (capture.kind !== 'captured') {
          this.feedback.show({
            intent: 'information',
            key: 'selection-redictation-unavailable',
            message: 'Select one non-empty text range and try again.',
          });
          return;
        }

        await controller.startSelectionRedictation(capture.snapshot);
      },
      stopDictation: async () => this.requireDictationController().stopDictation(),
      toggleDictation: async () => this.requireDictationController().toggleDictation(),
    });

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

    // Surface sidecar/plugin version drift before the health handshake. An
    // Obsidian update swaps the plugin files but never the separately-installed
    // sidecar, so a stale sidecar may even be the reason the handshake fails.
    await this.checkSidecarVersionDrift();

    try {
      await this.checkSidecarHealth({ showNotice: false });
      const systemInfo = await this.requireSidecarConnection().getSystemInfo();
      logAccelerationFallbacks(systemInfo, this.settings.accelerationPreference, this.logger);
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

  async openSetupWizard(): Promise<void> {
    let pluginDirectory: string;

    try {
      pluginDirectory = await this.resolvePluginDirectoryPath();
    } catch (error) {
      this.logger.error('installer', 'unable to resolve plugin directory for setup wizard', error);
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
        await this.requireSidecarConnection().restart(
          this.settings.sidecarStartupTimeoutSeconds * 1000,
        );
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

  async openModelPicker(options: { onChanged?: () => void } = {}): Promise<void> {
    if (!(await this.isSidecarInstalled())) {
      await this.openSetupWizard();
      return;
    }
    new ManageModelsModal(this.app, {
      feedback: this.feedback,
      manager: this.requireModelInstallManager(),
      onChanged: options.onChanged ?? (() => {}),
      onRunSetup: () => {
        void this.openSetupWizard();
      },
    }).open();
  }

  private async isSidecarInstalled(): Promise<boolean> {
    try {
      await this.resolveSidecarExecutablePath();
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

  private async checkSidecarHealth(options: { showNotice?: boolean } = {}): Promise<void> {
    const sidecarConnection = this.requireSidecarConnection();

    try {
      const health = await sidecarConnection.healthCheck(
        this.settings.sidecarStartupTimeoutSeconds * 1000,
      );

      if (options.showNotice ?? true) {
        this.feedback.show({
          intent: 'success',
          message: `Sidecar is ready (${health.sidecarVersion}).`,
        });
      }
    } catch (error) {
      this.handleError('Sidecar health check failed', error, options.showNotice ?? true);
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
    if (this.requireDictationController().isBusy()) {
      this.feedback.show({
        intent: 'warning',
        message: 'Restart the sidecar only when dictation is idle.',
      });
      return;
    }

    const sidecarConnection = this.requireSidecarConnection();

    try {
      const health = await sidecarConnection.restart(
        this.settings.sidecarStartupTimeoutSeconds * 1000,
      );

      this.feedback.show({
        intent: 'success',
        message: `Restarted sidecar (${health.sidecarVersion}).`,
      });
    } catch (error) {
      this.handleError('Sidecar restart failed', error, true);
    }
  }

  private async updateSettings(nextSettings: PluginSettings): Promise<void> {
    await this.requirePresetStateStore().commitPreservingPresetState(nextSettings);
  }

  private getOpenRouterApiKey(): string {
    return getOpenRouterApiKey(this.settings, this.app.secretStorage);
  }

  private async applySettings(
    nextSettings: PluginSettings,
    options: { persist: boolean },
  ): Promise<void> {
    const previousSettings = this.settings;
    this.settings = resolvePluginSettings(nextSettings);
    if (options.persist) {
      await this.saveData(this.settings);
    }
    if (previousSettings.llmFeaturesEnabled !== this.settings.llmFeaturesEnabled) {
      await this.syncLocalDictationSidebar();
      return;
    }
    if (shouldRefreshLlmSidebar(previousSettings, this.settings)) {
      for (const leaf of this.app.workspace.getLeavesOfType(LOCAL_DICTATION_VIEW_TYPE)) {
        if (leaf.view instanceof LocalDictationView) {
          leaf.view.refresh();
        }
      }
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
    const executablePath = await this.resolveSidecarExecutablePath();
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
  ): ResolveSidecarExecutablePathOptions {
    return {
      accelerationPreference: this.settings.accelerationPreference,
      executableName: getSidecarExecutableName(),
      pluginDirectory,
      sidecarPathOverride: this.settings.sidecarPathOverride,
      sidecarProjectDirectory: join(pluginDirectory, 'native'),
      supportsCuda: !Platform.isMacOS,
    };
  }

  private async resolveSidecarExecutablePath(): Promise<string> {
    const pluginDirectory = await this.resolvePluginDirectoryPath();
    const options = this.buildSidecarResolutionOptions(pluginDirectory);
    const resolved = await resolveSidecarExecutablePath(options);

    if (resolved.source === 'installed' && resolved.variant !== null) {
      this.logger.debug(
        'sidecar',
        `using installed ${resolved.variant.toUpperCase()} sidecar at ${resolved.path}`,
      );
    } else if (resolved.source === 'dev') {
      if (resolved.variant === 'cuda') {
        this.logger.debug('sidecar', `using CUDA sidecar build at ${resolved.path}`);
      }
      await assertSidecarExecutableIsFresh(resolved.path, options.sidecarProjectDirectory);
    }

    return resolved.path;
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
        supportsCuda: !Platform.isMacOS,
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
    const engineLabel =
      variants.length === 2
        ? 'CPU and CUDA speech engines are'
        : variants[0] === 'cuda'
          ? 'CUDA speech engine is'
          : 'speech engine is';
    this.feedback.show({
      action: {
        label: variants.length === 2 ? 'Update speech engines' : 'Update speech engine',
        run: () => {
          openSidecarUpdateModal(this.buildSidecarInstallActionDeps(), {
            pluginDirectory,
            variants,
          });
        },
      },
      intent: 'action-required',
      key: 'sidecar-version-drift',
      message: `Updated to ${this.manifest.version}, but the installed ${engineLabel} out of date. Update now to keep them in sync.`,
    });
  }

  private buildSidecarInstallActionDeps(): SidecarInstallActionDeps {
    return {
      app: this.app,
      feedback: this.feedback,
      isDictationBusy: () => this.dictationController?.isBusy() ?? false,
      logger: this.logger,
      modelInstallManager: this.requireModelInstallManager(),
      pluginVersion: this.manifest.version,
      refreshSettingsTab: () => {
        // No-op: the settings tab re-reads install manifests on each render, so
        // a reinstall from this startup notice needs no explicit refresh.
      },
      restartSidecar: async () => {
        await this.requireSidecarConnection().restart(
          this.settings.sidecarStartupTimeoutSeconds * 1000,
        );
      },
      sidecarConnection: this.requireSidecarConnection(),
      sidecarInstallManager: this.requireSidecarInstallManager(),
    };
  }

  private async resolvePluginDirectoryPath(): Promise<string> {
    if (!Platform.isDesktopApp) {
      throw new Error('Local Dictation requires Obsidian desktop.');
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
