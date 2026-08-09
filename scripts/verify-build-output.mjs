import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { listCudaArtifacts } from './lib/cuda-artifacts.mjs';

const SIDECAR_BINARY_SUFFIX = process.platform === 'win32' ? '.exe' : '';

const MAIN_BUNDLE_PATH = 'main.js';
const CUDA_RUNTIME_FILENAMES =
  process.platform === 'linux' || process.platform === 'win32'
    ? await listCudaArtifacts(process.platform)
    : [];

export async function verifyFrontendBuildOutput(options = {}) {
  const rootDir = resolve(options.rootDir ?? '.');
  const mainBundlePath = join(rootDir, MAIN_BUNDLE_PATH);
  const mainBundle = await readFile(mainBundlePath, 'utf8');

  if (/\bimport\((['"])node:/.test(mainBundle)) {
    throw new Error(
      `Build output regression: ${MAIN_BUNDLE_PATH} still contains a dynamic node: import.`,
    );
  }

  if (mainBundle.includes('pcm-recorder.worklet.js')) {
    throw new Error(
      `Build output regression: ${MAIN_BUNDLE_PATH} still references an external recorder worklet asset.`,
    );
  }

  // Use the AudioWorklet's registered name as the canary: it's a string
  // literal that survives minification, unlike the class symbol.
  if (!mainBundle.includes('obsidian-local-stt-pcm-recorder')) {
    throw new Error(
      `Build output regression: ${MAIN_BUNDLE_PATH} is missing the inlined recorder worklet source (registerProcessor name marker).`,
    );
  }
}

export async function verifySidecarBuildOutput(options = {}) {
  const profile = options.profile ?? 'debug';
  const rootDir = resolve(options.rootDir ?? '.');
  const sidecarBinaryPath = join(
    rootDir,
    `native/target/${profile}/local-dictation-sidecar${SIDECAR_BINARY_SUFFIX}`,
  );
  await access(sidecarBinaryPath);

  return await verifyOptionalCudaBuild(rootDir, profile);
}

async function verifyOptionalCudaBuild(rootDir, profile) {
  const cudaSidecarBinaryPath = join(
    rootDir,
    `native/target-cuda/${profile}/local-dictation-sidecar${SIDECAR_BINARY_SUFFIX}`,
  );
  try {
    await access(cudaSidecarBinaryPath);
  } catch {
    return false;
  }

  for (const runtimeFilename of CUDA_RUNTIME_FILENAMES) {
    await access(join(rootDir, 'native', 'target-cuda', profile, runtimeFilename));
  }

  return true;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const profile = args.has('--release') ? 'release' : 'debug';
  await verifyFrontendBuildOutput();

  if (args.has('--frontend-only')) {
    console.log('[verify-build-output] main bundle and inlined recorder worklet look valid');
    return;
  }

  const cudaBuildVerified = await verifySidecarBuildOutput({ profile });
  console.log(
    `[verify-build-output] ${profile} profile: main bundle, inlined recorder worklet, sidecar executable, and ${cudaBuildVerified ? 'CUDA runtime artifacts' : 'optional CUDA build path'} look valid`,
  );
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
