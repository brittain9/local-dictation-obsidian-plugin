import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyFrontendBuildOutput } from '../scripts/verify-build-output.mjs';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function writeBundle(contents: string): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'verify-build-output-'));
  tempDirectories.push(rootDir);
  await mkdir(rootDir, { recursive: true });
  await writeFile(join(rootDir, 'main.js'), contents);
  return rootDir;
}

describe('verifyFrontendBuildOutput', () => {
  it('accepts a self-contained bundle with the inlined recorder worklet', async () => {
    const rootDir = await writeBundle('registerProcessor("obsidian-local-stt-pcm-recorder", {})');

    await expect(verifyFrontendBuildOutput({ rootDir })).resolves.toBeUndefined();
  });

  it.each([
    ['a dynamic Node import', 'import("node:fs")', /dynamic node: import/],
    ['an external recorder worklet', 'pcm-recorder.worklet.js', /external recorder worklet/],
    ['a missing inlined worklet', 'const bundle = true;', /missing the inlined recorder worklet/],
  ])('rejects %s', async (_label, bundle, expected) => {
    const rootDir = await writeBundle(bundle);

    await expect(verifyFrontendBuildOutput({ rootDir })).rejects.toThrow(expected);
  });
});
