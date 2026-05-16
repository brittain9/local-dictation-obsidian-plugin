#!/usr/bin/env node
// Fail the release before publish if the per-version release notes file is
// missing or empty. Each plugin release MUST ship with curated notes; an
// empty release body is a recurring trigger for Obsidian's plugin review
// recommendations and the only enforcement that survives a hurried tag push
// is a CI gate.
//
// CLI: node scripts/validate-release-notes.mjs --version <YYYY.M.D>
// Writes the resolved notes file path to stdout on success so callers can
// pipe it into a GITHUB_OUTPUT.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const RELEASE_NOTES_DIR = join('docs', 'release-notes');

const version = readFlagValue('--version');

if (version === null) {
  throw new Error('--version is required');
}

const notesPath = join(RELEASE_NOTES_DIR, `${version}.md`);

let body;
try {
  body = await readFile(notesPath, 'utf8');
} catch (error) {
  if (error?.code === 'ENOENT') {
    throw new Error(
      `Release notes file not found: ${notesPath}. Add curated notes for ${version} before tagging.`,
    );
  }
  throw error;
}

if (body.trim().length === 0) {
  throw new Error(
    `Release notes file ${notesPath} is empty. Add curated notes for ${version} before tagging.`,
  );
}

process.stdout.write(notesPath);

function readFlagValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex < 0) return null;
  const flagValue = process.argv[flagIndex + 1];
  if (flagValue === undefined) {
    throw new Error(`${flagName} requires a value.`);
  }
  return flagValue;
}
