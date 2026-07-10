import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkRelease } from '../scripts/check-release.mjs';
import { prepareRelease } from '../scripts/prepare-release.mjs';

describe('release workflow', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  async function createReleaseFixture(): Promise<string> {
    const rootDir = await mkdtemp(join(tmpdir(), 'prepare-release-'));
    tempDirectories.push(rootDir);

    await mkdir(join(rootDir, 'native'), { recursive: true });
    await mkdir(join(rootDir, 'docs', 'release', 'notes'), { recursive: true });
    await writeFile(
      join(rootDir, 'manifest.json'),
      `${JSON.stringify(
        {
          id: 'local-dictation',
          version: '2026.7.3',
          minAppVersion: '1.11.5',
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(rootDir, 'package.json'),
      `${JSON.stringify({ name: 'local-dictation', version: '2026.7.3' }, null, 2)}\n`,
    );
    await writeFile(
      join(rootDir, 'package-lock.json'),
      `${JSON.stringify(
        {
          name: 'local-dictation',
          version: '2026.7.3',
          packages: { '': { name: 'local-dictation', version: '2026.7.3' } },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(rootDir, 'native', 'Cargo.toml'),
      '[package]\nname = "local-dictation-sidecar"\nversion = "2026.7.3"\nedition = "2024"\n\n[dependencies]\nanyhow = "1.0"\n',
    );
    await writeFile(
      join(rootDir, 'native', 'Cargo.lock'),
      'version = 4\n\n[[package]]\nname = "anyhow"\nversion = "1.0.99"\n\n[[package]]\nname = "local-dictation-sidecar"\nversion = "2026.7.3"\ndependencies = [\n "anyhow",\n]\n',
    );
    await writeFile(
      join(rootDir, 'versions.json'),
      `${JSON.stringify({ '2026.7.2': '1.11.5', '2026.7.3': '1.11.5' }, null, 2)}\n`,
    );
    await writeFile(
      join(rootDir, 'docs', 'release', 'notes', '2026.7.3.md'),
      '## Fixes\n\n- **Previous.** Existing release notes.\n',
    );

    return rootDir;
  }

  it('updates every release metadata mirror and scaffolds notes for an unbounded micro', async () => {
    const rootDir = await createReleaseFixture();

    await prepareRelease({ rootDir, version: '2026.7.32' });

    const manifest = JSON.parse(await readFile(join(rootDir, 'manifest.json'), 'utf8'));
    const packageJson = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(await readFile(join(rootDir, 'package-lock.json'), 'utf8'));
    const cargoManifest = await readFile(join(rootDir, 'native', 'Cargo.toml'), 'utf8');
    const cargoLock = await readFile(join(rootDir, 'native', 'Cargo.lock'), 'utf8');
    const versions = JSON.parse(await readFile(join(rootDir, 'versions.json'), 'utf8'));
    const notes = await readFile(join(rootDir, 'docs', 'release', 'notes', '2026.7.32.md'), 'utf8');

    expect(manifest.version).toBe('2026.7.32');
    expect(packageJson.version).toBe('2026.7.32');
    expect(packageLock.version).toBe('2026.7.32');
    expect(packageLock.packages[''].version).toBe('2026.7.32');
    expect(cargoManifest).toContain('version = "2026.7.32"');
    expect(cargoManifest).toContain('anyhow = "1.0"');
    expect(cargoLock).toContain('name = "local-dictation-sidecar"\nversion = "2026.7.32"');
    expect(cargoLock).toContain('name = "anyhow"\nversion = "1.0.99"');
    expect(versions['2026.7.32']).toBe('1.11.5');
    expect(notes).toContain('Replace this comment with curated release notes');
  });

  it('validates prepared metadata, curated notes, and the exact bare tag', async () => {
    const rootDir = await createReleaseFixture();
    await prepareRelease({ rootDir, version: '2026.7.4' });
    await writeFile(
      join(rootDir, 'docs', 'release', 'notes', '2026.7.4.md'),
      '## Highlights\n\n- **Ready.** Release notes are curated.\n',
    );

    await expect(checkRelease({ rootDir, tag: '2026.7.4' })).resolves.toMatchObject({
      notesPath: join(rootDir, 'docs', 'release', 'notes', '2026.7.4.md'),
      version: '2026.7.4',
    });
  });

  it('refuses to mask inconsistent current metadata before writing', async () => {
    const rootDir = await createReleaseFixture();
    const packageLockPath = join(rootDir, 'package-lock.json');
    const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'));
    packageLock.packages[''].version = '2026.7.2';
    await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);

    await expect(prepareRelease({ rootDir, version: '2026.7.4' })).rejects.toThrow(
      /package-lock\.json packages\[""\]=2026\.7\.2/,
    );

    const manifest = JSON.parse(await readFile(join(rootDir, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe('2026.7.3');
  });

  it('keeps the existing tag validator compatible with unbounded micro versions', async () => {
    const rootDir = await createReleaseFixture();
    await prepareRelease({ rootDir, version: '2026.7.32' });
    await writeFile(
      join(rootDir, 'docs', 'release', 'notes', '2026.7.32.md'),
      '## Fixes\n\n- **Ready.** Curated notes.\n',
    );

    const output = execFileSync(
      process.execPath,
      [join(process.cwd(), 'scripts', 'read-release-version.mjs'), '--tag', '2026.7.32'],
      { cwd: rootDir, encoding: 'utf8' },
    );

    expect(output).toBe('2026.7.32');
  });

  it('rejects a comments-only release-notes scaffold through the existing validator', async () => {
    const rootDir = await createReleaseFixture();
    await prepareRelease({ rootDir, version: '2026.7.4' });

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts', 'validate-release-notes.mjs'), '--version', '2026.7.4'],
      { cwd: rootDir, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('contains no curated content');
  });

  it.each([
    '2026.7.3',
    '2026.7.2',
    '2026.07.4',
    '2026.7.0',
  ])('rejects invalid or non-monotonic target version %s', async (version) => {
    const rootDir = await createReleaseFixture();

    await expect(prepareRelease({ rootDir, version })).rejects.toThrow();

    const manifest = JSON.parse(await readFile(join(rootDir, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe('2026.7.3');
  });

  it('updates the minimum app version only when explicitly requested', async () => {
    const rootDir = await createReleaseFixture();

    await prepareRelease({
      minAppVersion: '1.12.0',
      rootDir,
      version: '2026.8.1',
    });

    const manifest = JSON.parse(await readFile(join(rootDir, 'manifest.json'), 'utf8'));
    const versions = JSON.parse(await readFile(join(rootDir, 'versions.json'), 'utf8'));
    expect(manifest.minAppVersion).toBe('1.12.0');
    expect(versions['2026.8.1']).toBe('1.12.0');
  });

  it('never overwrites an existing release-notes file', async () => {
    const rootDir = await createReleaseFixture();
    const notesPath = join(rootDir, 'docs', 'release', 'notes', '2026.7.4.md');
    await writeFile(notesPath, 'handwritten notes\n');

    await expect(prepareRelease({ rootDir, version: '2026.7.4' })).rejects.toThrow(
      /Release notes already exist/,
    );

    expect(await readFile(notesPath, 'utf8')).toBe('handwritten notes\n');
  });

  it.each([
    [
      'package.json',
      async (rootDir: string) => {
        const path = join(rootDir, 'package.json');
        const value = JSON.parse(await readFile(path, 'utf8'));
        value.version = '2026.7.2';
        await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
      },
    ],
    [
      'package-lock.json top-level',
      async (rootDir: string) => {
        const path = join(rootDir, 'package-lock.json');
        const value = JSON.parse(await readFile(path, 'utf8'));
        value.version = '2026.7.2';
        await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
      },
    ],
    [
      'native/Cargo.toml',
      async (rootDir: string) => {
        const path = join(rootDir, 'native', 'Cargo.toml');
        const value = await readFile(path, 'utf8');
        await writeFile(path, value.replace('2026.7.3', '2026.7.2'));
      },
    ],
    [
      'native/Cargo.lock',
      async (rootDir: string) => {
        const path = join(rootDir, 'native', 'Cargo.lock');
        const value = await readFile(path, 'utf8');
        await writeFile(path, value.replace('2026.7.3', '2026.7.2'));
      },
    ],
  ])('detects a version mismatch in %s', async (_label, introduceMismatch) => {
    const rootDir = await createReleaseFixture();
    await introduceMismatch(rootDir);

    await expect(checkRelease({ rootDir })).rejects.toThrow(/Release versions must match/);
  });

  it('requires the current versions.json mapping and minimum app version to agree', async () => {
    const rootDir = await createReleaseFixture();
    const versionsPath = join(rootDir, 'versions.json');
    const versions = JSON.parse(await readFile(versionsPath, 'utf8'));
    versions['2026.7.3'] = '1.11.4';
    await writeFile(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);

    await expect(checkRelease({ rootDir })).rejects.toThrow(
      /must map 2026\.7\.3 to manifest minAppVersion 1\.11\.5/,
    );
  });

  it('requires the manifest version to be the newest versions.json entry', async () => {
    const rootDir = await createReleaseFixture();
    const versionsPath = join(rootDir, 'versions.json');
    const versions = JSON.parse(await readFile(versionsPath, 'utf8'));
    versions['2026.7.4'] = '1.11.5';
    await writeFile(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);

    await expect(checkRelease({ rootDir })).rejects.toThrow(
      /must be the newest versions\.json entry/,
    );
  });

  it('updates Rust metadata from a Windows checkout without changing line endings', async () => {
    const rootDir = await createReleaseFixture();
    const cargoPaths = [
      join(rootDir, 'native', 'Cargo.toml'),
      join(rootDir, 'native', 'Cargo.lock'),
    ];
    for (const path of cargoPaths) {
      const contents = await readFile(path, 'utf8');
      await writeFile(path, contents.replaceAll('\n', '\r\n'));
    }

    await prepareRelease({ rootDir, version: '2026.7.4' });

    for (const path of cargoPaths) {
      const contents = await readFile(path, 'utf8');
      expect(contents).toContain('version = "2026.7.4"\r\n');
      expect(contents.replaceAll('\r\n', '')).not.toContain('\n');
    }
  });

  it('refuses CLI preparation when tracked worktree changes are present', async () => {
    const rootDir = await createReleaseFixture();
    execFileSync('git', ['init'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.email', 'release-test@example.com'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: rootDir });
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: rootDir });
    await writeFile(
      join(rootDir, 'manifest.json'),
      `${await readFile(join(rootDir, 'manifest.json'))}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts', 'prepare-release.mjs'), '--version', '2026.7.4'],
      { cwd: rootDir, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('requires a clean tracked worktree');
  });
});
