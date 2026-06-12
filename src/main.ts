import { dirname, join } from 'node:path';

import { FileSystemAdapter, Notice, Platform, Plugin } from 'obsidian';

import { AudioCaptureStream } from './audio/audio-capture-stream';
import { AudioVisualizerTap } from './audio/audio-visualizer-tap';
import { registerCommands } from './commands/register-commands';
import { DictationSessionController } from './dictation/dictation-session-controller';
import { dictationAnchorExtension } from './editor/dictation-anchor-extension';
import { noteSurfaceUpdateListenerExtension } from './editor/note-surface';
import { sessionProcessingExtension } from './editor/session-processing-extension';
import type { LlmCleanupFailure } from './llm/provider';
import { createLlmRouter } from './llm/router';
import { ManageModelsModal } from './models/manage-models-modal';
import { ModelInstallManager } from './models/model-install-manager';
import { Session } from './session/session';
import { logAccelerationFallbacks } from './settings/acceleration-info';
import { LlmPresetStateStore } from './settings/llm-preset-state';
import {
  DEFAULT_PLUGIN_SETTINGS,
  type PluginSettings,
  resolvePluginSettings,
  shouldRefreshLlmSidebar,
} from './settings/plugin-settings';
import { LocalSttSettingTab } from './settings/settings-tab';
import {
  openSidecarInstallModal,
  type SidecarInstallActionDeps,
} from './settings/sidecar-settings-section';
import { SetupWizardModal } from './setup/setup-wizard-modal';
import { formatErrorMessage } from './shared/format-utils';
import { createPluginLogger, type PluginLogger } from './shared/plugin-logger';
import { assertSidecarExecutableIsFresh } from './sidecar/sidecar-build-state';
import { SidecarConnection } from './sidecar/sidecar-connection';
import { formatSidecarExecutableName } from './sidecar/sidecar-executable';
import { SidecarInstallManager } from './sidecar/sidecar-install-manager';
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
import { DictationRibbonController } from './ui/dictation-ribbon';
import { LOCAL_DICTATION_VIEW_TYPE, LocalDictationView } from './ui/local-dictation-view';

export default class LocalSttPlugin extends Plugin {
  private audioCaptureStream: AudioCaptureStream | null = null;
  private audioVisualizerTap: AudioVisualizerTap | null = null;
  private dictationController: DictationSessionController | null = null;
  private logger: PluginLogger = createPluginLogger(() => this.settings.developerMode);
  private llmCleanupFailure: LlmCleanupFailure | null = null;
  private readonly llmCleanupFailureSubscribers = new Set<() => void>();
  private modelInstallManager: ModelInstallManager | null = null;
  private presetStateStore: LlmPresetStateStore | null = null;
  private ribbonController: DictationRibbonController | null = null;
  private settings: PluginSettings = DEFAULT_PLUGIN_SETTINGS;
  private sidecarConnection: SidecarConnection | null = null;
  private sidecarInstallManager: SidecarInstallManager | null = null;

  override async onload(): Promise<void> {
    this.settings = resolvePluginSettings(await this.loadData());
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
    this.registerEditorExtension(sessionProcessingExtension());
    this.sidecarConnection = new SidecarConnection({
      getRequestTimeoutMs: () => this.settings.sidecarRequestTimeoutSeconds * 1000,
      logger: this.logger,
      resolveLaunchSpec: async () => this.resolveSidecarLaunchSpec(),
    });
    this.audioVisualizerTap = new AudioVisualizerTap();
    this.audioCaptureStream = new AudioCaptureStream({
      logger: this.logger,
      onDeviceFallback: () => {
        new Notice('Saved microphone unavailable. Using the default input device.');
      },
      visualizer: this.audioVisualizerTap,
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
      logger: this.logger,
      notice: (message) => {
        new Notice(message);
      },
    });
    this.registerView(
      LOCAL_DICTATION_VIEW_TYPE,
      (leaf) =>
        new LocalDictationView(leaf, {
          getSettings: () => this.settings,
          getLlmCleanupFailure: () => this.llmCleanupFailure,
          logger: this.logger,
          notice: (message) => {
            new Notice(message);
          },
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
    this.ribbonController.setVisualizer(this.audioVisualizerTap);
    this.dictationController = new DictationSessionController({
      captureStream: this.audioCaptureStream,
      createSession: ({ callbacks, placement, rendererOptions, sessionId }) =>
        Session.createFromActiveEditor(this.app, {
          callbacks,
          logger: this.logger,
          placement,
          rendererOptions,
          sessionId,
        }),
      createLlmRouter: (settings) =>
        createLlmRouter(settings, undefined, () => this.settings.llmRemoteFeaturesEnabled),
      getSettings: () => this.settings,
      logger: this.logger,
      notice: (message) => {
        new Notice(message);
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
      checkSidecarHealth: async () => this.checkSidecarHealth(),
      plugin: this,
      restartSidecar: async () => this.restartSidecar(),
      startDictation: async () => this.requireDictationController().startDictation(),
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
      hasSelectedModel: () => this.settings.selectedModel !== null,
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
    });
    modal.open();
  }

  async openModelPicker(options: { onChanged?: () => void } = {}): Promise<void> {
    if (!(await this.isSidecarInstalled())) {
      await this.openSetupWizard();
      return;
    }
    new ManageModelsModal(this.app, {
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

    this.ribbonController?.dispose();
  }

  private async checkSidecarHealth(options: { showNotice?: boolean } = {}): Promise<void> {
    const sidecarConnection = this.requireSidecarConnection();

    try {
      const health = await sidecarConnection.healthCheck(
        this.settings.sidecarStartupTimeoutSeconds * 1000,
      );

      if (options.showNotice ?? true) {
        new Notice(`Local Dictation sidecar is ready (${health.sidecarVersion}).`);
      }
    } catch (error) {
      this.handleError('Sidecar health check failed', error, options.showNotice ?? true);
      throw error;
    }
  }

  private handleError(message: string, error: unknown, showNotice: boolean): void {
    if (showNotice) {
      new Notice(`${message}: ${formatErrorMessage(error)}`);
    }
  }

  private async restartSidecar(): Promise<void> {
    if (this.requireDictationController().isBusy()) {
      new Notice('Restart the sidecar only when dictation is idle.');
      return;
    }

    const sidecarConnection = this.requireSidecarConnection();

    try {
      const health = await sidecarConnection.restart(
        this.settings.sidecarStartupTimeoutSeconds * 1000,
      );

      new Notice(`Restarted Local Dictation sidecar (${health.sidecarVersion}).`);
    } catch (error) {
      this.handleError('Sidecar restart failed', error, true);
    }
  }

  private async updateSettings(nextSettings: PluginSettings): Promise<void> {
    await this.requirePresetStateStore().commitPreservingPresetState(nextSettings);
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
   * On startup, compare the installed sidecar's recorded version against the
   * current plugin version and prompt for a one-click reinstall when they
   * differ. Obsidian updates the plugin files but never the separately-
   * installed sidecar, so the two silently fall out of sync after an update.
   * Self-contained: every failure path (including no sidecar installed) is
   * swallowed so this can never disrupt startup.
   */
  private async checkSidecarVersionDrift(): Promise<void> {
    let pluginDirectory: string;
    let resolved: ResolvedSidecarExecutable;

    try {
      pluginDirectory = await this.resolvePluginDirectoryPath();
      resolved = await resolveSidecarExecutablePath(
        this.buildSidecarResolutionOptions(pluginDirectory),
      );
    } catch (error) {
      // No installed sidecar (or an unreadable plugin dir): the setup and
      // health paths own that case — there is no installed version to compare.
      if (!(error instanceof SidecarNotInstalledError)) {
        this.logger.error('sidecar', 'version drift check could not resolve sidecar', error);
      }
      return;
    }

    // Only a release-installed sidecar carries an install.json version. Dev
    // builds and explicit path overrides are intentionally exempt.
    if (resolved.source !== 'installed' || resolved.variant === null) return;

    let drift: SidecarVersionDrift | null;
    try {
      drift = await detectSidecarVersionDrift({
        pluginDirectory,
        pluginVersion: this.manifest.version,
        variant: resolved.variant,
      });
    } catch (error) {
      this.logger.error('sidecar', 'version drift check failed', error);
      return;
    }

    if (drift === null) return;

    this.logger.debug(
      'sidecar',
      `sidecar version drift: installed ${drift.installedVersion}, plugin ${drift.pluginVersion}`,
    );
    this.notifySidecarVersionDrift(drift, pluginDirectory);
  }

  private notifySidecarVersionDrift(drift: SidecarVersionDrift, pluginDirectory: string): void {
    const notice = new Notice(
      createFragment((fragment) => {
        fragment.createDiv({
          text: `Local Dictation updated to ${drift.pluginVersion}, but its speech engine is still ${drift.installedVersion}. Reinstall to keep them in sync.`,
        });
        fragment
          .createEl('a', { href: '#', text: 'Reinstall speech engine' })
          .addEventListener('click', (event) => {
            event.preventDefault();
            notice.hide();
            openSidecarInstallModal(this.buildSidecarInstallActionDeps(), {
              intent: 'reinstall',
              pluginDirectory,
              variant: drift.variant,
            });
          });
      }),
      0,
    );
  }

  private buildSidecarInstallActionDeps(): SidecarInstallActionDeps {
    return {
      app: this.app,
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
