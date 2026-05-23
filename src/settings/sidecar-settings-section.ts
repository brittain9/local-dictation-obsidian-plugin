import type { App } from 'obsidian';
import { Notice, Platform, Setting } from 'obsidian';

import type { ModelInstallManager } from '../models/model-install-manager';
import { updateInstallProgressElement } from '../models/model-install-progress';
import { getInstallCopy, type InstallIntent } from '../setup/sidecar-install-copy';
import { SidecarInstallModal } from '../setup/sidecar-install-modal';
import { formatErrorMessage } from '../shared/format-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import { detectNvidiaDriver, type NvidiaDriverStatus } from '../sidecar/gpu-precheck';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import {
  buildSidecarProgressState,
  type SidecarInstallManager,
} from '../sidecar/sidecar-install-manager';
import {
  type InstallManifest,
  readInstallManifest,
  type SidecarInstallVariant,
  uninstallSidecarVariant,
  variantDirectoryPath,
} from '../sidecar/sidecar-installer';
import { SidecarNotInstalledError } from '../sidecar/sidecar-paths';
import { renderActiveInstallCard } from './install-progress-row';
import { addPositiveIntSetting, addTextSetting, type SettingAccess } from './setting-helpers';

export interface SidecarInstallActionDeps {
  app: App;
  isDictationBusy(): boolean;
  logger?: PluginLogger | undefined;
  modelInstallManager: ModelInstallManager;
  pluginVersion: string;
  refreshSettingsTab(): void;
  restartSidecar(): Promise<void>;
  sidecarConnection: Pick<SidecarConnection, 'shutdown'>;
  sidecarInstallManager: SidecarInstallManager;
}

export interface SidecarSettingsSectionDependencies extends SidecarInstallActionDeps {
  access: SettingAccess;
  resolvePluginDirectory(): Promise<string>;
}

export class SidecarSettingsSection {
  private disposed = false;
  private nvidiaDriverStatus: Promise<NvidiaDriverStatus> | null = null;
  private progressEl: HTMLDivElement | null = null;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly deps: SidecarSettingsSectionDependencies,
  ) {}

  init(): () => void {
    void this.render();
    const unsubscribe = this.deps.sidecarInstallManager.subscribe(() => this.handleStateChange());
    return () => {
      this.disposed = true;
      unsubscribe();
      this.progressEl = null;
      this.nvidiaDriverStatus = null;
    };
  }

  private async render(): Promise<void> {
    if (this.disposed || !this.container.isConnected) return;

    const pluginDirectory = await this.resolvePluginDirectorySafe();
    if (this.disposed || pluginDirectory === null || !this.container.isConnected) return;

    let cpuManifest: InstallManifest | null;
    let cudaManifest: InstallManifest | null = null;
    let driverStatus: NvidiaDriverStatus = 'absent';

    if (Platform.isMacOS) {
      cpuManifest = await readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu'));
      if (this.disposed || !this.container.isConnected) return;
    } else {
      if (this.nvidiaDriverStatus === null) {
        this.nvidiaDriverStatus = detectNvidiaDriver();
      }
      [cpuManifest, cudaManifest, driverStatus] = await Promise.all([
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu')),
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cuda')),
        this.nvidiaDriverStatus,
      ]);
      if (this.disposed || !this.container.isConnected) return;
    }

    this.container.empty();
    this.progressEl = null;

    const activeInstall = this.deps.sidecarInstallManager.getState().activeInstall;
    const renderActiveCard = (active: NonNullable<typeof activeInstall>): void => {
      const { progressEl } = renderActiveInstallCard(this.container, {
        isCancelling: active.phase === 'canceling',
        name: Platform.isMacOS
          ? 'Installing sidecar'
          : `Installing: ${active.variant.toUpperCase()} sidecar`,
        onCancel: () => {
          this.deps.sidecarInstallManager.cancel();
        },
        progressState: buildSidecarProgressState(active),
      });
      this.progressEl = progressEl;
    };

    if (Platform.isMacOS) {
      this.renderInstallRow({
        desc: 'Speech-to-text engine.',
        manifest: cpuManifest,
        name: 'Sidecar',
        pluginDirectory,
        variant: 'cpu',
      });
      if (activeInstall !== null) renderActiveCard(activeInstall);
    } else {
      this.renderInstallRow({
        desc: 'Speech-to-text engine. Required.',
        manifest: cpuManifest,
        name: 'CPU sidecar',
        pluginDirectory,
        variant: 'cpu',
      });
      if (activeInstall !== null && activeInstall.variant === 'cpu') {
        renderActiveCard(activeInstall);
      }

      this.renderGpuRow(cudaManifest, pluginDirectory, driverStatus);
      if (activeInstall !== null && activeInstall.variant === 'cuda') {
        renderActiveCard(activeInstall);
      }
    }

    if (Platform.isLinux) {
      addTextSetting(this.container, this.deps.access, {
        name: 'CUDA library path',
        desc: 'Optional library search path for the sidecar (Flatpak, custom CUDA installs).',
        key: 'cudaLibraryPath',
        placeholder: '/run/host/usr/local/cuda-12.9/targets/x86_64-linux/lib:/run/host/usr/lib64',
      });
    }

    if (this.deps.access.getSettings().developerMode) {
      addTextSetting(this.container, this.deps.access, {
        name: 'Sidecar path override',
        desc: 'Custom sidecar executable path.',
        key: 'sidecarPathOverride',
        placeholder: 'Auto-detect from bin/cpu, bin/cuda, or native/target debug builds',
      });

      addPositiveIntSetting(this.container, this.deps.access, {
        name: 'Startup timeout (s)',
        desc: 'Seconds allowed for the startup handshake.',
        key: 'sidecarStartupTimeoutSeconds',
      });

      addPositiveIntSetting(this.container, this.deps.access, {
        name: 'Request timeout (s)',
        desc: 'Seconds allowed for sidecar requests.',
        key: 'sidecarRequestTimeoutSeconds',
      });
    }

    // Sentinel keeps Obsidian's `.setting-item:last-child` padding-stripping
    // rule from matching the last sidecar row, so its spacing stays consistent
    // with the rows that follow this wrapper in the Advanced section.
    this.container.createSpan({ attr: { 'aria-hidden': 'true', style: 'display: none;' } });
  }

  private handleStateChange(): void {
    const activeInstall = this.deps.sidecarInstallManager.getState().activeInstall;

    if (activeInstall !== null && this.progressEl !== null) {
      updateInstallProgressElement(this.progressEl, buildSidecarProgressState(activeInstall));
      return;
    }

    void this.render();
  }

  private renderInstallRow(opts: {
    desc: string;
    manifest: InstallManifest | null;
    name: string;
    pluginDirectory: string;
    variant: SidecarInstallVariant;
  }): void {
    const setting = new Setting(this.container).setName(opts.name).setDesc(opts.desc);
    appendVersionChip(setting, opts.manifest);
    addInstallButtons(setting, opts.manifest !== null, {
      onInstall: () => {
        openSidecarInstallModal(this.deps, {
          pluginDirectory: opts.pluginDirectory,
          variant: opts.variant,
          intent: 'install',
        });
      },
      onReinstall: () => {
        openSidecarInstallModal(this.deps, {
          pluginDirectory: opts.pluginDirectory,
          variant: opts.variant,
          intent: 'reinstall',
        });
      },
      onUninstall: () => {
        void uninstallSidecarVariantWithUx(this.deps, opts.pluginDirectory, opts.variant);
      },
    });
  }

  private renderGpuRow(
    manifest: InstallManifest | null,
    pluginDirectory: string,
    driverStatus: NvidiaDriverStatus,
  ): void {
    const driverReason = describeDriverStatus(driverStatus);
    const isInstalled = manifest !== null;

    const setting = new Setting(this.container)
      .setName('GPU sidecar')
      .setDesc(isInstalled ? 'CUDA acceleration active.' : driverReason.label);
    appendVersionChip(setting, manifest);

    addInstallButtons(setting, isInstalled, {
      installCta: driverStatus === 'present',
      installDisabled: driverStatus === 'absent',
      onInstall: () => {
        this.openCudaInstallModal(pluginDirectory);
      },
      onReinstall: () => {
        openSidecarInstallModal(this.deps, {
          pluginDirectory,
          variant: 'cuda',
          intent: 'reinstall',
        });
      },
      onUninstall: () => {
        void uninstallSidecarVariantWithUx(this.deps, pluginDirectory, 'cuda');
      },
    });

    if (!isInstalled && driverStatus === 'absent') {
      setting.addButton((button) => {
        button.setButtonText('Install anyway');
        button.setTooltip('Proceed with CUDA install even though no NVIDIA driver was detected.');
        button.onClick(() => {
          this.openCudaInstallModal(pluginDirectory);
        });
      });
    }
  }

  private openCudaInstallModal(pluginDirectory: string): void {
    openSidecarInstallModal(this.deps, {
      pluginDirectory,
      variant: 'cuda',
      intent: 'install',
      onInstalled: async () => {
        await this.deps.access.persistOne('accelerationPreference', 'auto');
      },
    });
  }

  private resolvePluginDirectorySafe(): Promise<string | null> {
    return resolvePluginDirectorySafe(this.deps.resolvePluginDirectory, this.deps.logger);
  }
}

export async function resolvePluginDirectorySafe(
  resolvePluginDirectory: () => Promise<string>,
  logger: PluginLogger | undefined,
): Promise<string | null> {
  try {
    return await resolvePluginDirectory();
  } catch (error) {
    logger?.error('installer', 'failed to resolve plugin directory', error);
    return null;
  }
}

export function openSidecarInstallModal(
  deps: SidecarInstallActionDeps,
  opts: {
    intent: InstallIntent;
    onInstalled?: () => Promise<void>;
    pluginDirectory: string;
    variant: SidecarInstallVariant;
  },
): void {
  if (deps.isDictationBusy()) {
    new Notice(
      'Stop dictation before installing a sidecar — the install restarts the engine. If a transcript is still processing, run "Cancel dictation" to stop it now.',
    );
    return;
  }

  new SidecarInstallModal(deps.app, {
    beforeReplace: async () => {
      await shutdownSidecarBeforeFileMutation(deps, `${opts.variant} install`);
    },
    copy: getInstallCopy(opts.variant, opts.intent),
    manager: deps.sidecarInstallManager,
    onInstalled: async () => {
      await opts.onInstalled?.();
      await deps.restartSidecar();
      await deps.modelInstallManager.init();
      deps.refreshSettingsTab();
    },
    pluginDirectory: opts.pluginDirectory,
    variant: opts.variant,
    version: deps.pluginVersion,
  }).open();
}

async function uninstallSidecarVariantWithUx(
  deps: SidecarInstallActionDeps,
  pluginDirectory: string,
  variant: SidecarInstallVariant,
): Promise<void> {
  const variantLabel = variant === 'cuda' ? 'CUDA' : 'CPU';
  const userFacingName = Platform.isMacOS ? 'sidecar' : `${variantLabel} sidecar`;

  if (deps.isDictationBusy()) {
    new Notice(
      `Stop dictation before uninstalling the ${userFacingName}. If a transcript is still processing, run "Cancel dictation" to stop it now.`,
    );
    return;
  }

  await shutdownSidecarBeforeFileMutation(deps, `${variantLabel} uninstall`);

  try {
    await uninstallSidecarVariant(pluginDirectory, variant);
  } catch (error) {
    deps.logger?.error('installer', `failed to uninstall ${variantLabel} sidecar`, error);
    new Notice(`Failed to uninstall ${userFacingName}: ${formatErrorMessage(error)}`);
    return;
  }

  new Notice(
    Platform.isMacOS
      ? 'Sidecar uninstalled.'
      : variant === 'cuda'
        ? 'CUDA sidecar uninstalled. Running on CPU.'
        : 'CPU sidecar uninstalled.',
  );
  deps.refreshSettingsTab();

  try {
    await deps.restartSidecar();
  } catch (error) {
    if (error instanceof SidecarNotInstalledError) return;
    deps.logger?.warn('installer', 'sidecar restart after uninstall failed', error);
    new Notice(`Sidecar could not restart: ${formatErrorMessage(error)}`);
  }
}

async function shutdownSidecarBeforeFileMutation(
  deps: SidecarInstallActionDeps,
  reason: string,
): Promise<void> {
  // Windows holds DLL handles on the live sidecar process, so install and
  // uninstall paths must stop it before removing or replacing bin/*.
  try {
    await deps.sidecarConnection.shutdown();
  } catch (error) {
    deps.logger?.warn('installer', `sidecar shutdown failed before ${reason}; proceeding`, error);
  }
}

function addInstallButtons(
  setting: Setting,
  isInstalled: boolean,
  opts: {
    installCta?: boolean;
    installDisabled?: boolean;
    onInstall: () => void;
    onReinstall: () => void;
    onUninstall: () => void;
  },
): void {
  if (isInstalled) {
    setting.addButton((button) => {
      button.setButtonText('Reinstall').onClick(opts.onReinstall);
    });
    setting.addButton((button) => {
      button.setButtonText('Uninstall').setWarning().onClick(opts.onUninstall);
    });
    return;
  }

  setting.addButton((button) => {
    button.setButtonText('Install').onClick(opts.onInstall);
    if (opts.installCta ?? true) button.setCta();
    if (opts.installDisabled === true) button.setDisabled(true);
  });
}

function appendVersionChip(setting: Setting, manifest: InstallManifest | null): void {
  if (manifest === null) return;
  setting.nameEl.createSpan({
    cls: 'local-stt-version-chip',
    text: `v${manifest.version}`,
  });
}

function describeDriverStatus(status: NvidiaDriverStatus): { label: string; tooltip: string } {
  switch (status) {
    case 'present':
      return {
        label: 'NVIDIA GPU detected — faster transcription.',
        tooltip: 'Downloads the CUDA sidecar archive from GitHub releases.',
      };
    case 'absent':
      return {
        label: 'Requires an NVIDIA GPU. Install anyway if you know yours is supported.',
        tooltip:
          'nvidia-smi was not found on PATH. Use "Install anyway" if you are certain your system supports CUDA.',
      };
    case 'unknown':
      return {
        label: "Couldn't probe for NVIDIA — install only if you're sure.",
        tooltip:
          'Unable to probe for an NVIDIA driver. Proceed only if you know your GPU supports CUDA.',
      };
  }
}
