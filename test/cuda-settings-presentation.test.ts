import { describe, expect, it } from 'vitest';

import { en } from '../src/locales/en';
import { getCudaInstallPresentation } from '../src/settings/sidecar-settings-section';
import { CUDA_COMPATIBILITY_REQUIREMENTS } from '../src/sidecar/gpu-precheck';

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

  it('interpolates the authoritative driver minimum into the old-driver description', () => {
    const presentation = getCudaInstallPresentation({
      computeCapabilities: ['8.9'],
      driverVersion: '579.0',
      status: 'incompatible_driver',
    });

    expect(en['settings.sidecar.cudaCompatibility.incompatibleDriver']).toContain(
      '{minimumDriverMajor}',
    );
    expect(presentation.description).toBe(
      `NVIDIA driver is too old. Update to R${CUDA_COMPATIBILITY_REQUIREMENTS.minimumDriverMajor} or later to use the published CUDA sidecar.`,
    );
  });

  it('interpolates the authoritative compute minimum into the old-GPU description', () => {
    const presentation = getCudaInstallPresentation({
      computeCapabilities: ['7.4'],
      driverVersion: '580.0',
      status: 'incompatible_gpu',
    });
    const { major, minor } = CUDA_COMPATIBILITY_REQUIREMENTS.minimumComputeCapability;

    expect(en['settings.sidecar.cudaCompatibility.incompatibleGpu']).toContain(
      '{minimumComputeCapability}',
    );
    expect(presentation.description).toBe(
      `NVIDIA GPU needs compute capability ${major}.${minor} or later for the published CUDA sidecar.`,
    );
  });
});
