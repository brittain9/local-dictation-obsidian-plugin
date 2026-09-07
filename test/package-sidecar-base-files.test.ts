import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { stageSidecarBaseFiles } from '../scripts/lib/package-sidecar-base-files.mjs';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('stageSidecarBaseFiles', () => {
  it('stages both version-matched executables and third-party model notices together', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sidecar-package-'));
    tempDirectories.push(directory);
    const binaryPath = join(directory, 'source-sidecar');
    const artifactDirectory = join(directory, 'artifact');
    const extraPath = join(directory, 'libsherpa-onnx-c-api.so');
    const helperPath = join(directory, 'source-helper');
    await writeFile(binaryPath, 'binary');
    await writeFile(extraPath, 'runtime');
    await writeFile(helperPath, 'helper');

    await stageSidecarBaseFiles({
      artifactDirectory,
      binaryName: 'local-dictation-sidecar',
      binaryPath,
      extraFilePaths: [extraPath],
      helperName: 'local-dictation-translation-helper',
      helperPath,
    });

    await expect(
      readFile(join(artifactDirectory, 'local-dictation-sidecar'), 'utf8'),
    ).resolves.toBe('binary');
    await expect(
      readFile(join(artifactDirectory, 'local-dictation-translation-helper'), 'utf8'),
    ).resolves.toBe('helper');
    await expect(
      readFile(join(artifactDirectory, 'libsherpa-onnx-c-api.so'), 'utf8'),
    ).resolves.toBe('runtime');
    const notices = await readFile(join(artifactDirectory, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('WeSpeaker');
    expect(notices).toContain('CC BY 4.0');
    expect(notices).toContain('Copyright (c) 2023 CNRS');
    expect(notices).toContain('Silero VAD');
    expect(notices).toContain('Copyright (c) 2020-present Silero Team');
    expect(notices).toContain('MIT License');
    expect(notices).toContain('NVIDIA Nemotron 3.5 ASR');
    expect(notices).toContain('OpenMDW License Agreement, version 1.1');
    expect(notices).toContain('numerical representation');
    expect(notices).toContain('Tencent HY-MT');
    expect(notices).toContain('FunASR hybrid Chinese dictation');
  });
});
