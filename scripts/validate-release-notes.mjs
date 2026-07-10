#!/usr/bin/env node

import { join } from 'node:path';

import { validateReleaseNotes } from './check-release.mjs';
import { parseCalver } from './lib/calver.mjs';

const version = readFlagValue('--version');
if (version === null) throw new Error('--version is required.');
parseCalver(version, 'release-notes version');

const notesPath = join('docs', 'release', 'notes', `${version}.md`);
await validateReleaseNotes(notesPath);
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
