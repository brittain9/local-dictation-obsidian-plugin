import type { App } from 'obsidian';
import { Platform, Setting } from 'obsidian';

import type { ModelInstallManager } from '../models/model-install-manager';
import { updateInstallProgressElement } from '../models/model-install-progress';
import {
  getInstallCopy,
  getSidecarUpdateCopy,
  type InstallIntent,
} from '../setup/sidecar-install-copy';
import { SidecarInstallModal } from '../setup/sidecar-install-modal';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import {
  CUDA_COMPATIBILITY_REQUIREMENTS,
  type CudaCompatibility,
  detectCudaCompatibility,
} from '../sidecar/gpu-precheck';
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
import {
  SidecarLifecycleConflictError,
  type SidecarLifecycleGate,
  type SidecarLifecycleLease,
} from '../sidecar/sidecar-lifecycle-gate';
import { SidecarNotInstalledError } from '../sidecar/sidecar-paths';
import { styleDestructiveButton } from '../ui/destructive-button';
import { renderActiveInstallCard } from './install-progress-row';
import { addPositiveIntSetting, addTextSetting, type SettingAccess } from './setting-helpers';

export interface SidecarInstallActionDeps {
  app: App;
  feedback: Pick<UserFeedback, 'show'>;
  logger?: PluginLogger | undefined;
  modelInstallManager: ModelInstallManager;
  pluginVersion: string;
  refreshSettingsTab(): void;
  restartSidecar(): Promise<void>;
  sidecarConnection: Pick<SidecarConnection, 'shutdown'>;
  sidecarInstallManager: SidecarInstallManager;
  sidecarLifecycleGate: SidecarLifecycleGate;
}

export interface SidecarSettingsSectionDependencies extends SidecarInstallActionDeps {
  access: SettingAccess;
  resolvePluginDirectory: () => Promise<string>;
}

export class SidecarSettingsSection {
  private disposed = false;
  private cudaCompatibility: Promise<CudaCompatibility> | null = null;
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
      this.cudaCompatibility = null;
    };
  }

  private async render(): Promise<void> {
    if (this.disposed || !this.container.isConnected) return;

    const pluginDirectory = await this.resolvePluginDirectorySafe();
    if (this.disposed || pluginDirectory === null || !this.container.isConnected) return;

    let cpuManifest: InstallManifest | null;
    let cudaManifest: InstallManifest | null = null;
    let cudaCompatibility: CudaCompatibility = { status: 'unsupported' };

    if (Platform.isMacOS) {
      cpuManifest = await readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu'));
      if (this.disposed || !this.container.isConnected) return;
    } else {
      if (this.cudaCompatibility === null) {
        this.cudaCompatibility = detectCudaCompatibility();
      }
      [cpuManifest, cudaManifest, cudaCompatibility] = await Promise.all([
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu')),
        readInstallManifest(variantDirectoryPath(pluginDirectory, 'cuda')),
        this.cudaCompatibility,
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
          ? t('settings.install.installingSidecarMac')
          : t('settings.install.installingSidecar', {
              variant: active.variant.toUpperCase(),
            }),
        onCancel: () => {
          this.deps.sidecarInstallManager.cancel();
        },
        progressState: buildSidecarProgressState(active),
      });
      this.progressEl = progressEl;
    };

    if (Platform.isMacOS) {
      this.renderInstallRow({
        desc: t('settings.sidecar.desc'),
        manifest: cpuManifest,
        name: t('settings.sidecar.name'),
        pluginDirectory,
        variant: 'cpu',
      });
      if (activeInstall !== null) renderActiveCard(activeInstall);
    } else {
      this.renderInstallRow({
        desc: t('settings.sidecar.cpuDesc'),
        manifest: cpuManifest,
        name: t('settings.sidecar.cpuName'),
        pluginDirectory,
        variant: 'cpu',
      });
      if (activeInstall !== null && activeInstall.variant === 'cpu') {
        renderActiveCard(activeInstall);
      }

      this.renderGpuRow(cudaManifest, pluginDirectory, cudaCompatibility);
      if (activeInstall !== null && activeInstall.variant === 'cuda') {
        renderActiveCard(activeInstall);
      }
    }

    if (Platform.isLinux) {
      addTextSetting(this.container, this.deps.access, {
        name: t('settings.sidecar.cudaLibraryPath.name'),
        desc: t('settings.sidecar.cudaLibraryPath.desc'),
        key: 'cudaLibraryPath',
        placeholder: '/run/host/usr/local/cuda-13.2/targets/x86_64-linux/lib:/run/host/usr/lib64',
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
    compatibility: CudaCompatibility,
  ): void {
    const presentation = getCudaInstallPresentation(compatibility);
    const isInstalled = manifest !== null;

    const setting = new Setting(this.container)
      .setName(t('settings.sidecar.gpuName'))
      .setDesc(presentation.description);
    appendVersionChip(setting, manifest);

    addInstallButtons(setting, isInstalled, {
      allowInstall: presentation.installAction !== 'none',
      installCta: presentation.installAction === 'cta',
      installLabel:
        presentation.installAction === 'manual' ? t('settings.sidecar.installAnyway') : undefined,
      installTooltip:
        presentation.installAction === 'manual'
          ? t('settings.sidecar.installUnverifiedTooltip')
          : undefined,
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
  new SidecarInstallModal(deps.app, {
    beforeReplace: async () => {
      await shutdownSidecarBeforeFileMutation(deps, `${opts.variant} install`);
    },
    copy: getInstallCopy(opts.variant, opts.intent),
    feedback: deps.feedback,
    manager: deps.sidecarInstallManager,
    onInstalled: async () => {
      await opts.onInstalled?.();
      await deps.restartSidecar();
      await deps.modelInstallManager.init();
      deps.refreshSettingsTab();
    },
    pluginDirectory: opts.pluginDirectory,
    variants: [opts.variant],
    version: deps.pluginVersion,
  }).open();
}

export function openSidecarUpdateModal(
  deps: SidecarInstallActionDeps,
  opts: {
    pluginDirectory: string;
    variants: readonly SidecarInstallVariant[];
  },
): void {
  new SidecarInstallModal(deps.app, {
    beforeReplace: async () => {
      await shutdownSidecarBeforeFileMutation(deps, 'sidecar update');
    },
    copy: getSidecarUpdateCopy(opts.variants),
    feedback: deps.feedback,
    manager: deps.sidecarInstallManager,
    onInstalled: async () => {
      await deps.restartSidecar();
      await deps.modelInstallManager.init();
      deps.refreshSettingsTab();
    },
    onVariantInstalled: async () => {
      await deps.restartSidecar();
    },
    pluginDirectory: opts.pluginDirectory,
    variants: opts.variants,
    version: deps.pluginVersion,
  }).open();
}

export async function uninstallSidecarVariantWithUx(
  deps: SidecarInstallActionDeps,
  pluginDirectory: string,
  variant: SidecarInstallVariant,
): Promise<void> {
  const variantLabel = variant === 'cuda' ? 'CUDA' : 'CPU';
  const userFacingName = Platform.isMacOS
    ? t('settings.sidecar.genericName')
    : t('settings.sidecar.variantName', { variant: variantLabel });

  let mutationLease: SidecarLifecycleLease;
  try {
    mutationLease = deps.sidecarLifecycleGate.acquireMutation();
  } catch (error) {
    if (!(error instanceof SidecarLifecycleConflictError)) throw error;
    deps.feedback.show({
      intent: 'warning',
      message:
        error.activeKind === 'speech'
          ? t('settings.sidecar.stopBeforeUninstall', { sidecar: userFacingName })
          : t('settings.sidecar.operationInProgress'),
    });
    return;
  }

  try {
    await shutdownSidecarBeforeFileMutation(deps, `${variantLabel} uninstall`);
    await uninstallSidecarVariant(pluginDirectory, variant);
    let restartFailure: unknown;
    try {
      await deps.restartSidecar();
    } catch (error) {
      if (!(error instanceof SidecarNotInstalledError)) {
        restartFailure = error;
      }
    }

    deps.feedback.show({
      intent: 'success',
      message: Platform.isMacOS
        ? t('settings.sidecar.uninstalled')
        : variant === 'cuda'
          ? t('settings.sidecar.cudaUninstalled')
          : t('settings.sidecar.cpuUninstalled'),
    });
    deps.refreshSettingsTab();

    if (restartFailure !== undefined) {
      deps.feedback.show({
        cause: restartFailure,
        intent: 'warning',
        message: t('settings.sidecar.restartFailed'),
      });
    }
  } catch (error) {
    deps.feedback.show({
      cause: error,
      intent: 'error',
      message: t('settings.sidecar.uninstallFailed', { sidecar: userFacingName }),
    });
  } finally {
    mutationLease.release();
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
    allowInstall?: boolean;
    installCta?: boolean;
    installLabel?: string | undefined;
    installTooltip?: string | undefined;
    onInstall: () => void;
    onReinstall: () => void;
    onUninstall: () => void;
  },
): void {
  if (isInstalled) {
    if (opts.allowInstall ?? true) {
      setting.addButton((button) => {
        button.setButtonText(t('settings.sidecar.reinstall')).onClick(opts.onReinstall);
      });
    }
    setting.addButton((button) => {
      styleDestructiveButton(button.setButtonText(t('settings.sidecar.uninstall'))).onClick(
        opts.onUninstall,
      );
    });
    return;
  }

  if (opts.allowInstall === false) return;

  setting.addButton((button) => {
    button
      .setButtonText(opts.installLabel ?? t('settings.sidecar.install'))
      .onClick(opts.onInstall);
    if (opts.installTooltip !== undefined) button.setTooltip(opts.installTooltip);
    if (opts.installCta ?? true) button.setCta();
  });
}

function appendVersionChip(setting: Setting, manifest: InstallManifest | null): void {
  if (manifest === null) return;
  setting.nameEl.createSpan({
    cls: 'local-stt-version-chip',
    text: `v${manifest.version}`,
  });
}

export function getCudaInstallPresentation(compatibility: CudaCompatibility): {
  description: string;
  installAction: 'cta' | 'manual' | 'none';
} {
  switch (compatibility.status) {
    case 'compatible':
      return {
        description: t('settings.sidecar.cudaCompatibility.compatible'),
        installAction: 'cta',
      };
    case 'absent':
      return {
        description: t('settings.sidecar.cudaCompatibility.absent'),
        installAction: 'manual',
      };
    case 'incompatible_driver':
      return {
        description: t('settings.sidecar.cudaCompatibility.incompatibleDriver', {
          minimumDriverMajor: CUDA_COMPATIBILITY_REQUIREMENTS.minimumDriverMajor,
        }),
        installAction: 'none',
      };
    case 'incompatible_gpu': {
      const { major, minor } = CUDA_COMPATIBILITY_REQUIREMENTS.minimumComputeCapability;
      return {
        description: t('settings.sidecar.cudaCompatibility.incompatibleGpu', {
          minimumComputeCapability: `${major}.${minor}`,
        }),
        installAction: 'none',
      };
    }
    case 'unknown':
      return {
        description: t('settings.sidecar.cudaCompatibility.unknown'),
        installAction: 'manual',
      };
    case 'unsupported':
      return {
        description: t('settings.sidecar.cudaCompatibility.unsupported'),
        installAction: 'none',
      };
  }
}
