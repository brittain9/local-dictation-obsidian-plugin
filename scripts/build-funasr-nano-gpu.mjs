#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const FUNASR_URL = 'https://codeload.github.com/modelscope/FunASR/tar.gz/refs/tags/v1.4.14';
const FUNASR_SHA256 = 'a6baf3a282387b33a976458d2e278510576345eceba683d0b9744377b3823d51';
const LLAMA_URL =
  'https://codeload.github.com/ggml-org/llama.cpp/tar.gz/803b7fcae893e9caaee3921779628fef83ac0965';
const LLAMA_SHA256 = '8fe8528e89d8fca8c8b81696efa83ff82c996bf84d17be65e884c1ceae35351e';
const PATCH_FILE = resolve('scripts', 'patches', 'funasr-nano-vulkan.patch');
const CACHE_DIRECTORY = resolve('native', 'target', 'funasr-runtime-cache');

const backend = process.argv[2];
if (backend !== 'vulkan') {
  throw new Error('Usage: node scripts/build-funasr-nano-gpu.mjs vulkan');
}
if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('Fun-ASR Nano GPU helper builds are currently supported on Linux x64 only.');
}

const output = join(CACHE_DIRECTORY, `llama-funasr-cli-${backend}`);
await mkdir(CACHE_DIRECTORY, { recursive: true });
if (await fileExists(output)) {
  console.log(`Fun-ASR Nano Vulkan helper already exists at ${output}`);
  process.exit(0);
}

const workDirectory = await mkdtemp(join(tmpdir(), `speech-kit-funasr-nano-${backend}-`));
try {
  const funasrArchive = join(workDirectory, 'funasr.tar.gz');
  const llamaArchive = join(workDirectory, 'llama.tar.gz');
  await downloadVerified(FUNASR_URL, FUNASR_SHA256, funasrArchive);
  await downloadVerified(LLAMA_URL, LLAMA_SHA256, llamaArchive);
  await extract(funasrArchive, workDirectory);
  await extract(llamaArchive, workDirectory);

  const funasrRoot = await findDirectory(workDirectory, 'FunASR-');
  const llamaRoot = await findDirectory(workDirectory, 'llama.cpp-');
  const runtimeRoot = join(funasrRoot, 'runtime', 'llama.cpp');
  const patch = spawnSync('patch', ['--batch', '--forward', '-p0', '-i', PATCH_FILE], {
    cwd: runtimeRoot,
    encoding: 'utf8',
  });
  if (patch.status !== 0) {
    throw new Error(
      `Could not patch Fun-ASR Nano source: ${patch.stderr.trim() || patch.stdout.trim()}`,
    );
  }

  const buildDirectory = join(workDirectory, 'build');
  const backendArgs = vulkanCmakeArgs();
  run('cmake', [
    '-S',
    runtimeRoot,
    '-B',
    buildDirectory,
    '-DCMAKE_BUILD_TYPE=Release',
    ...backendArgs,
    '-DLLAMA_BUILD_TESTS=OFF',
    '-DLLAMA_BUILD_EXAMPLES=OFF',
    '-DLLAMA_BUILD_TOOLS=OFF',
    '-DLLAMA_BUILD_SERVER=OFF',
    '-DLLAMA_CURL=OFF',
    `-DFETCHCONTENT_SOURCE_DIR_LLAMA=${llamaRoot}`,
  ]);
  run('cmake', ['--build', buildDirectory, '--target', 'llama-funasr-cli', '--parallel']);

  const built = join(buildDirectory, 'bin', 'llama-funasr-cli');
  if (!(await fileExists(built))) throw new Error(`Build completed without ${built}`);
  await copyFile(built, output);
  await chmod(output, 0o755);
  console.log(`Built Fun-ASR Nano Vulkan helper at ${output}`);
} finally {
  await rm(workDirectory, { force: true, recursive: true });
}

function vulkanCmakeArgs() {
  const args = ['-DGGML_VULKAN=ON'];
  const includeDirectory = process.env.FUNASR_VULKAN_INCLUDE_DIR?.trim();
  if (includeDirectory) args.push(`-DVulkan_INCLUDE_DIR=${includeDirectory}`);
  const spirvHeadersDirectory = process.env.FUNASR_SPIRV_HEADERS_DIR?.trim();
  if (spirvHeadersDirectory) {
    args.push(`-DSPIRV-Headers_DIR=${spirvHeadersDirectory}`);
    args.push(`-DCMAKE_CXX_FLAGS=-I${resolve(spirvHeadersDirectory, '..', '..', '..', 'include')}`);
  }
  return args;
}

async function downloadVerified(url, expectedSha256, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${basename(destination)}: expected ${expectedSha256}, got ${actual}`,
    );
  }
  await writeFile(destination, bytes);
}

async function extract(archive, destination) {
  run('tar', ['-xzf', archive, '-C', destination]);
}

async function findDirectory(root, prefix) {
  const entries = await readdir(root, { withFileTypes: true });
  const entry = entries.find(
    (candidate) => candidate.isDirectory() && candidate.name.startsWith(prefix),
  );
  if (!entry) throw new Error(`Could not find extracted source directory ${prefix}*`);
  return join(root, entry.name);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
