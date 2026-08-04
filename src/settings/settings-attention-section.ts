import { Platform, Setting } from 'obsidian';

import { getSidecarUpdateCopy } from '../setup/sidecar-install-copy';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import { type GetCudaCompatibility, isCudaSidecarUsable } from '../sidecar/cuda-compatibility';
import type { CudaCompatibility } from '../sidecar/gpu-precheck';
import {
  type ActiveSidecarInstall,
  buildSidecarProgressState,
  type SidecarInstallManager,
} from '../sidecar/sidecar-install-manager';
import {
  readInstallManifest,
  type SidecarInstallVariant,
  variantDirectoryPath,
} from '../sidecar/sidecar-installer';
import { resolveSidecarVersionDrift } from '../sidecar/sidecar-version-drift';
import { renderActiveInstallCard } from './install-progress-row';
import type { PluginSettings } from './plugin-settings';
import {
  resolveSettingsAttention,
  type SettingsAttentionItem,
  type SettingsAttentionResolution,
  type SettingsAttentionSnapshot,
  type SidecarManifestState,
} from './settings-attention';

export interface SettingsAttentionActions {
  enableCuda(): Promise<void>;
  installCuda(pluginDirectory: string): void;
  openSetup(): Promise<void>;
  updateSidecars(pluginDirectory: string, variants: readonly SidecarInstallVariant[]): void;
}

export interface SettingsAttentionSectionDependencies {
  actions: SettingsAttentionActions;
  getCudaCompatibility: GetCudaCompatibility;
  getSettings: () => PluginSettings;
  load?: (() => Promise<LoadedSettingsAttention | null>) | undefined;
  logger?: PluginLogger | undefined;
  pluginVersion: string;
  resolvePluginDirectory: () => Promise<string>;
  sidecarInstallManager: SidecarInstallManager;
}

export interface LoadedSettingsAttention {
  pluginDirectory: string | null;
  snapshot: SettingsAttentionSnapshot;
}

interface RenderedAttention {
  progressEl: HTMLDivElement | null;
  updateProgress: ((activeInstall: ActiveSidecarInstall) => void) | null;
}

const UNKNOWN_MANIFESTS = {
  cpu: { status: 'unknown' },
  cuda: { status: 'unknown' },
} as const satisfies Readonly<Record<SidecarInstallVariant, SidecarManifestState>>;

export class SettingsAttentionSection {
  private disposed = false;
  private generation = 0;
  private progressEl: HTMLDivElement | null = null;
  private updateProgress: ((activeInstall: ActiveSidecarInstall) => void) | null = null;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly deps: SettingsAttentionSectionDependencies,
  ) {}

  init(): () => void {
    if (this.hasCustomSidecar()) {
      this.renderEmpty();
    } else {
      const activeInstall = this.deps.sidecarInstallManager.getState().activeInstall;
      if (activeInstall === null) {
        void this.refresh();
      } else {
        this.renderProgress(activeInstall);
      }
    }

    const unsubscribe = this.deps.sidecarInstallManager.subscribe(() => {
      this.handleInstallStateChange();
    });
    return () => {
      this.disposed = true;
      this.generation += 1;
      this.progressEl = null;
      this.updateProgress = null;
      unsubscribe();
    };
  }

  private renderEmpty(): void {
    this.generation += 1;
    this.applyResolution({ items: [], kind: 'items' }, null);
  }

  private hasCustomSidecar(): boolean {
    return this.deps.getSettings().sidecarPathOverride.trim().length > 0;
  }

  private handleInstallStateChange(): void {
    if (this.disposed || !isConnected(this.container)) return;
    if (this.hasCustomSidecar()) {
      this.renderEmpty();
      return;
    }

    const activeInstall = this.deps.sidecarInstallManager.getState().activeInstall;
    if (activeInstall === null) {
      void this.refresh();
    } else {
      if (this.progressEl !== null && this.updateProgress !== null) {
        this.updateProgress(activeInstall);
      } else {
        this.renderProgress(activeInstall);
      }
    }
  }

  private renderProgress(activeInstall: ActiveSidecarInstall): void {
    this.generation += 1;
    this.applyResolution({ activeInstall, kind: 'progress' }, null);
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const loaded =
      this.deps.load === undefined
        ? await loadSettingsAttention(this.deps)
        : await this.deps.load();
    if (this.disposed || generation !== this.generation || !isConnected(this.container)) {
      return;
    }

    const currentSettings = this.deps.getSettings();
    if (currentSettings.sidecarPathOverride.trim().length > 0) {
      this.renderEmpty();
      return;
    }

    const activeInstall = this.deps.sidecarInstallManager.getState().activeInstall;
    if (activeInstall !== null) {
      this.renderProgress(activeInstall);
      return;
    }

    const resolution =
      loaded === null
        ? ({ items: [], kind: 'items' } as const)
        : resolveSettingsAttention({
            ...loaded.snapshot,
            accelerationPreference: currentSettings.accelerationPreference,
            activeInstall,
            customSidecarConfigured: false,
          });
    this.applyResolution(resolution, loaded?.pluginDirectory ?? null);
  }

  private applyResolution(
    resolution: SettingsAttentionResolution,
    pluginDirectory: string | null,
  ): void {
    const rendered = renderSettingsAttention(
      this.container,
      resolution,
      pluginDirectory,
      this.deps.actions,
      () => this.deps.sidecarInstallManager.cancel(),
      () => {
        void this.refresh();
      },
    );
    this.progressEl = rendered.progressEl;
    this.updateProgress = rendered.updateProgress;
  }
}

export async function loadSettingsAttention(
  deps: Omit<SettingsAttentionSectionDependencies, 'actions' | 'load'>,
): Promise<LoadedSettingsAttention | null> {
  const initialSettings = deps.getSettings();
  if (initialSettings.sidecarPathOverride.trim().length > 0) {
    return {
      pluginDirectory: null,
      snapshot: {
        accelerationPreference: initialSettings.accelerationPreference,
        activeInstall: deps.sidecarInstallManager.getState().activeInstall,
        cudaCompatibility: null,
        customSidecarConfigured: true,
        drift: [],
        manifests: UNKNOWN_MANIFESTS,
      },
    };
  }

  let pluginDirectory: string;
  try {
    pluginDirectory = await deps.resolvePluginDirectory();
  } catch (error) {
    deps.logger?.error('installer', 'failed to resolve plugin directory', error);
    return null;
  }

  const cpuRead = readManifestState(pluginDirectory, 'cpu', deps.logger);
  const cudaRead = Platform.isMacOS
    ? Promise.resolve<SidecarManifestState>({ status: 'absent' })
    : readManifestState(pluginDirectory, 'cuda', deps.logger);
  const compatibilityRead = Platform.isMacOS
    ? Promise.resolve<CudaCompatibility>({ status: 'unsupported' })
    : deps.getCudaCompatibility().catch((error: unknown) => {
        deps.logger?.warn('installer', 'CUDA compatibility probe failed in Settings', error);
        return { status: 'unknown' } as const;
      });
  const [cpu, cuda, cudaCompatibility] = await Promise.all([cpuRead, cudaRead, compatibilityRead]);
  const settings = deps.getSettings();
  const manifests = { cpu, cuda };
  // Drift is only computed for variants this machine can run: an unusable CUDA
  // install has nothing to gain from an update, and offering one instead of CPU
  // recovery sends the user in the wrong direction.
  const variants = resolveVariantOrder(
    settings.accelerationPreference,
    isCudaSidecarUsable(cudaCompatibility),
  );

  return {
    pluginDirectory,
    snapshot: {
      accelerationPreference: settings.accelerationPreference,
      activeInstall: deps.sidecarInstallManager.getState().activeInstall,
      cudaCompatibility,
      customSidecarConfigured: settings.sidecarPathOverride.trim().length > 0,
      drift: resolveSidecarVersionDrift({
        manifests: {
          ...(cpu.status === 'installed' ? { cpu: cpu.manifest } : {}),
          ...(cuda.status === 'installed' ? { cuda: cuda.manifest } : {}),
        },
        pluginVersion: deps.pluginVersion,
        variants,
      }),
      manifests,
    },
  };
}

export function renderSettingsAttention(
  container: HTMLDivElement,
  resolution: SettingsAttentionResolution,
  pluginDirectory: string | null,
  actions: SettingsAttentionActions,
  onCancel: () => void,
  onActionSettled: () => void,
): RenderedAttention {
  container.empty();
  // Participate in Obsidian's native settings-group rhythm so the following
  // section heading keeps the same separation as every other group boundary.
  container.addClass('setting-group');
  container.addClass('local-stt-settings-attention');
  const isEmpty = resolution.kind === 'items' && resolution.items.length === 0;
  container.toggle(!isEmpty);
  if (isEmpty) return { progressEl: null, updateProgress: null };

  // No visible heading: this region only ever holds a single row, whose own
  // name already states what needs doing, so a heading above it just repeats
  // itself. The accessible name lives on the region instead.
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', t('settings.attention.regionLabel'));
  const items = container.createDiv({ cls: 'setting-items' });

  if (resolution.kind === 'progress') {
    const activeInstall = resolution.activeInstall;
    const card = renderActiveInstallCard(items, progressCardOptions(activeInstall, onCancel));
    return {
      progressEl: card.progressEl,
      updateProgress: (next) => {
        card.update(progressCardOptions(next, onCancel));
      },
    };
  }

  for (const item of resolution.items) {
    renderAttentionItem(items, item, pluginDirectory, actions, onActionSettled);
  }
  return { progressEl: null, updateProgress: null };
}

async function readManifestState(
  pluginDirectory: string,
  variant: SidecarInstallVariant,
  logger: PluginLogger | undefined,
): Promise<SidecarManifestState> {
  try {
    const manifest = await readInstallManifest(variantDirectoryPath(pluginDirectory, variant));
    return manifest === null ? { status: 'absent' } : { manifest, status: 'installed' };
  } catch (error) {
    logger?.warn('installer', `failed to read ${variant} install manifest in Settings`, error);
    return { status: 'unknown' };
  }
}

function renderAttentionItem(
  container: HTMLDivElement,
  item: SettingsAttentionItem,
  pluginDirectory: string | null,
  actions: SettingsAttentionActions,
  onActionSettled: () => void,
): void {
  const copy = getAttentionItemCopy(item);
  const setting = new Setting(container).setName(copy.name).setDesc(copy.description);
  setting.setClass('local-stt-settings-attention__item');
  setting.addButton((button) => {
    button
      .setButtonText(copy.action)
      .setCta()
      .onClick(async () => {
        if (item.action === 'setup') {
          button.setDisabled(true);
          try {
            await actions.openSetup();
          } finally {
            button.setDisabled(false);
            onActionSettled();
          }
          return;
        }

        if (pluginDirectory === null) return;
        if (item.action === 'update_sidecars') {
          actions.updateSidecars(pluginDirectory, item.variants);
          return;
        }
        if (item.action === 'install_cuda') {
          actions.installCuda(pluginDirectory);
          return;
        }

        button.setDisabled(true);
        try {
          await actions.enableCuda();
        } finally {
          button.setDisabled(false);
          onActionSettled();
        }
      });
  });
}

function getAttentionItemCopy(item: SettingsAttentionItem): {
  action: string;
  description: string;
  name: string;
} {
  switch (item.action) {
    case 'setup':
      return {
        action: t('settings.runSetup.name'),
        description: t('settings.missingSidecar.desc'),
        name: t('settings.missingSidecar.name'),
      };
    case 'update_sidecars': {
      const copy = getSidecarUpdateCopy(item.variants);
      return {
        action: copy.primaryButtonText,
        description: copy.bodyText,
        name: copy.title,
      };
    }
    case 'install_cuda':
      return {
        action: t('settings.attention.installCuda.action'),
        description: t('settings.attention.installCuda.desc'),
        name: t('settings.attention.installCuda.name'),
      };
    case 'enable_cuda':
      return {
        action: t('settings.attention.enableCuda.action'),
        description: t('settings.attention.enableCuda.desc'),
        name: t('settings.attention.enableCuda.name'),
      };
  }
}

function progressCardOptions(
  activeInstall: ActiveSidecarInstall,
  onCancel: () => void,
): Parameters<typeof renderActiveInstallCard>[1] {
  return {
    isCancelling: activeInstall.phase === 'canceling',
    name: Platform.isMacOS
      ? t('settings.install.installingSidecarMac')
      : t('settings.install.installingSidecar', {
          variant: activeInstall.variant.toUpperCase(),
        }),
    onCancel,
    progressState: buildSidecarProgressState(activeInstall),
  };
}

function resolveVariantOrder(
  accelerationPreference: PluginSettings['accelerationPreference'],
  supportsCuda: boolean,
): readonly SidecarInstallVariant[] {
  if (!supportsCuda) return ['cpu'];
  return accelerationPreference === 'cpu_only' ? ['cpu', 'cuda'] : ['cuda', 'cpu'];
}

function isConnected(element: HTMLElement): boolean {
  return (element as HTMLElement & { isConnected?: boolean }).isConnected !== false;
}
