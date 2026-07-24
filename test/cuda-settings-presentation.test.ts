import { describe, expect, it } from 'vitest';

import { getCudaInstallPresentation } from '../src/settings/sidecar-settings-section';

describe('CUDA Settings presentation', () => {
  it.each([
    [{ status: 'compatible', driverVersion: '580.0', computeCapabilities: ['7.5'] }, 'cta'],
    [
      { status: 'incompatible_driver', driverVersion: '579.0', computeCapabilities: ['8.9'] },
      'manual',
    ],
    [
      { status: 'incompatible_gpu', driverVersion: '580.0', computeCapabilities: ['7.4'] },
      'manual',
    ],
    [{ status: 'absent' }, 'manual'],
    [{ status: 'unknown' }, 'manual'],
  ] as const)('uses %s as a non-promotional action unless CUDA is compatible', (result, action) => {
    expect(getCudaInstallPresentation(result).installAction).toBe(action);
  });

  it('does not offer a CUDA install when no release asset exists for the target', () => {
    expect(getCudaInstallPresentation({ status: 'unsupported' })).toMatchObject({
      installAction: 'none',
    });
  });
});
