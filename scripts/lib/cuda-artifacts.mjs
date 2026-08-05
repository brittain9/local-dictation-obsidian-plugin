// Single source of truth for the CUDA runtime libraries used by whisper.cpp.
// The release workflow, build scripts, dev installer, and build-output verifier
// all read this manifest so production packages contain only proven runtime
// dependencies.

import { readFile } from 'node:fs/promises';

export const CUDA_ARTIFACTS_PATH = 'native/cuda-artifacts.json';

const VALID_PLATFORMS = new Set(['linux', 'win32']);

export async function loadCudaArtifacts(path = CUDA_ARTIFACTS_PATH) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function listCudaArtifacts(platform, path = CUDA_ARTIFACTS_PATH) {
  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(
      `Invalid platform '${platform}'. Expected one of: ${[...VALID_PLATFORMS].join(', ')}.`,
    );
  }

  const manifest = await loadCudaArtifacts(path);
  const files = manifest[platform];

  if (!Array.isArray(files)) {
    throw new Error(`${path} has no ${platform} entry.`);
  }

  return files;
}
