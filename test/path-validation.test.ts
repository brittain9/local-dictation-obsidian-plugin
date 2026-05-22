import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertAbsoluteExistingFilePath,
  getExistingPathKind,
} from '../src/filesystem/path-validation';

const LABEL = 'Custom path setting';

let workspaceDir: string;
let regularFilePath: string;
let symlinkToFilePath: string | null = null;
let symlinkToDirPath: string | null = null;

beforeAll(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'path-validation-test-'));
  regularFilePath = join(workspaceDir, 'real.txt');
  await writeFile(regularFilePath, 'payload', 'utf8');

  // Symlinks require elevated privileges on Windows. Skip silently if the
  // sandbox doesn't permit them so the suite still passes on CI runners
  // without symlink rights; the cases below guard on null.
  try {
    const candidate = join(workspaceDir, 'link-to-file.txt');
    await symlink(regularFilePath, candidate);
    symlinkToFilePath = candidate;
  } catch {
    symlinkToFilePath = null;
  }

  try {
    const candidate = join(workspaceDir, 'link-to-dir');
    await symlink(workspaceDir, candidate);
    symlinkToDirPath = candidate;
  } catch {
    symlinkToDirPath = null;
  }
});

afterAll(async () => {
  await rm(workspaceDir, { force: true, recursive: true });
});

describe('assertAbsoluteExistingFilePath', () => {
  it('rejects an empty string', async () => {
    await expect(assertAbsoluteExistingFilePath('', LABEL)).rejects.toThrow(/is not configured/);
  });

  it('rejects whitespace-only input (trimmed empty)', async () => {
    await expect(assertAbsoluteExistingFilePath('   \t\n', LABEL)).rejects.toThrow(
      /is not configured/,
    );
  });

  it('rejects a relative path', async () => {
    await expect(assertAbsoluteExistingFilePath('./relative', LABEL)).rejects.toThrow(
      /must be an absolute path/,
    );
  });

  it('rejects an absolute path that does not exist', async () => {
    const missing = join(workspaceDir, `does-not-exist-${Math.random().toString(36).slice(2)}`);
    await expect(assertAbsoluteExistingFilePath(missing, LABEL)).rejects.toThrow(/does not exist/);
  });

  it('rejects an existing directory', async () => {
    await expect(assertAbsoluteExistingFilePath(workspaceDir, LABEL)).rejects.toThrow(
      /must point to a file/,
    );
  });

  it('returns the trimmed path for an existing regular file', async () => {
    await expect(assertAbsoluteExistingFilePath(`  ${regularFilePath}  `, LABEL)).resolves.toBe(
      regularFilePath,
    );
  });

  it('returns the symlink path unchanged when the target is a regular file', async () => {
    if (symlinkToFilePath === null) {
      return;
    }
    // Contract: the validator does NOT call realpath. A symlink to a file is
    // accepted and returned as-given. Future security work may want to resolve
    // symlinks before passing the result to the sidecar.
    await expect(assertAbsoluteExistingFilePath(symlinkToFilePath, LABEL)).resolves.toBe(
      symlinkToFilePath,
    );
  });

  it('rejects a symlink whose target is a directory', async () => {
    if (symlinkToDirPath === null) {
      return;
    }
    await expect(assertAbsoluteExistingFilePath(symlinkToDirPath, LABEL)).rejects.toThrow(
      /must point to a file/,
    );
  });

  it('includes the configured label in the error message', async () => {
    await expect(assertAbsoluteExistingFilePath('', 'Ollama binary')).rejects.toThrow(
      /Ollama binary/,
    );
  });
});

describe('getExistingPathKind', () => {
  it('reports file for a regular file', async () => {
    await expect(getExistingPathKind(regularFilePath)).resolves.toBe('file');
  });

  it('reports directory for an existing directory', async () => {
    await expect(getExistingPathKind(workspaceDir)).resolves.toBe('directory');
  });

  it('reports missing for an absent path', async () => {
    const missing = join(workspaceDir, 'never-created');
    await expect(getExistingPathKind(missing)).resolves.toBe('missing');
  });
});
