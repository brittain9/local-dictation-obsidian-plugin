#!/usr/bin/env node
// Stage the release directory: copy plugin bundle files into dist/release
// alongside the sidecar archives that were downloaded into the same
// directory, validate the exact set of archives, and emit a deterministic
// checksums.txt. Replaces the inline shell block in release.yml's publish job
// so missing/extra/empty sidecar artifacts fail the release before upload
// instead of silently shipping a partial set.
//
// CLI: node scripts/assemble-release-files.mjs
// Inputs (paths relative to cwd):
//   dist/plugin-bundle/{main.js, manifest.json, styles.css}
//   dist/release/<each EXPECTED_SIDECAR_ARCHIVES file>
// Output:
//   dist/release/{main.js, manifest.json, styles.css, <archives>, checksums.txt}

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
 * Assemble `<rootDir>/dist/release/` with the plugin bundle files alongside
 * the sidecar archives already downloaded into the same directory, then emit
 * a deterministic `checksums.txt`. `rootDir` defaults to the current working
 * directory; tests pass a temp directory.
 *
 * @param {string} rootDir
 */
export async function assembleReleaseFiles(rootDir = '.') {
  const pluginBundleDir = join(rootDir, 'dist', 'plugin-bundle');
  const releaseDir = join(rootDir, 'dist', 'release');

  await mkdir(releaseDir, { recursive: true });

  for (const file of PLUGIN_FILES) {
    await copyFile(join(pluginBundleDir, file), join(releaseDir, file));
  }

  const candidates = await listArchiveCandidates(releaseDir);
  const errors = validateSidecarArchives(candidates);
  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`[assemble-release-files] ${message}`);
    }
    throw new Error('release archive validation failed');
  }

  const archiveContents = new Map();
  for (const expected of EXPECTED_SIDECAR_ARCHIVES) {
    archiveContents.set(expected, await readFile(join(releaseDir, expected)));
  }

  const body = buildChecksumsFile(archiveContents);
  await writeFile(join(releaseDir, 'checksums.txt'), body);

  return { releaseDir };
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '');

if (invokedDirectly) {
  assembleReleaseFiles()
    .then(({ releaseDir }) => {
      console.log(
        `[assemble-release-files] wrote ${PLUGIN_FILES.length} plugin files and checksums for ${EXPECTED_SIDECAR_ARCHIVES.length} sidecar archives to ${releaseDir}`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
