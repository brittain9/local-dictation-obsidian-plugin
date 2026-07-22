import {
  readInstallManifest,
  type SidecarInstallVariant,
  variantDirectoryPath,
} from './sidecar-installer';

export interface SidecarVersionDrift {
  installedVersion: string;
  requiredVersion: string;
  variant: SidecarInstallVariant;
}

const SIDECAR_VARIANTS: readonly SidecarInstallVariant[] = ['cpu', 'cuda'];

/**
 * True when the on-disk sidecar was installed from a different release than
 * the version required by the current plugin build.
 *
 * Obsidian's updater replaces only `main.js`/`manifest.json`/`styles.css`; the
 * separately-installed sidecar under `bin/<variant>/` is never touched. The
 * plugin may intentionally reuse a sidecar from an earlier release. We compare
 * the version recorded in `install.json` against the required sidecar release.
 * Versions are exact release tags, so a trimmed string inequality is the right
 * test.
 */
export function isSidecarVersionDrifted(
  installedVersion: string,
  requiredVersion: string,
): boolean {
  return installedVersion.trim() !== requiredVersion.trim();
}

export function isDevelopmentSidecarVersion(version: string): boolean {
  return version.trim().startsWith('dev-');
}

/**
 * Reads every supported install manifest and reports release-installed
 * variants that do not match `requiredVersion`. Development sidecars are copied
 * into the same directories with `dev-*` manifest versions, so they are
 * intentionally excluded from release update prompts. The preferred runtime
 * variant is returned first so it can be updated and restarted before fallback
 * variants are replaced.
 */
export async function detectSidecarVersionDrift(params: {
  pluginDirectory: string;
  preferredVariant: SidecarInstallVariant;
  requiredVersion: string;
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
    if (!isSidecarVersionDrifted(manifest.version, params.requiredVersion)) return [];

    return [
      {
        installedVersion: manifest.version,
        requiredVersion: params.requiredVersion,
        variant,
      },
    ];
  });
}
