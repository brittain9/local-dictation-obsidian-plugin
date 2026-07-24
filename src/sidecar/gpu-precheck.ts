import { spawn } from 'node:child_process';

import releaseBuildConfig from '../../.github/release-build-config.json';

const CUDA_TOOLKIT_MINIMUM_DRIVER_MAJOR: Readonly<Record<string, number>> = {
  '13.2.0': 595,
};

export const CUDA_COMPATIBILITY_REQUIREMENTS = {
  minimumComputeCapability: resolveMinimumComputeCapability(releaseBuildConfig.cudaArchitectures),
  minimumDriverMajor: resolveMinimumDriverMajor(releaseBuildConfig.cudaToolkitVersion),
} as const;

export const CUDA_PROBE_OUTPUT_LIMIT_BYTES = 64 * 1024;

const PROBE_TIMEOUT_MS = 3_000;
const NVIDIA_SMI_ARGS = [
  '--query-gpu=driver_version,compute_cap',
  '--format=csv,noheader,nounits',
] as const;
const DRIVER_VERSION_PATTERN = /^\d+(?:\.\d+)*$/u;
const COMPUTE_CAPABILITY_PATTERN = /^(\d+)\.(\d+)$/u;

export type CudaCompatibility =
  | {
      computeCapabilities: readonly string[];
      driverVersion: string;
      status: 'compatible' | 'incompatible_driver' | 'incompatible_gpu';
    }
  | { status: 'absent' | 'unknown' | 'unsupported' };

export interface CudaProbeOutput {
  computeCapabilities: readonly string[];
  driverVersion: string;
}

export function isCudaReleaseTarget(platform: NodeJS.Platform, arch: string): boolean {
  return arch === 'x64' && (platform === 'linux' || platform === 'win32');
}

export function parseCudaProbeOutput(output: string): CudaProbeOutput | null {
  const rows = output.trim().split(/\r?\n/u);
  if (rows.length === 0 || rows[0] === '') return null;

  let driverVersion: string | null = null;
  const computeCapabilities: string[] = [];

  for (const row of rows) {
    const columns = row.split(',');
    if (columns.length !== 2) return null;

    const rowDriverVersion = columns[0]?.trim();
    const computeCapability = columns[1]?.trim();
    if (
      rowDriverVersion === undefined ||
      computeCapability === undefined ||
      !isDriverVersion(rowDriverVersion) ||
      !isComputeCapability(computeCapability)
    ) {
      return null;
    }

    if (driverVersion !== null && driverVersion !== rowDriverVersion) return null;
    driverVersion = rowDriverVersion;
    computeCapabilities.push(computeCapability);
  }

  return driverVersion === null ? null : { computeCapabilities, driverVersion };
}

export function classifyCudaCompatibility(probe: CudaProbeOutput): CudaCompatibility {
  const driverMajor = Number(probe.driverVersion.split('.', 1)[0]);
  if (driverMajor < CUDA_COMPATIBILITY_REQUIREMENTS.minimumDriverMajor) {
    return { ...probe, status: 'incompatible_driver' };
  }

  const allGpusAreCompatible =
    probe.computeCapabilities.length > 0 &&
    probe.computeCapabilities.every((computeCapability) =>
      meetsMinimumComputeCapability(computeCapability),
    );
  return {
    ...probe,
    status: allGpusAreCompatible ? 'compatible' : 'incompatible_gpu',
  };
}

export async function detectCudaCompatibility(): Promise<CudaCompatibility> {
  if (!isCudaReleaseTarget(process.platform, process.arch)) return { status: 'unsupported' };

  return new Promise((resolve) => {
    let closed = false;
    let settled = false;
    let child: ReturnType<typeof spawn> | null = null;
    let exitStatus: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let timeoutHandle: number | null = null;

    const onData = (chunk: Buffer | string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > CUDA_PROBE_OUTPUT_LIMIT_BYTES) {
        stopChild();
        settle({ status: 'unknown' });
        return;
      }
      output += chunk.toString();
    };
    const onError = (error: NodeJS.ErrnoException): void => {
      settle(error.code === 'ENOENT' ? { status: 'absent' } : { status: 'unknown' });
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      exitStatus = { code, signal };
    };
    const onClose = (): void => {
      closed = true;
      if (settled) {
        cleanup();
        return;
      }

      if (exitStatus === null || exitStatus.code !== 0 || exitStatus.signal !== null) {
        settle({ status: 'unknown' });
        return;
      }

      const probe = parseCudaProbeOutput(output);
      settle(probe === null ? { status: 'unknown' } : classifyCudaCompatibility(probe));
    };
    const cleanup = (): void => {
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      child?.stdout?.removeListener('data', onData);
      child?.removeListener('exit', onExit);
      if (closed) {
        child?.removeListener('error', onError);
        child?.removeListener('close', onClose);
      }
    };
    const settle = (result: CudaCompatibility): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const stopChild = (): void => {
      try {
        child?.kill();
      } catch {
        // The result is already inconclusive; killing is best effort only.
      }
    };
    let output = '';
    let outputBytes = 0;

    try {
      child = spawn('nvidia-smi', NVIDIA_SMI_ARGS, {
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      settle({ status: 'unknown' });
      return;
    }

    child.stdout?.on('data', onData);
    // Keep the one-shot error handler through close: a timeout can win while
    // the process is ending, and a late error must not go unhandled.
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('close', onClose);
    timeoutHandle = window.setTimeout(() => {
      stopChild();
      settle({ status: 'unknown' });
    }, PROBE_TIMEOUT_MS);
  });
}

function isComputeCapability(value: string): boolean {
  const match = COMPUTE_CAPABILITY_PATTERN.exec(value);
  return (
    match !== null &&
    Number.isSafeInteger(Number(match[1])) &&
    Number.isSafeInteger(Number(match[2]))
  );
}

function isDriverVersion(value: string): boolean {
  return (
    DRIVER_VERSION_PATTERN.test(value) &&
    value.split('.').every((part) => Number.isSafeInteger(Number(part)))
  );
}

function meetsMinimumComputeCapability(value: string): boolean {
  const match = COMPUTE_CAPABILITY_PATTERN.exec(value);
  if (match === null) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const minimum = CUDA_COMPATIBILITY_REQUIREMENTS.minimumComputeCapability;
  return major > minimum.major || (major === minimum.major && minor >= minimum.minor);
}

function resolveMinimumComputeCapability(cudaArchitectures: string): {
  major: number;
  minor: number;
} {
  const match = /^(\d)(\d)-virtual$/u.exec(cudaArchitectures);
  if (match === null) {
    throw new Error(`Unsupported release CUDA architecture configuration: ${cudaArchitectures}`);
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function resolveMinimumDriverMajor(cudaToolkitVersion: string): number {
  const minimum = CUDA_TOOLKIT_MINIMUM_DRIVER_MAJOR[cudaToolkitVersion];
  if (minimum === undefined) {
    throw new Error(`No minimum NVIDIA driver is defined for CUDA toolkit ${cudaToolkitVersion}`);
  }
  return minimum;
}
