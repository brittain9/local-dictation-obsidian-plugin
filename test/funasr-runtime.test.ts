import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureFunasrSidecarArtifacts,
  requireFunasrSidecarArtifacts,
} from '../scripts/lib/funasr-runtime.mjs';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('FunASR runtime staging', () => {
  it('does not download missing helpers unless explicitly requested', async () => {
    const destinationDirectory = await mkdtemp(join(tmpdir(), 'funasr-runtime-test-'));
    tempDirectories.push(destinationDirectory);

    await expect(ensureFunasrSidecarArtifacts({ destinationDirectory })).resolves.toEqual([]);
    await expect(readdir(destinationDirectory)).resolves.toEqual([]);
  });

  it('fails verification when a required runtime artifact is missing', async () => {
    const destinationDirectory = await mkdtemp(join(tmpdir(), 'funasr-runtime-test-'));
    tempDirectories.push(destinationDirectory);

    await expect(requireFunasrSidecarArtifacts({ destinationDirectory })).rejects.toThrow(
      'Missing FunASR sidecar runtime artifact',
    );
  });
});
