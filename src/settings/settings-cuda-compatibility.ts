import { type CudaCompatibility, detectCudaCompatibility } from '../sidecar/gpu-precheck';

export type GetCudaCompatibility = () => Promise<CudaCompatibility>;

/**
 * One Settings display owns one lazy CUDA probe. The attention region and the
 * Advanced sidecar rows receive this same getter, so opening Settings never
 * spawns two nvidia-smi processes or presents two different probe results.
 */
export function createCudaCompatibilityProvider(
  detect: GetCudaCompatibility = detectCudaCompatibility,
): GetCudaCompatibility {
  let probe: Promise<CudaCompatibility> | null = null;
  return () => {
    probe ??= detect().catch(() => ({ status: 'unknown' }));
    return probe;
  };
}
