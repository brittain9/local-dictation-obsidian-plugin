import { type CudaCompatibility, detectCudaCompatibility } from './gpu-precheck';

export type GetCudaCompatibility = () => Promise<CudaCompatibility>;
export type CudaSidecarLaunchPolicy = 'fallback' | 'preferred' | 'unavailable';

/**
 * The single answer to "should this machine run the CUDA sidecar?".
 *
 * Platform artifact availability and verified runtime compatibility are
 * different questions, and every caller that conflated them got one of them
 * wrong: a Windows box with no NVIDIA driver would launch `bin/cuda` while
 * being told nothing needed repairing. `detectCudaCompatibility` already
 * reports `unsupported` off the release targets, so this predicate covers both
 * questions at once. `null` — the probe never ran — is not a licence to use
 * CUDA.
 */
export function isCudaSidecarUsable(compatibility: CudaCompatibility | null): boolean {
  return compatibility?.status === 'compatible';
}

/**
 * Launch is intentionally more nuanced than recommendation surfaces:
 *
 * - confirmed compatibility prefers CUDA;
 * - an inconclusive probe may retain CUDA only as a last resort;
 * - known-incompatible, absent, and unsupported environments never launch it.
 */
export function resolveCudaSidecarLaunchPolicy(
  compatibility: CudaCompatibility | null,
): CudaSidecarLaunchPolicy {
  if (compatibility?.status === 'compatible') return 'preferred';
  if (compatibility?.status === 'unknown') return 'fallback';
  return 'unavailable';
}

/**
 * One owner, one lazy probe. Settings creates a provider per display so a
 * freshly installed driver is picked up on reopen; the plugin creates one for
 * the whole session, because launch and version-drift decisions are both made
 * at startup and must agree with each other.
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
