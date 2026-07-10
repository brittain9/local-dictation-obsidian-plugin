export interface PrepareReleaseOptions {
  minAppVersion?: string;
  rootDir?: string;
  version: string;
}

export interface PreparedRelease {
  minAppVersion: string;
  notesPath: string;
  version: string;
}

export function prepareRelease(options: PrepareReleaseOptions): Promise<PreparedRelease>;
