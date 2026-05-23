import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type SidecarInstallVariant, variantDirectoryPath } from '../src/sidecar/sidecar-installer';
import {
  detectSidecarVersionDrift,
  isSidecarVersionDrifted,
} from '../src/sidecar/sidecar-version-drift';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('isSidecarVersionDrifted', () => {
  it('treats identical versions as in sync', () => {
    expect(isSidecarVersionDrifted('2026.5.23', '2026.5.23')).toBe(false);
  });

  it('flags differing versions as drifted', () => {
    expect(isSidecarVersionDrifted('2026.5.19', '2026.5.23')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(isSidecarVersionDrifted(' 2026.5.23 ', '2026.5.23')).toBe(false);
  });
});

describe('detectSidecarVersionDrift', () => {
  it('returns null when the variant has no install manifest', async () => {
    const pluginDirectory = await createTempDirectory();

    await expect(
      detectSidecarVersionDrift({ pluginDirectory, pluginVersion: '2026.5.23', variant: 'cpu' }),
    ).resolves.toBeNull();
  });

  it('returns null when the installed version matches the plugin version', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeInstallManifest(pluginDirectory, 'cpu', '2026.5.23');

    await expect(
      detectSidecarVersionDrift({ pluginDirectory, pluginVersion: '2026.5.23', variant: 'cpu' }),
    ).resolves.toBeNull();
  });

  it('reports drift when the installed version differs from the plugin version', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeInstallManifest(pluginDirectory, 'cuda', '2026.5.19');

    await expect(
      detectSidecarVersionDrift({ pluginDirectory, pluginVersion: '2026.5.23', variant: 'cuda' }),
    ).resolves.toEqual({
      installedVersion: '2026.5.19',
      pluginVersion: '2026.5.23',
      variant: 'cuda',
    });
  });
});

async function createTempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'obsidian-local-stt-drift-'));
  tempDirectories.push(path);
  return path;
}

async function writeInstallManifest(
  pluginDirectory: string,
  variant: SidecarInstallVariant,
  version: string,
): Promise<void> {
  const variantDir = variantDirectoryPath(pluginDirectory, variant);
  await mkdir(variantDir, { recursive: true });
  await writeFile(
    join(variantDir, 'install.json'),
    JSON.stringify({
      installedAt: '2026-05-19T00:00:00.000Z',
      sha256: '0'.repeat(64),
      variant,
      version,
    }),
    'utf8',
  );
}
