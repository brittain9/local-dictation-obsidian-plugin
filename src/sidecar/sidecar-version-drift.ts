import {
  readInstallManifest,
  type SidecarInstallVariant,
  variantDirectoryPath,
} from './sidecar-installer';

export interface SidecarVersionDrift {
  installedVersion: string;
  pluginVersion: string;
  variant: SidecarInstallVariant;
}

const SIDECAR_VARIANTS: readonly SidecarInstallVariant[] = ['cpu', 'cuda'];

/**
 * True when the on-disk sidecar was installed by a different plugin version.
 *
 * Obsidian's updater replaces only `main.js`/`manifest.json`/`styles.css`; the
 * separately-installed sidecar under `bin/<variant>/` is never touched. So a
 * plugin update silently leaves a stale sidecar behind. We compare the version
 * recorded in `install.json` (what the installer downloaded) against the
 * current plugin version. Versions are exact release tags, so a trimmed
 * string inequality is the right test.
 */
export function isSidecarVersionDrifted(installedVersion: string, pluginVersion: string): boolean {
  return installedVersion.trim() !== pluginVersion.trim();
}

export function isDevelopmentSidecarVersion(version: string): boolean {
  return version.trim().startsWith('dev-');
}

/**
 * Reads every supported install manifest and reports release-installed
 * variants that do not match `pluginVersion`. Development sidecars are copied
 * into the same directories with `dev-*` manifest versions, so they are
 * intentionally excluded from release update prompts. The preferred runtime
 * variant is returned first so it can be updated and restarted before fallback
 * variants are replaced.
 */
export async function detectSidecarVersionDrift(params: {
  pluginDirectory: string;
  pluginVersion: string;
  preferredVariant: SidecarInstallVariant;
  supportsCuda: boolean;
}): Promise<SidecarVersionDrift[]> {
  const variants = params.supportsCuda
    ? [...SIDECAR_VARIANTS].sort((left, right) => {
        if (left === params.preferredVariant) return -1;
        if (right === params.preferredVariant) return 1;
        return 0;
      })
    : SIDECAR_VARIANTS.slice(0, 1);
  const manifests = await Promise.all(
    variants.map(async (variant) => ({
      manifest: await readInstallManifest(variantDirectoryPath(params.pluginDirectory, variant)),
      variant,
    })),
  );

  return manifests.flatMap(({ manifest, variant }) => {
    if (manifest === null) return [];
    if (isDevelopmentSidecarVersion(manifest.version)) return [];
    if (!isSidecarVersionDrifted(manifest.version, params.pluginVersion)) return [];

    return [
      {
        installedVersion: manifest.version,
        pluginVersion: params.pluginVersion,
        variant,
      },
    ];
  });
}
