#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compareCalverVersions, parseCalver } from './lib/calver.mjs';
import {
  buildReleaseMetadataWrites,
  readReleaseMetadata,
  validateReleaseMetadata,
} from './lib/release-metadata.mjs';

const NOTES_COMMENT = `<!-- Replace this comment with curated release notes.
See docs/release/cutting-a-release.md for section order and style. -->
`;

export async function prepareRelease(options) {
  const rootDir = resolve(options.rootDir ?? '.');
  parseCalver(options.version, 'release version');
  const metadata = await readReleaseMetadata(rootDir);
  const { minAppVersion: currentMinAppVersion, version: currentVersion } =
    validateReleaseMetadata(metadata);
  if (compareCalverVersions(options.version, currentVersion) <= 0) {
    throw new Error(
      `Release version ${options.version} must be newer than current version ${currentVersion}.`,
    );
  }

  const minAppVersion = options.minAppVersion ?? currentMinAppVersion;
  if (!/^\d+\.\d+\.\d+$/.test(minAppVersion)) {
    throw new Error(`Minimum Obsidian version "${minAppVersion}" must use X.Y.Z format.`);
  }

  const notesPath = join(rootDir, 'docs', 'release', 'notes', `${options.version}.md`);
  await assertFileMissing(notesPath);
  const writes = buildReleaseMetadataWrites(metadata, {
    minAppVersion,
    version: options.version,
  });

  await mkdir(dirname(notesPath), { recursive: true });
  await Promise.all([
    ...[...writes].map(([path, contents]) => writeFile(path, contents)),
    writeFile(notesPath, NOTES_COMMENT, { flag: 'wx' }),
  ]);

  return { minAppVersion, notesPath, version: options.version };
}

async function assertFileMissing(path) {
  try {
    await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Release notes already exist: ${path}`);
}

function parseArgs(argv) {
  const options = { minAppVersion: undefined, version: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--version' || arg === '--min-app-version') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      if (arg === '--version') options.version = value;
      else options.minAppVersion = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.version === null) throw new Error('--version is required.');
  return options;
}

function assertCleanWorktree(rootDir) {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (status.trim().length > 0) {
    throw new Error('Release preparation requires a clean tracked worktree.');
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isDirectInvocation) {
  const rootDir = resolve('.');
  const options = parseArgs(process.argv.slice(2));
  assertCleanWorktree(rootDir);
  const result = await prepareRelease({ ...options, rootDir });
  console.log(`Prepared release ${result.version}.`);
  console.log(`Edit ${result.notesPath}, then run npm run check:release.`);
}
