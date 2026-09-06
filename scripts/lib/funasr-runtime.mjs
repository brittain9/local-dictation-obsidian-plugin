import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export const FUNASR_SENSEVOICE_HELPER = 'llama-funasr-sensevoice';
export const FUNASR_NANO_HELPER = 'llama-funasr-cli';
export const FUNASR_AUDIO_CPP_HELPER = 'audiocpp_cli';
export const FUNASR_SIDECAR_RUNTIME_ARTIFACTS = [
  FUNASR_SENSEVOICE_HELPER,
  FUNASR_NANO_HELPER,
  FUNASR_AUDIO_CPP_HELPER,
  'libsherpa-onnx-c-api.so',
  'libonnxruntime.so',
];

const LINUX_X64_VULKAN_ARCHIVE = 'funasr-llamacpp-linux-x64-vulkan.tar.gz';
const LINUX_X64_VULKAN_ARCHIVE_SHA256 =
  'f02d41e98e9d4041f0896661007193810f025484d2175958f7c1313d5c90ec46';
const LINUX_X64_HELPER_SHA256 = 'b81ec690c8a17f8a4eb590a6e1bd47252a4ae66ebfd301f3cf3718353921f924';
const LINUX_X64_VULKAN_ARCHIVE_URL =
  'https://github.com/modelscope/FunASR/releases/download/v1.4.14/funasr-llamacpp-linux-x64-vulkan.tar.gz';
const LINUX_X64_AVX2_ARCHIVE = 'funasr-llamacpp-linux-x64-avx2.tar.gz';
const LINUX_X64_AVX2_ARCHIVE_SHA256 =
  'aaebc5470f846ce915200b35d6e9f9bd0a0d3ed399d39e49bdeb7a1f1782bc70';
const LINUX_X64_NANO_HELPER_SHA256 =
  '75b3c4e3988014f0d72fee18d7a118f78f8a6df68f49a0a566952a42cf5f43fc';
const LINUX_X64_AVX2_ARCHIVE_URL =
  'https://github.com/modelscope/FunASR/releases/download/v1.4.14/funasr-llamacpp-linux-x64-avx2.tar.gz';
const AUDIO_CPP_VULKAN_ARCHIVE = 'audio-v0.7.2-bin-ubuntu-x64-vulkan.tar.gz';
const AUDIO_CPP_VULKAN_ARCHIVE_SHA256 =
  'fee1f978cee76453cf17f00196554bc2ee294645739538af0726a143b6a69a23';
const AUDIO_CPP_HELPER_SHA256 = '706c268085d0d05532ee1699d7a2df6d3a6a5d74e58d4072a7b0cee513113e88';
const AUDIO_CPP_VULKAN_ARCHIVE_URL =
  'https://github.com/0xShug0/audio.cpp/releases/download/v0.7.2/audio-v0.7.2-bin-ubuntu-x64-vulkan.tar.gz';

/**
 * Download and verify FunASR's official Linux Vulkan helper, then place its
 * self-contained executable beside a sidecar build. The helper depends only
 * on the system Vulkan loader and uses `--backend cpu` when acceleration is
 * disabled or unavailable.
 */
export async function ensureFunasrSenseVoiceRuntime({ destinationDirectory, download = false }) {
  if (process.platform !== 'linux' || process.arch !== 'x64') return null;

  const destination = join(destinationDirectory, FUNASR_SENSEVOICE_HELPER);
  if (await hasSha256(destination, LINUX_X64_HELPER_SHA256)) return destination;
  if (!download) return null;

  const cacheDirectory = resolve('native', 'target', 'funasr-runtime-cache');
  const archivePath = join(cacheDirectory, LINUX_X64_VULKAN_ARCHIVE);
  await mkdir(cacheDirectory, { recursive: true });

  if (!(await hasSha256(archivePath, LINUX_X64_VULKAN_ARCHIVE_SHA256))) {
    await downloadVerified(
      LINUX_X64_VULKAN_ARCHIVE_URL,
      LINUX_X64_VULKAN_ARCHIVE_SHA256,
      archivePath,
    );
  }

  const stagingDirectory = await mkdtemp(join(tmpdir(), 'speech-kit-funasr-'));
  try {
    const extract = spawnSync('tar', ['-xzf', archivePath, '-C', stagingDirectory], {
      encoding: 'utf8',
    });
    if (extract.status !== 0) {
      throw new Error(
        `Could not extract ${basename(archivePath)}: ${extract.stderr.trim() || `tar exited ${extract.status}`}`,
      );
    }

    const source = join(stagingDirectory, FUNASR_SENSEVOICE_HELPER);
    if (!(await fileExists(source))) {
      throw new Error(`The FunASR runtime archive did not contain ${FUNASR_SENSEVOICE_HELPER}.`);
    }

    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, 0o755);
    if (!(await hasSha256(destination, LINUX_X64_HELPER_SHA256))) {
      throw new Error(`FunASR helper SHA-256 mismatch after staging ${destination}.`);
    }
    return destination;
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
}

export async function ensureFunasrNanoRuntime({ destinationDirectory, download = false }) {
  if (process.platform !== 'linux' || process.arch !== 'x64') return null;

  const destination = join(destinationDirectory, FUNASR_NANO_HELPER);
  if (!download) {
    if (await hasSha256(destination, LINUX_X64_NANO_HELPER_SHA256)) return destination;
    if (await helperExposesBackend(destination, 'vulkan')) return destination;
    return null;
  }

  const cacheDirectory = resolve('native', 'target', 'funasr-runtime-cache');
  const archivePath = join(cacheDirectory, LINUX_X64_AVX2_ARCHIVE);
  await mkdir(cacheDirectory, { recursive: true });

  // A locally built Vulkan Nano helper takes precedence over the official
  // CPU-only release asset. This keeps the normal download path unchanged
  // while allowing Linux builds to ship a backend-enabled helper produced by
  // `npm run build:funasr-nano-vulkan`.
  const customVulkanHelper = join(cacheDirectory, `${FUNASR_NANO_HELPER}-vulkan`);
  if (await fileExists(customVulkanHelper)) {
    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(customVulkanHelper, destination);
    await chmod(destination, 0o755);
    if (!(await helperExposesBackend(destination, 'vulkan'))) {
      throw new Error(
        `The custom FunASR Nano helper at ${customVulkanHelper} does not expose Vulkan.`,
      );
    }
    return destination;
  }

  if (!(await hasSha256(archivePath, LINUX_X64_AVX2_ARCHIVE_SHA256))) {
    await downloadVerified(LINUX_X64_AVX2_ARCHIVE_URL, LINUX_X64_AVX2_ARCHIVE_SHA256, archivePath);
  }

  const stagingDirectory = await mkdtemp(join(tmpdir(), 'speech-kit-funasr-nano-'));
  try {
    const extract = spawnSync('tar', ['-xzf', archivePath, '-C', stagingDirectory], {
      encoding: 'utf8',
    });
    if (extract.status !== 0) {
      throw new Error(
        `Could not extract ${basename(archivePath)}: ${extract.stderr.trim() || `tar exited ${extract.status}`}`,
      );
    }

    const source = join(stagingDirectory, FUNASR_NANO_HELPER);
    if (!(await fileExists(source))) {
      throw new Error(`The FunASR runtime archive did not contain ${FUNASR_NANO_HELPER}.`);
    }
    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, 0o755);
    if (!(await hasSha256(destination, LINUX_X64_NANO_HELPER_SHA256))) {
      throw new Error(`FunASR Nano helper SHA-256 mismatch after staging ${destination}.`);
    }
    return destination;
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
}

export async function ensureFunasrAudioCppRuntime({ destinationDirectory, download = false }) {
  if (process.platform !== 'linux' || process.arch !== 'x64') return null;

  const destination = join(destinationDirectory, FUNASR_AUDIO_CPP_HELPER);
  if (await hasSha256(destination, AUDIO_CPP_HELPER_SHA256)) return destination;
  if (!download) return null;

  const cacheDirectory = resolve('native', 'target', 'audio-cpp-runtime-cache');
  const archivePath = join(cacheDirectory, AUDIO_CPP_VULKAN_ARCHIVE);
  await mkdir(cacheDirectory, { recursive: true });
  if (!(await hasSha256(archivePath, AUDIO_CPP_VULKAN_ARCHIVE_SHA256))) {
    await downloadVerified(
      AUDIO_CPP_VULKAN_ARCHIVE_URL,
      AUDIO_CPP_VULKAN_ARCHIVE_SHA256,
      archivePath,
    );
  }

  const stagingDirectory = await mkdtemp(join(tmpdir(), 'speech-kit-audio-cpp-'));
  try {
    const extract = spawnSync(
      'tar',
      ['-xzf', archivePath, '-C', stagingDirectory, `./${FUNASR_AUDIO_CPP_HELPER}`],
      { encoding: 'utf8' },
    );
    if (extract.status !== 0) {
      throw new Error(
        `Could not extract ${basename(archivePath)}: ${extract.stderr.trim() || `tar exited ${extract.status}`}`,
      );
    }
    const source = join(stagingDirectory, FUNASR_AUDIO_CPP_HELPER);
    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, 0o755);
    if (!(await hasSha256(destination, AUDIO_CPP_HELPER_SHA256))) {
      throw new Error(`audio.cpp helper SHA-256 mismatch after staging ${destination}.`);
    }
    return destination;
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
}

/**
 * Ensure every Linux-only artifact required by the hybrid adapter is beside a
 * sidecar executable. sherpa-onnx places its shared libraries in Cargo's
 * profile output; release packaging must retain them with the executable.
 */
export async function ensureFunasrSidecarArtifacts({ destinationDirectory, download = false }) {
  const helper = await ensureFunasrSenseVoiceRuntime({ destinationDirectory, download });
  const nano = await ensureFunasrNanoRuntime({ destinationDirectory, download });
  const audioCpp = await ensureFunasrAudioCppRuntime({ destinationDirectory, download });
  if (helper === null && nano === null && audioCpp === null) return [];
  if (helper === null || nano === null || audioCpp === null) {
    throw new Error(`Incomplete FunASR runtime in ${destinationDirectory}.`);
  }

  return requireFunasrSidecarArtifacts({ destinationDirectory });
}

export async function requireFunasrSidecarArtifacts({ destinationDirectory }) {
  if (process.platform !== 'linux' || process.arch !== 'x64') return [];

  const paths = FUNASR_SIDECAR_RUNTIME_ARTIFACTS.map((artifact) =>
    join(destinationDirectory, artifact),
  );
  for (const path of paths) {
    if (!(await fileExists(path))) {
      throw new Error(`Missing FunASR sidecar runtime artifact at ${path}.`);
    }
  }
  return paths;
}

async function downloadVerified(url, expectedSha256, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not download FunASR runtime (${response.status} ${response.statusText}).`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `FunASR runtime SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}.`,
    );
  }

  await writeFile(destination, bytes);
}

async function hasSha256(path, expectedSha256) {
  try {
    const bytes = await readFile(path);
    return createHash('sha256').update(bytes).digest('hex') === expectedSha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
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

async function helperExposesBackend(path, backend) {
  if (!(await fileExists(path))) return false;
  const executable = await readFile(path);
  return (
    executable.includes('--backend') &&
    executable.includes('--probe-backend') &&
    executable.includes(backend)
  );
}
