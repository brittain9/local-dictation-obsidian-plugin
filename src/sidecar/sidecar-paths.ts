import { join } from 'node:path';

import { assertAbsoluteExistingFilePath, getExistingPathKind } from '../filesystem/path-validation';
import type { CudaSidecarLaunchPolicy } from './cuda-compatibility';
import type { AccelerationPreference } from './protocol';
import { variantDirectoryPath } from './sidecar-installer';

export class SidecarNotInstalledError extends Error {
  override readonly name = 'SidecarNotInstalledError';
}

export type SidecarVariant = 'cpu' | 'cuda';

export type SidecarResolutionSource = 'override' | 'installed' | 'dev';

export interface ResolvedSidecarExecutable {
  path: string;
  source: SidecarResolutionSource;
  variant: SidecarVariant | null;
}

export interface ResolveSidecarExecutablePathOptions {
  accelerationPreference: AccelerationPreference;
  /** Whether CUDA is preferred, an inconclusive last resort, or unavailable. */
  cudaLaunchPolicy: CudaSidecarLaunchPolicy;
  executableName: string;
  pluginDirectory: string;
  sidecarPathOverride: string;
  sidecarProjectDirectory: string;
  /** This platform ships a CUDA build at all, so `bin/cuda` is a candidate. */
  supportsCuda: boolean;
}

export async function resolveSidecarExecutablePath(
  options: ResolveSidecarExecutablePathOptions,
): Promise<ResolvedSidecarExecutable> {
  const overridePath = options.sidecarPathOverride.trim();

  if (overridePath.length > 0) {
    const resolvedOverride = await assertAbsoluteExistingFilePath(
      overridePath,
      'Sidecar path override',
    );
    return { path: resolvedOverride, source: 'override', variant: null };
  }

  const installedCpuPath = join(
    variantDirectoryPath(options.pluginDirectory, 'cpu'),
    options.executableName,
  );
  const installedCudaPath = join(
    variantDirectoryPath(options.pluginDirectory, 'cuda'),
    options.executableName,
  );

  const installed = await pickExistingVariant({
    accelerationPreference: options.accelerationPreference,
    cudaLaunchPolicy: options.cudaLaunchPolicy,
    supportsCuda: options.supportsCuda,
    cpuPath: installedCpuPath,
    cudaPath: installedCudaPath,
  });

  if (installed !== null) {
    return { path: installed.path, source: 'installed', variant: installed.variant };
  }

  const devCpuPath = join(
    options.sidecarProjectDirectory,
    'target',
    'debug',
    options.executableName,
  );
  const devCudaPath = options.supportsCuda
    ? join(options.sidecarProjectDirectory, 'target-cuda', 'debug', options.executableName)
    : null;

  const dev = await pickExistingVariant({
    accelerationPreference: options.accelerationPreference,
    cudaLaunchPolicy: options.cudaLaunchPolicy,
    supportsCuda: options.supportsCuda,
    cpuPath: devCpuPath,
    cudaPath: devCudaPath,
  });

  if (dev !== null) {
    return { path: dev.path, source: 'dev', variant: dev.variant };
  }

  const searchedDevPaths = devCudaPath !== null ? [devCudaPath, devCpuPath] : [devCpuPath];
  throw new SidecarNotInstalledError(
    `Sidecar executable was not found in ${installedCpuPath} or ${searchedDevPaths.join(', ')}. Install the sidecar, build native first, or configure Sidecar path override.`,
  );
}

interface PickExistingVariantOptions {
  accelerationPreference: AccelerationPreference;
  cudaLaunchPolicy: CudaSidecarLaunchPolicy;
  supportsCuda: boolean;
  cpuPath: string;
  cudaPath: string | null;
}

async function pickExistingVariant(
  options: PickExistingVariantOptions,
): Promise<{ path: string; variant: SidecarVariant } | null> {
  const [cpuKind, cudaKind] = await Promise.all([
    getExistingPathKind(options.cpuPath),
    options.cudaPath !== null
      ? getExistingPathKind(options.cudaPath)
      : Promise.resolve('missing' as const),
  ]);
  const hasCpu = cpuKind === 'file';
  const hasCuda = cudaKind === 'file';

  if (options.accelerationPreference === 'cpu_only') {
    return hasCpu ? { path: options.cpuPath, variant: 'cpu' } : null;
  }

  const cudaPath = options.supportsCuda && hasCuda ? options.cudaPath : null;
  if (cudaPath !== null && options.cudaLaunchPolicy === 'preferred') {
    return { path: cudaPath, variant: 'cuda' };
  }

  if (hasCpu) {
    return { path: options.cpuPath, variant: 'cpu' };
  }

  // Unverified CUDA is still better than not starting: an inconclusive probe on
  // a machine that only ever installed the CUDA sidecar would otherwise take a
  // working setup offline. It may fail on the driver, which is a legible error;
  // Settings separately offers CPU recovery when CUDA turns out to be unusable.
  if (cudaPath !== null && options.cudaLaunchPolicy === 'fallback') {
    return { path: cudaPath, variant: 'cuda' };
  }

  return null;
}
