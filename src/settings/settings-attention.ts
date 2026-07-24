import type { CudaCompatibility } from '../sidecar/gpu-precheck';
import type { ActiveSidecarInstall } from '../sidecar/sidecar-install-manager';
import type { InstallManifest, SidecarInstallVariant } from '../sidecar/sidecar-installer';
import type { SidecarVersionDrift } from '../sidecar/sidecar-version-drift';
import type { PluginSettings } from './plugin-settings';

export type SidecarManifestState =
  | { status: 'absent' }
  | { manifest: InstallManifest; status: 'installed' }
  | { status: 'unknown' };

export interface SettingsAttentionSnapshot {
  accelerationPreference: PluginSettings['accelerationPreference'];
  activeInstall: ActiveSidecarInstall | null;
  cudaCompatibility: CudaCompatibility | null;
  customSidecarConfigured: boolean;
  drift: readonly SidecarVersionDrift[];
  manifests: Readonly<Record<SidecarInstallVariant, SidecarManifestState>>;
}

export type SettingsAttentionItem =
  | { action: 'setup'; id: 'setup' }
  | {
      action: 'update_sidecars';
      id: 'update_sidecars';
      variants: readonly [SidecarInstallVariant, ...SidecarInstallVariant[]];
    }
  | { action: 'install_cuda'; id: 'install_cuda' }
  | { action: 'enable_cuda'; id: 'enable_cuda' };

export type SettingsAttentionResolution =
  | { activeInstall: ActiveSidecarInstall; kind: 'progress' }
  | { items: readonly SettingsAttentionItem[]; kind: 'items' };

export function resolveSettingsAttention(
  snapshot: SettingsAttentionSnapshot,
): SettingsAttentionResolution {
  if (snapshot.customSidecarConfigured) return { items: [], kind: 'items' };
  if (snapshot.activeInstall !== null) {
    return { activeInstall: snapshot.activeInstall, kind: 'progress' };
  }

  const installedVariants = (['cpu', 'cuda'] as const).filter(
    (variant) => snapshot.manifests[variant].status === 'installed',
  );
  const allManifestsKnownAbsent = (['cpu', 'cuda'] as const).every(
    (variant) => snapshot.manifests[variant].status === 'absent',
  );

  if (installedVariants.length === 0) {
    return allManifestsKnownAbsent
      ? { items: [{ action: 'setup', id: 'setup' }], kind: 'items' }
      : { items: [], kind: 'items' };
  }

  const driftVariants = snapshot.drift.map((entry) => entry.variant);
  if (driftVariants.length > 0) {
    return {
      items: [
        {
          action: 'update_sidecars',
          id: 'update_sidecars',
          variants: driftVariants as [SidecarInstallVariant, ...SidecarInstallVariant[]],
        },
      ],
      kind: 'items',
    };
  }

  if (snapshot.cudaCompatibility?.status !== 'compatible') {
    return { items: [], kind: 'items' };
  }

  const cudaManifest = snapshot.manifests.cuda;
  if (cudaManifest.status === 'absent') {
    return {
      items: [{ action: 'install_cuda', id: 'install_cuda' }],
      kind: 'items',
    };
  }

  if (cudaManifest.status === 'installed' && snapshot.accelerationPreference === 'cpu_only') {
    return {
      items: [{ action: 'enable_cuda', id: 'enable_cuda' }],
      kind: 'items',
    };
  }

  return { items: [], kind: 'items' };
}
