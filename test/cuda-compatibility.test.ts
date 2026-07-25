import { describe, expect, it, vi } from 'vitest';

import {
  createCudaCompatibilityProvider,
  isCudaSidecarUsable,
  resolveCudaSidecarLaunchPolicy,
} from '../src/sidecar/cuda-compatibility';
import type { CudaCompatibility } from '../src/sidecar/gpu-precheck';

describe('isCudaSidecarUsable', () => {
  it('accepts only a confirmed-compatible probe', () => {
    expect(
      isCudaSidecarUsable({
        computeCapabilities: ['8.9'],
        driverVersion: '580.1',
        status: 'compatible',
      }),
    ).toBe(true);
  });

  it.each([
    null,
    { status: 'absent' },
    { status: 'unknown' },
    { status: 'unsupported' },
    { status: 'incompatible_driver', driverVersion: '579', computeCapabilities: ['8.9'] },
    { status: 'incompatible_gpu', driverVersion: '580', computeCapabilities: ['7.4'] },
  ] satisfies (CudaCompatibility | null)[])('rejects %o', (compatibility) => {
    expect(isCudaSidecarUsable(compatibility)).toBe(false);
  });
});

describe('resolveCudaSidecarLaunchPolicy', () => {
  it('prefers confirmed-compatible CUDA', () => {
    expect(
      resolveCudaSidecarLaunchPolicy({
        computeCapabilities: ['8.9'],
        driverVersion: '595.97',
        status: 'compatible',
      }),
    ).toBe('preferred');
  });

  it('keeps an inconclusive probe as a launch-only fallback', () => {
    expect(resolveCudaSidecarLaunchPolicy({ status: 'unknown' })).toBe('fallback');
  });

  it.each([
    null,
    { status: 'absent' },
    { status: 'unsupported' },
    { status: 'incompatible_driver', driverVersion: '579', computeCapabilities: ['8.9'] },
    { status: 'incompatible_gpu', driverVersion: '595.97', computeCapabilities: ['7.4'] },
  ] satisfies (CudaCompatibility | null)[])('excludes known-unusable CUDA for %o', (result) => {
    expect(resolveCudaSidecarLaunchPolicy(result)).toBe('unavailable');
  });
});

describe('createCudaCompatibilityProvider', () => {
  it('shares one probe promise between every consumer in a Settings display', async () => {
    const result: CudaCompatibility = {
      computeCapabilities: ['8.9'],
      driverVersion: '580.1',
      status: 'compatible',
    };
    const detect = vi.fn(async () => result);
    const getCompatibility = createCudaCompatibilityProvider(detect);

    const first = getCompatibility();
    const second = getCompatibility();

    expect(first).toBe(second);
    await expect(Promise.all([first, second])).resolves.toEqual([result, result]);
    expect(detect).toHaveBeenCalledOnce();
  });

  it('shares a safe unknown result when the detector rejects', async () => {
    const detect = vi.fn(async (): Promise<CudaCompatibility> => {
      throw new Error('probe failed');
    });
    const getCompatibility = createCudaCompatibilityProvider(detect);

    await expect(Promise.all([getCompatibility(), getCompatibility()])).resolves.toEqual([
      { status: 'unknown' },
      { status: 'unknown' },
    ]);
    expect(detect).toHaveBeenCalledOnce();
  });
});
