export interface PrepareReleaseOptions {
  includeSidecar?: boolean;
  minAppVersion?: string;
  rootDir?: string;
  version: string;
}

export interface PreparedRelease {
  includesSidecar: boolean;
  minAppVersion: string;
  notesPath: string;
  sidecarVersion: string;
  version: string;
}

export function prepareRelease(options: PrepareReleaseOptions): Promise<PreparedRelease>;
