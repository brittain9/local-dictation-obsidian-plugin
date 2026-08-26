export interface DevCudaInstallOptions {
  cleanCuda: boolean;
  cuda: boolean;
  enable: boolean;
  help: boolean;
  jobs: number | null;
  release: boolean;
  resetData: boolean;
  vault: string | null;
}

export interface DevCudaInstallStep {
  args: string[];
  command: string;
  env?: Record<string, string>;
  label: string;
  retry?: {
    args: string[];
    command: string;
    env?: Record<string, string>;
    reason: string;
  };
}

export interface FileSnapshotEntry {
  kind: 'file';
  sha256: string;
  size: number;
}

export interface SymlinkSnapshotEntry {
  kind: 'symlink';
  linkTarget: string;
  size: number;
}

export type SnapshotEntry = FileSnapshotEntry | SymlinkSnapshotEntry;
export type InstallSnapshot = Map<string, SnapshotEntry>;

export interface InstallChangeSummary {
  created: string[];
  overwrittenChanged: string[];
  overwrittenUnchanged: string[];
  preserved: string[];
  removed: string[];
}

export function parseArgs(argv: string[]): DevCudaInstallOptions;
export function createBuildSteps(
  options: DevCudaInstallOptions,
  platform?: NodeJS.Platform | string,
): DevCudaInstallStep[];
export function createInstallStep(options: DevCudaInstallOptions): DevCudaInstallStep;
export function summarizeInstallChanges(
  before: InstallSnapshot,
  after: InstallSnapshot,
  preservedFiles?: readonly string[],
): InstallChangeSummary;
