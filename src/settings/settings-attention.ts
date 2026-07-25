import { isCudaSidecarUsable } from '../sidecar/cuda-compatibility';
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

  // Only a variant this machine can actually run counts as an engine. A CUDA
  // install on a box with no usable driver is not one, so its presence must not
  // suppress the CPU setup prompt and its version drift must not be advertised
  // as a fix.
  const cudaUsable = isCudaSidecarUsable(snapshot.cudaCompatibility);
  const usableVariants = (['cpu', 'cuda'] as const).filter(
    (variant) =>
      (variant === 'cpu' || cudaUsable) && snapshot.manifests[variant].status === 'installed',
  );

  if (usableVariants.length === 0) {
    // An unread manifest may yet turn out to be a working engine; prompting for
    // setup on top of one would be telling the user to reinstall what they have.
    const mayStillHaveEngine = (['cpu', 'cuda'] as const).some(
      (variant) =>
        (variant === 'cpu' || cudaUsable) && snapshot.manifests[variant].status === 'unknown',
    );
    return mayStillHaveEngine
      ? { items: [], kind: 'items' }
      : { items: [{ action: 'setup', id: 'setup' }], kind: 'items' };
  }

  const driftVariants = snapshot.drift
    .map((entry) => entry.variant)
    .filter((variant) => usableVariants.includes(variant));
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

  if (!cudaUsable) return { items: [], kind: 'items' };

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
