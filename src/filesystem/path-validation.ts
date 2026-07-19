import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

type ExistingPathKind = 'directory' | 'file' | 'missing' | 'other';

export type ExistingFilePathValidationCode =
  | 'missing'
  | 'not_absolute'
  | 'not_configured'
  | 'not_file';

export type ExistingFilePathValidationResult =
  | { path: string; valid: true }
  | { code: ExistingFilePathValidationCode; path?: string; valid: false };

export async function getExistingPathKind(path: string): Promise<ExistingPathKind> {
  try {
    const stats = await stat(path);

    if (stats.isFile()) {
      return 'file';
    }

    if (stats.isDirectory()) {
      return 'directory';
    }

    return 'other';
  } catch (error) {
    if (isMissingFileError(error)) {
      return 'missing';
    }

    throw error;
  }
}

export async function assertAbsoluteExistingFilePath(
  path: string,
  settingLabel: string,
): Promise<string> {
  const result = await checkAbsoluteExistingFilePath(path);
  if (result.valid) return result.path;

  switch (result.code) {
    case 'not_configured':
      throw new Error(`${settingLabel} is not configured.`);
    case 'not_absolute':
      throw new Error(`${settingLabel} must be an absolute path.`);
    case 'missing':
      throw new Error(`${settingLabel} does not exist: ${result.path ?? ''}`);
    case 'not_file':
      throw new Error(`${settingLabel} must point to a file: ${result.path ?? ''}`);
  }
}

export async function checkAbsoluteExistingFilePath(
  path: string,
): Promise<ExistingFilePathValidationResult> {
  const normalizedPath = path.trim();

  if (normalizedPath.length === 0) {
    return { code: 'not_configured', valid: false };
  }

  if (!isAbsolute(normalizedPath)) {
    return { code: 'not_absolute', valid: false };
  }

  const pathKind = await getExistingPathKind(normalizedPath);

  if (pathKind === 'missing') {
    return { code: 'missing', path: normalizedPath, valid: false };
  }

  if (pathKind !== 'file') {
    return { code: 'not_file', path: normalizedPath, valid: false };
  }

  return { path: normalizedPath, valid: true };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
