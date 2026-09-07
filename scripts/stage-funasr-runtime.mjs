#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';

import { ensureFunasrSidecarArtifacts } from './lib/funasr-runtime.mjs';

const destinationDirectory = process.argv[2];

if (destinationDirectory === undefined || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/stage-funasr-runtime.mjs <sidecar-output-directory>');
}

const artifacts = await ensureFunasrSidecarArtifacts({
  destinationDirectory: resolve(destinationDirectory),
  download: true,
});

if (artifacts.length > 0) {
  console.log(`Staged FunASR runtime artifacts in ${resolve(destinationDirectory)}`);
}
