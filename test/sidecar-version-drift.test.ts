import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type SidecarInstallVariant, variantDirectoryPath } from '../src/sidecar/sidecar-installer';
import {
  detectSidecarVersionDrift,
  isDevelopmentSidecarVersion,
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

describe('isDevelopmentSidecarVersion', () => {
  it('identifies dev install manifests', () => {
    expect(isDevelopmentSidecarVersion('dev-debug')).toBe(true);
    expect(isDevelopmentSidecarVersion(' dev-release ')).toBe(true);
    expect(isDevelopmentSidecarVersion('2026.5.23')).toBe(false);
  });
});

describe('detectSidecarVersionDrift', () => {
  it('returns an empty list when no sidecar has an install manifest', async () => {
    const pluginDirectory = await createTempDirectory();

    await expect(
      detectSidecarVersionDrift({
        pluginDirectory,
        requiredVersion: '2026.5.23',
        preferredVariant: 'cuda',
        supportsCuda: true,
      }),
    ).resolves.toEqual([]);
  });

  it('returns an empty list when installed versions match the required sidecar', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeInstallManifest(pluginDirectory, 'cpu', '2026.5.23');
    await writeInstallManifest(pluginDirectory, 'cuda', '2026.5.23');

    await expect(
      detectSidecarVersionDrift({
        pluginDirectory,
        requiredVersion: '2026.5.23',
        preferredVariant: 'cuda',
        supportsCuda: true,
      }),
    ).resolves.toEqual([]);
  });

  it('reports every stale installed variant with the preferred variant first', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeInstallManifest(pluginDirectory, 'cpu', '2026.5.18');
    await writeInstallManifest(pluginDirectory, 'cuda', '2026.5.19');

    await expect(
      detectSidecarVersionDrift({
        pluginDirectory,
        requiredVersion: '2026.5.23',
        preferredVariant: 'cuda',
        supportsCuda: true,
      }),
    ).resolves.toEqual([
      {
        installedVersion: '2026.5.19',
        requiredVersion: '2026.5.23',
        variant: 'cuda',
      },
      {
        installedVersion: '2026.5.18',
        requiredVersion: '2026.5.23',
        variant: 'cpu',
      },
    ]);
  });

  it('prioritizes CPU when the user selected CPU-only acceleration', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeInstallManifest(pluginDirectory, 'cpu', '2026.5.18');
    await writeInstallManifest(pluginDirectory, 'cuda', '2026.5.19');

    const drift = await detectSidecarVersionDrift({
      pluginDirectory,
      requiredVersion: '2026.5.23',
      preferredVariant: 'cpu',
      supportsCuda: true,
    });

    expect(drift.map((entry) => entry.variant)).toEqual(['cpu', 'cuda']);
  });

  it('reports only stale variants when installed versions are mixed', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeInstallManifest(pluginDirectory, 'cpu', '2026.5.23');
    await writeInstallManifest(pluginDirectory, 'cuda', '2026.5.19');

    await expect(
      detectSidecarVersionDrift({
        pluginDirectory,
        requiredVersion: '2026.5.23',
        preferredVariant: 'cuda',
        supportsCuda: true,
      }),
    ).resolves.toEqual([
      {
        installedVersion: '2026.5.19',
        requiredVersion: '2026.5.23',
        variant: 'cuda',
      },
    ]);
  });

  it('ignores dev sidecars even when their versions differ from the requirement', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeInstallManifest(pluginDirectory, 'cpu', 'dev-debug');
    await writeInstallManifest(pluginDirectory, 'cuda', 'dev-release');

    await expect(
      detectSidecarVersionDrift({
        pluginDirectory,
        requiredVersion: '2026.5.23',
        preferredVariant: 'cuda',
        supportsCuda: true,
      }),
    ).resolves.toEqual([]);
  });

  it('does not inspect CUDA installs on platforms without CUDA sidecars', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeInstallManifest(pluginDirectory, 'cpu', '2026.5.23');
    await writeInstallManifest(pluginDirectory, 'cuda', '2026.5.19');

    await expect(
      detectSidecarVersionDrift({
        pluginDirectory,
        requiredVersion: '2026.5.23',
        preferredVariant: 'cuda',
        supportsCuda: false,
      }),
    ).resolves.toEqual([]);
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
