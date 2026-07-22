export interface CheckReleaseOptions {
  rootDir?: string;
  tag?: string;
}

export interface CheckedRelease {
  includesSidecar: boolean;
  minAppVersion: string;
  notesPath: string;
  sidecarVersion: string;
  version: string;
}

export function checkRelease(options?: CheckReleaseOptions): Promise<CheckedRelease>;
export function validateReleaseNotes(notesPath: string): Promise<void>;
