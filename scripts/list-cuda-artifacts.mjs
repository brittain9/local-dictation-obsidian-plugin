#!/usr/bin/env node
// Print the whisper.cpp CUDA runtime filenames from native/cuda-artifacts.json
// for one platform, one per line. Consumed by build scripts because shells
// cannot import ESM directly; Node consumers should import listCudaArtifacts
// from ./lib/cuda-artifacts.mjs instead.
//
// Usage: node scripts/list-cuda-artifacts.mjs <linux|win32>

import process from 'node:process';

import { listCudaArtifacts } from './lib/cuda-artifacts.mjs';

const [platform] = process.argv.slice(2);

if (!platform) {
  console.error('Usage: node scripts/list-cuda-artifacts.mjs <linux|win32>');
  process.exit(2);
}

try {
  const files = await listCudaArtifacts(platform);
  for (const name of files) {
    console.log(name);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
