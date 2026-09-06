#!/usr/bin/env node
// Stage and archive a release sidecar build. Replaces the duplicated bash and
// pwsh "Package release archive" steps in .github/workflows/release.yml so the
// per-OS jobs only differ in build setup, not in packaging logic.
//
// Required env: ARCHIVE_NAME, ASSET_NAME, BINARY_PATH
// Optional env: CUDA=true to copy whisper.cpp CUDA runtime libraries alongside

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { listCudaArtifacts } from './lib/cuda-artifacts.mjs';
import { ensureFunasrSidecarArtifacts } from './lib/funasr-runtime.mjs';
import { stageSidecarBaseFiles } from './lib/package-sidecar-base-files.mjs';
import { pickFirstExistingDir } from './lib/pick-existing-dir.mjs';
import { requiredEnv } from './lib/required-env.mjs';

const archiveName = requiredEnv('ARCHIVE_NAME');
const assetName = requiredEnv('ASSET_NAME');
const binaryPath = requiredEnv('BINARY_PATH');
const isCuda = process.env.CUDA === 'true';

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

const platformKey = isWindows ? 'win32' : 'linux';
const binaryName = isWindows ? 'local-dictation-sidecar.exe' : 'local-dictation-sidecar';
const helperName = isWindows
  ? 'local-dictation-translation-helper.exe'
  : 'local-dictation-translation-helper';
const helperPath = join(dirname(binaryPath), helperName);
const funasrRuntimePaths = await ensureFunasrSidecarArtifacts({
  destinationDirectory: dirname(binaryPath),
  download: true,
});
const distDir = 'dist';
const artifactDir = join(distDir, assetName);

await stageSidecarBaseFiles({
  artifactDirectory: artifactDir,
  binaryName,
  binaryPath,
  extraFilePaths: funasrRuntimePaths,
  helperName,
  helperPath,
});

if (isCuda) {
  // CUDA runtime libs aren't provided by the user's system in a
  // version-compatible form (cudart is major-versioned and not
  // forward-compatible), so ship them next to the binary. On Linux the lib
  // dir is derived from nvcc's location, on Windows it lives under CUDA_PATH.
  const runtimeFiles = await listCudaArtifacts(platformKey);
  // CUDA 13 may relocate the Windows runtime DLLs from %CUDA_PATH%\bin to
  // %CUDA_PATH%\bin\x64 (unconfirmed in NVIDIA docs), so try x64 first and fall
  // back to the historical location. Linux derives its lib dir from nvcc.
  const runtimeSourceDir = isWindows
    ? pickFirstExistingDir(
        [join(requiredEnv('CUDA_PATH'), 'bin', 'x64'), join(requiredEnv('CUDA_PATH'), 'bin')],
        existsSync,
      )
    : linuxCudaLibDir();

  for (const runtimeFile of runtimeFiles) {
    const src = join(runtimeSourceDir, runtimeFile);
    const dest = join(artifactDir, runtimeFile);
    if (isLinux) {
      // Dereference symlinks (cudart, cublas etc. are usually shipped as
      // libfoo.so.MAJOR -> libfoo.so.MAJOR.MINOR.PATCH).
      await copyFile(await realpath(src), dest);
    } else {
      await copyFile(src, dest);
    }
  }
}

if (isLinux) {
  // Linux-only: strip the sidecar ELF. The Rust release profile strips
  // Rust-owned symbols, but bundled C++/CUDA objects (ggml, whisper.cpp,
  // CUDA kernels) can still carry debug sections. macOS binaries are ad-hoc
  // codesigned earlier in the workflow; do not strip them (both signature
  // and `strip` semantics differ).
  runStrip(join(artifactDir, binaryName));
  runStrip(join(artifactDir, helperName));
}

await createArchive(artifactDir, join(distDir, archiveName));

console.log(`Packaged ${archiveName} from ${artifactDir}`);

function linuxCudaLibDir() {
  const which = spawnSync('which', ['nvcc'], { encoding: 'utf8' });
  if (which.status !== 0 || which.stdout.trim().length === 0) {
    throw new Error('Could not locate nvcc on PATH for CUDA runtime lib lookup.');
  }
  const cudaRoot = dirname(dirname(which.stdout.trim()));
  const machine = spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout.trim() || 'x86_64';
  return join(cudaRoot, 'targets', `${machine}-linux`, 'lib');
}

function runStrip(path) {
  const result = spawnSync('strip', ['--strip-unneeded', path], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`strip --strip-unneeded ${path} failed with exit code ${result.status}.`);
  }
}

async function createArchive(sourceDir, archivePath) {
  if (!archivePath.endsWith('.tar.gz')) {
    throw new Error(`Unsupported archive extension for ${archivePath}.`);
  }
  // Windows 10+ ships bsdtar as tar.exe, so this works on every runner.
  runOrThrow('tar', ['-czf', archivePath, '-C', sourceDir, '.']);
}

function runOrThrow(command, args, cwd) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...(cwd !== undefined ? { cwd } : {}),
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}
