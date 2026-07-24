#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseCalver } from './lib/calver.mjs';
import { readReleaseMetadata, validateReleaseMetadata } from './lib/release-metadata.mjs';

export async function checkRelease(options = {}) {
  const rootDir = resolve(options.rootDir ?? '.');
  const metadata = await readReleaseMetadata(rootDir);
  const { includesSidecar, minAppVersion, sidecarVersion, version } =
    validateReleaseMetadata(metadata);

  if (options.tag !== undefined) {
    parseCalver(options.tag, 'release tag');
    if (options.tag !== version) {
      throw new Error(
        `Release tag ${options.tag} must match manifest.json version ${version} exactly.`,
      );
    }
  }

  const notesPath = join(rootDir, 'docs', 'release', 'notes', `${version}.md`);
  await validateReleaseNotes(notesPath);

  return { includesSidecar, minAppVersion, notesPath, sidecarVersion, version };
}

export async function validateReleaseNotes(notesPath) {
  let body;
  try {
    body = await readFile(notesPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Release notes file not found: ${notesPath}.`);
    }
    throw error;
  }

  if (!hasNonCommentContent(body)) {
    throw new Error(`Release notes file ${notesPath} contains no curated content.`);
  }
}

function hasNonCommentContent(body) {
  let cursor = 0;
  while (cursor < body.length) {
    const commentStart = body.indexOf('<!--', cursor);
    if (commentStart < 0) return body.slice(cursor).trim().length > 0;
    if (body.slice(cursor, commentStart).trim().length > 0) return true;

    const commentEnd = body.indexOf('-->', commentStart + '<!--'.length);
    if (commentEnd < 0) return false;
    cursor = commentEnd + '-->'.length;
  }
  return false;
}

function parseArgs(argv) {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === '--tag' && argv[1] !== undefined) {
    return { tag: argv[1] };
  }
  throw new Error('Usage: node scripts/check-release.mjs [--tag <YYYY.M.MICRO>]');
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isDirectInvocation) {
  const rootDir = resolve('.');
  const result = await checkRelease({ ...parseArgs(process.argv.slice(2)), rootDir });
  console.log(
    `Release ${result.version} metadata and ${relative(rootDir, result.notesPath)} are valid; ${
      result.includesSidecar
        ? `publishing sidecar ${result.sidecarVersion}`
        : `reusing sidecar ${result.sidecarVersion}`
    }.`,
  );
}
