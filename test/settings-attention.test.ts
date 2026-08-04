import { describe, expect, it } from 'vitest';

import {
  resolveSettingsAttention,
  type SettingsAttentionSnapshot,
  type SidecarManifestState,
} from '../src/settings/settings-attention';
import type { CudaCompatibility } from '../src/sidecar/gpu-precheck';
import type { ActiveSidecarInstall } from '../src/sidecar/sidecar-install-manager';
import type { InstallManifest, SidecarInstallVariant } from '../src/sidecar/sidecar-installer';
import type { SidecarVersionDrift } from '../src/sidecar/sidecar-version-drift';

const COMPATIBLE: CudaCompatibility = {
  computeCapabilities: ['8.9'],
  driverVersion: '580.1',
  status: 'compatible',
};

function manifest(variant: SidecarInstallVariant, version = '2026.7.11'): InstallManifest {
  return {
    installedAt: '2026-07-24T00:00:00.000Z',
    sha256: 'abc',
    variant,
    version,
  };
}

function installed(variant: SidecarInstallVariant, version?: string): SidecarManifestState {
  return { manifest: manifest(variant, version), status: 'installed' };
}

function drift(variant: SidecarInstallVariant): SidecarVersionDrift {
  return {
    installedVersion: '2026.7.10',
    pluginVersion: '2026.7.11',
    variant,
  };
}

function snapshot(overrides: Partial<SettingsAttentionSnapshot> = {}): SettingsAttentionSnapshot {
  return {
    accelerationPreference: 'auto',
    activeInstall: null,
    cudaCompatibility: null,
    customSidecarConfigured: false,
    drift: [],
    manifests: {
      cpu: installed('cpu'),
      cuda: { status: 'absent' },
    },
    ...overrides,
  };
}

describe('resolveSettingsAttention', () => {
  it('shows only setup when both installer-managed sidecars are absent', () => {
    const result = resolveSettingsAttention(
      snapshot({
        cudaCompatibility: COMPATIBLE,
        manifests: { cpu: { status: 'absent' }, cuda: { status: 'absent' } },
      }),
    );

    expect(result).toEqual({ items: [{ action: 'setup', id: 'setup' }], kind: 'items' });
  });

  it('does not infer setup when a manifest read is unknown', () => {
    const result = resolveSettingsAttention(
      snapshot({
        manifests: { cpu: { status: 'unknown' }, cuda: { status: 'absent' } },
      }),
    );

    expect(result).toEqual({ items: [], kind: 'items' });
  });

  it('suppresses installer attention for a custom sidecar path', () => {
    const result = resolveSettingsAttention(
      snapshot({
        activeInstall: activeInstall('cuda'),
        cudaCompatibility: COMPATIBLE,
        customSidecarConfigured: true,
        drift: [drift('cpu')],
      }),
    );

    expect(result).toEqual({ items: [], kind: 'items' });
  });

  it('uses active progress instead of duplicate actions', () => {
    const active = activeInstall('cuda');

    expect(
      resolveSettingsAttention(
        snapshot({
          activeInstall: active,
          cudaCompatibility: COMPATIBLE,
          drift: [drift('cpu')],
        }),
      ),
    ).toEqual({ activeInstall: active, kind: 'progress' });
  });

  it('consolidates stale variants in authoritative order', () => {
    const result = resolveSettingsAttention(
      snapshot({
        cudaCompatibility: COMPATIBLE,
        drift: [drift('cuda'), drift('cpu')],
        manifests: { cpu: installed('cpu', '2026.7.10'), cuda: installed('cuda', '2026.7.10') },
      }),
    );

    expect(result).toEqual({
      items: [
        {
          action: 'update_sidecars',
          id: 'update_sidecars',
          variants: ['cuda', 'cpu'],
        },
      ],
      kind: 'items',
    });
  });

  it('shows only the higher-priority stale CPU update before a CUDA install opportunity', () => {
    const result = resolveSettingsAttention(
      snapshot({
        cudaCompatibility: COMPATIBLE,
        drift: [drift('cpu')],
        manifests: { cpu: installed('cpu', '2026.7.10'), cuda: { status: 'absent' } },
      }),
    );

    expect(result.kind).toBe('items');
    if (result.kind === 'items') {
      expect(result.items.map((item) => item.id)).toEqual(['update_sidecars']);
    }
  });

  it('offers CUDA installation only after a CPU sidecar is installed', () => {
    expect(
      resolveSettingsAttention(
        snapshot({
          cudaCompatibility: COMPATIBLE,
          manifests: { cpu: installed('cpu'), cuda: { status: 'absent' } },
        }),
      ),
    ).toEqual({
      items: [{ action: 'install_cuda', id: 'install_cuda' }],
      kind: 'items',
    });
  });

  it('suppresses enable CUDA until its stale install is updated', () => {
    const result = resolveSettingsAttention(
      snapshot({
        accelerationPreference: 'cpu_only',
        cudaCompatibility: COMPATIBLE,
        drift: [drift('cuda')],
        manifests: { cpu: installed('cpu'), cuda: installed('cuda', '2026.7.10') },
      }),
    );

    expect(result).toEqual({
      items: [
        {
          action: 'update_sidecars',
          id: 'update_sidecars',
          variants: ['cuda'],
        },
      ],
      kind: 'items',
    });
  });

  it('shows only the higher-priority stale CPU update before enabling CUDA', () => {
    const result = resolveSettingsAttention(
      snapshot({
        accelerationPreference: 'cpu_only',
        cudaCompatibility: COMPATIBLE,
        drift: [drift('cpu')],
        manifests: { cpu: installed('cpu', '2026.7.10'), cuda: installed('cuda') },
      }),
    );

    expect(result.kind).toBe('items');
    if (result.kind === 'items') {
      expect(result.items.map((item) => item.id)).toEqual(['update_sidecars']);
    }
  });

  it('offers enable CUDA for a current disabled CUDA install', () => {
    const result = resolveSettingsAttention(
      snapshot({
        accelerationPreference: 'cpu_only',
        cudaCompatibility: COMPATIBLE,
        manifests: { cpu: installed('cpu'), cuda: installed('cuda') },
      }),
    );

    expect(result).toEqual({
      items: [{ action: 'enable_cuda', id: 'enable_cuda' }],
      kind: 'items',
    });
  });

  it('treats a CUDA-only install as installed instead of requesting setup', () => {
    expect(
      resolveSettingsAttention(
        snapshot({
          cudaCompatibility: COMPATIBLE,
          manifests: { cpu: { status: 'absent' }, cuda: installed('cuda') },
        }),
      ),
    ).toEqual({ items: [], kind: 'items' });
  });

  it('does not infer a CUDA install action from an unknown CUDA manifest', () => {
    expect(
      resolveSettingsAttention(
        snapshot({
          cudaCompatibility: COMPATIBLE,
          manifests: { cpu: installed('cpu'), cuda: { status: 'unknown' } },
        }),
      ),
    ).toEqual({ items: [], kind: 'items' });
  });

  it('does not offer enable CUDA when automatic acceleration is already selected', () => {
    expect(
      resolveSettingsAttention(
        snapshot({
          cudaCompatibility: COMPATIBLE,
          manifests: { cpu: installed('cpu'), cuda: installed('cuda') },
        }),
      ),
    ).toEqual({ items: [], kind: 'items' });
  });

  it.each([
    { status: 'absent' },
    { status: 'unknown' },
    { status: 'unsupported' },
    { status: 'incompatible_driver', driverVersion: '579', computeCapabilities: ['8.9'] },
    { status: 'incompatible_gpu', driverVersion: '580', computeCapabilities: ['7.4'] },
  ] satisfies CudaCompatibility[])(
    'does not create CUDA attention for $status compatibility',
    (cudaCompatibility) => {
      expect(resolveSettingsAttention(snapshot({ cudaCompatibility }))).toEqual({
        items: [],
        kind: 'items',
      });
    },
  );

  const UNUSABLE_CUDA = [
    { status: 'absent' },
    { status: 'unknown' },
    { status: 'unsupported' },
    { status: 'incompatible_driver', driverVersion: '579', computeCapabilities: ['8.9'] },
    { status: 'incompatible_gpu', driverVersion: '580', computeCapabilities: ['7.4'] },
  ] satisfies CudaCompatibility[];

  it.each(UNUSABLE_CUDA)(
    'offers CPU setup instead of a CUDA update for a stale CUDA-only install ($status)',
    (cudaCompatibility) => {
      expect(
        resolveSettingsAttention(
          snapshot({
            cudaCompatibility,
            drift: [drift('cuda')],
            manifests: { cpu: { status: 'absent' }, cuda: installed('cuda', '2026.7.10') },
          }),
        ),
      ).toEqual({ items: [{ action: 'setup', id: 'setup' }], kind: 'items' });
    },
  );

  it.each(UNUSABLE_CUDA)(
    'keeps the CPU update and drops the unusable CUDA one ($status)',
    (cudaCompatibility) => {
      expect(
        resolveSettingsAttention(
          snapshot({
            cudaCompatibility,
            drift: [drift('cuda'), drift('cpu')],
            manifests: {
              cpu: installed('cpu', '2026.7.10'),
              cuda: installed('cuda', '2026.7.10'),
            },
          }),
        ),
      ).toEqual({
        items: [{ action: 'update_sidecars', id: 'update_sidecars', variants: ['cpu'] }],
        kind: 'items',
      });
    },
  );

  it('stays silent while an unusable CUDA install sits beside an unread CPU manifest', () => {
    expect(
      resolveSettingsAttention(
        snapshot({
          cudaCompatibility: {
            computeCapabilities: ['8.9'],
            driverVersion: '579',
            status: 'incompatible_driver',
          },
          manifests: { cpu: { status: 'unknown' }, cuda: installed('cuda') },
        }),
      ),
    ).toEqual({ items: [], kind: 'items' });
  });
});

function activeInstall(variant: SidecarInstallVariant): ActiveSidecarInstall {
  return {
    currentVariantNumber: 1,
    phase: 'installing',
    progress: { bytesDownloaded: 10, phase: 'download', totalBytes: 100 },
    totalVariants: 1,
    variant,
  };
}
