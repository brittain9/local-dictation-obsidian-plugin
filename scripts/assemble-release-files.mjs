#!/usr/bin/env node
// Stage two separate release directories so the publish job can create two
// GitHub Releases from the same workflow run:
//   - dist/release/plugin/   -> Obsidian-facing release tagged <version>,
//                               contains only main.js, manifest.json, styles.css.
//   - dist/release/sidecar/  -> sidecar release tagged sidecar-<version>,
//                               contains the validated sidecar archives plus
//                               a deterministic checksums.txt.
// This split exists because Obsidian's community-plugin review rejects any
// non-standard assets on the release matching `manifest.version`. The two
// directories are produced from the same commit so the version mapping
// remains 1:1.
//
// CLI: node scripts/assemble-release-files.mjs
// Inputs (paths relative to cwd):
//   dist/plugin-bundle/{main.js, manifest.json, styles.css}
//   dist/sidecar-archives/<each EXPECTED_SIDECAR_ARCHIVES file>
// Output:
//   dist/release/plugin/{main.js, manifest.json, styles.css}
//   dist/release/sidecar/{<archives>, checksums.txt}

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

export const EXPECTED_SIDECAR_ARCHIVES = Object.freeze([
  'sidecar-linux-x86_64-cpu.tar.gz',
  'sidecar-linux-x86_64-cuda.tar.gz',
  'sidecar-macos-arm64.tar.gz',
  'sidecar-windows-x86_64-cpu.tar.gz',
  'sidecar-windows-x86_64-cuda.tar.gz',
]);

const PLUGIN_FILES = Object.freeze(['main.js', 'manifest.json', 'styles.css']);

/**
 * Validate that exactly the expected sidecar archives are present in
 * `presentEntries`, with non-empty sizes and no duplicates or strays.
 *
 * @param {Array<{ name: string, size: number }>} presentEntries
 * @returns {string[]} errors (empty when valid)
 */
export function validateSidecarArchives(presentEntries) {
  const errors = [];
  const seen = new Map();
  for (const entry of presentEntries) {
    const previous = seen.get(entry.name);
    if (previous !== undefined) {
      errors.push(`duplicate sidecar archive: ${entry.name}`);
    }
    seen.set(entry.name, entry);
  }

  for (const expected of EXPECTED_SIDECAR_ARCHIVES) {
    const entry = seen.get(expected);
    if (entry === undefined) {
      errors.push(`missing sidecar archive: ${expected}`);
      continue;
    }
    if (entry.size <= 0) {
      errors.push(`empty sidecar archive: ${expected}`);
    }
  }

  const expectedSet = new Set(EXPECTED_SIDECAR_ARCHIVES);
  for (const entry of presentEntries) {
    if (!expectedSet.has(entry.name)) {
      errors.push(`unexpected sidecar archive: ${entry.name}`);
    }
  }

  return errors;
}

/**
 * Build a deterministic, sorted `sha256sum`-compatible checksum file body
 * from a map of archive-name -> Buffer. The archive set must equal
 * EXPECTED_SIDECAR_ARCHIVES exactly.
 *
 * @param {Map<string, Buffer>} archiveContents
 * @returns {string}
 */
export function buildChecksumsFile(archiveContents) {
  if (archiveContents.size === 0) {
    throw new Error(
      'refusing to emit checksums.txt with no archives — would otherwise produce the SHA-256 of stdin',
    );
  }

  const expectedSet = new Set(EXPECTED_SIDECAR_ARCHIVES);
  for (const name of archiveContents.keys()) {
    if (!expectedSet.has(name)) {
      throw new Error(`refusing to checksum unexpected archive: ${name}`);
    }
  }
  for (const expected of EXPECTED_SIDECAR_ARCHIVES) {
    if (!archiveContents.has(expected)) {
      throw new Error(`refusing to checksum without expected archive: ${expected}`);
    }
  }

  const lines = [...EXPECTED_SIDECAR_ARCHIVES].sort().map((name) => {
    const data = archiveContents.get(name);
    if (data === undefined) {
      throw new Error(`internal: archive ${name} not in contents map`);
    }
    const digest = createHash('sha256').update(data).digest('hex');
    return `${digest}  ${name}`;
  });

  if (lines.length !== EXPECTED_SIDECAR_ARCHIVES.length) {
    throw new Error(
      `internal: expected ${EXPECTED_SIDECAR_ARCHIVES.length} checksum lines, produced ${lines.length}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

async function listArchiveCandidates(releaseDir) {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    if (!name.endsWith('.tar.gz')) {
      continue;
    }
    const fullPath = join(releaseDir, name);
    const info = await stat(fullPath);
    candidates.push({ name, size: info.size });
  }
  return candidates;
}

/**
 * Assemble the partitioned release directories under `<rootDir>/dist/release/`.
 * `rootDir` defaults to the current working directory so the script behaves
 * the same way under CI; tests pass a temp directory to exercise the layout.
 *
 * @param {string} rootDir
 */
export async function assembleReleaseFiles(rootDir = '.') {
  const pluginBundleDir = join(rootDir, 'dist', 'plugin-bundle');
  const sidecarArchivesDir = join(rootDir, 'dist', 'sidecar-archives');
  const pluginReleaseDir = join(rootDir, 'dist', 'release', 'plugin');
  const sidecarReleaseDir = join(rootDir, 'dist', 'release', 'sidecar');

  await mkdir(pluginReleaseDir, { recursive: true });
  await mkdir(sidecarReleaseDir, { recursive: true });

  for (const file of PLUGIN_FILES) {
    await copyFile(join(pluginBundleDir, file), join(pluginReleaseDir, file));
  }

  const candidates = await listArchiveCandidates(sidecarArchivesDir);
  const errors = validateSidecarArchives(candidates);
  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`[assemble-release-files] ${message}`);
    }
    throw new Error('release archive validation failed');
  }

  const archiveContents = new Map();
  for (const expected of EXPECTED_SIDECAR_ARCHIVES) {
    const archive = await readFile(join(sidecarArchivesDir, expected));
    archiveContents.set(expected, archive);
    await copyFile(join(sidecarArchivesDir, expected), join(sidecarReleaseDir, expected));
  }

  const body = buildChecksumsFile(archiveContents);
  await writeFile(join(sidecarReleaseDir, 'checksums.txt'), body);

  return { pluginReleaseDir, sidecarReleaseDir };
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '');

if (invokedDirectly) {
  assembleReleaseFiles()
    .then(({ pluginReleaseDir, sidecarReleaseDir }) => {
      console.log(
        `[assemble-release-files] wrote ${PLUGIN_FILES.length} plugin files to ${pluginReleaseDir} and ${EXPECTED_SIDECAR_ARCHIVES.length} sidecar archives + checksums to ${sidecarReleaseDir}`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
