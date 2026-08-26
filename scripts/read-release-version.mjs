#!/usr/bin/env node

import { checkRelease } from './check-release.mjs';

const result = await checkRelease({ tag: readFlagValue('--tag') ?? undefined });
process.stdout.write(result.version);

function readFlagValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex < 0) return null;

  const flagValue = process.argv[flagIndex + 1];
  if (flagValue === undefined) {
    throw new Error(`${flagName} requires a value.`);
  }
  return flagValue;
}
