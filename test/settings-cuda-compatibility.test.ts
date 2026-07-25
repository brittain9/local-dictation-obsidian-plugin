import { describe, expect, it, vi } from 'vitest';

import { createCudaCompatibilityProvider } from '../src/settings/settings-cuda-compatibility';
import type { CudaCompatibility } from '../src/sidecar/gpu-precheck';

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
