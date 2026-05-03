import type { InstallProgressState } from '../models/model-install-progress';
import { formatErrorMessage } from '../shared/format-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import {
  type InstallProgress,
  installSidecar,
  type SidecarInstallVariant,
} from './sidecar-installer';

export type SidecarInstallPhase = 'canceling' | 'installing';

export interface ActiveSidecarInstall {
  phase: SidecarInstallPhase;
  progress: InstallProgress;
  variant: SidecarInstallVariant;
}

export interface SidecarInstallManagerState {
  activeInstall: ActiveSidecarInstall | null;
  lastError: string | null;
}

export interface SidecarInstallOptions {
  beforeReplace?: (() => Promise<void>) | undefined;
  onInstalled: () => Promise<void>;
  pluginDirectory: string;
  successNotice: string;
  variant: SidecarInstallVariant;
  version: string;
}

interface SidecarInstallManagerDependencies {
  logger?: PluginLogger | undefined;
  notice: (message: string) => void;
}

const INITIAL_PROGRESS: InstallProgress = {
  bytesDownloaded: 0,
  phase: 'download',
  totalBytes: null,
};

export class SidecarInstallManager {
  private abortController: AbortController | null = null;
  private activeInstall: ActiveSidecarInstall | null = null;
  private lastError: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: SidecarInstallManagerDependencies) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): Readonly<SidecarInstallManagerState> {
    return {
      activeInstall: this.activeInstall,
      lastError: this.lastError,
    };
  }

  install(options: SidecarInstallOptions): void {
    if (this.activeInstall !== null) {
      throw new Error('Another sidecar is already being installed.');
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.lastError = null;
    this.activeInstall = {
      phase: 'installing',
      progress: INITIAL_PROGRESS,
      variant: options.variant,
    };
    this.notify();

    void this.runInstall(options, controller.signal);
  }

  cancel(): void {
    const current = this.activeInstall;

    if (current === null || current.phase !== 'installing') {
      return;
    }

    this.activeInstall = { ...current, phase: 'canceling' };
    this.notify();
    this.abortController?.abort();
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.activeInstall = null;
    this.listeners.clear();
  }

  private async runInstall(options: SidecarInstallOptions, signal: AbortSignal): Promise<void> {
    try {
      await installSidecar({
        beforeReplace: options.beforeReplace,
        logger: this.deps.logger,
        onProgress: (progress) => {
          this.updateProgress(progress);
        },
        pluginDirectory: options.pluginDirectory,
        signal,
        variant: options.variant,
        version: options.version,
      });

      await options.onInstalled();
      this.deps.notice(options.successNotice);
      this.lastError = null;
    } catch (error) {
      if (isAbortError(error)) {
        this.deps.notice('Sidecar install cancelled.');
        this.lastError = null;
      } else {
        const message = formatErrorMessage(error);
        this.deps.logger?.error('installer', 'sidecar install failed', error);
        this.lastError = message;
        this.deps.notice(`Sidecar install failed: ${message}`);
      }
    } finally {
      if (this.abortController?.signal === signal) {
        this.abortController = null;
      }
      this.activeInstall = null;
      this.notify();
    }
  }

  private updateProgress(progress: InstallProgress): void {
    if (this.activeInstall === null) return;

    this.activeInstall = {
      ...this.activeInstall,
      progress,
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function buildSidecarProgressState(active: ActiveSidecarInstall): InstallProgressState {
  return {
    details: null,
    downloadedBytes: active.progress.bytesDownloaded,
    isCancelling: active.phase === 'canceling',
    message: formatProgressMessage(active.progress.phase),
    state: 'downloading',
    totalBytes: active.progress.totalBytes,
  };
}

function formatProgressMessage(phase: InstallProgress['phase']): string {
  switch (phase) {
    case 'download':
      return 'Downloading';
    case 'verify':
      return 'Verifying checksum...';
    case 'extract':
      return 'Extracting archive...';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
