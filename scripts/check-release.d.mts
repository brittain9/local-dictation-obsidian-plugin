export interface CheckReleaseOptions {
  rootDir?: string;
  tag?: string;
}

export interface CheckedRelease {
  minAppVersion: string;
  notesPath: string;
  version: string;
}

export function checkRelease(options?: CheckReleaseOptions): Promise<CheckedRelease>;
export function validateReleaseNotes(notesPath: string): Promise<void>;
