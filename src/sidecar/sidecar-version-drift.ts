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

/**
 * Reads the install manifest for `variant` and reports version drift against
 * `pluginVersion`. Returns `null` when there is nothing to prompt about: no
 * manifest on disk (sidecar not installed for this variant), or the installed
 * version already matches the plugin.
 */
export async function detectSidecarVersionDrift(params: {
  pluginDirectory: string;
  pluginVersion: string;
  variant: SidecarInstallVariant;
}): Promise<SidecarVersionDrift | null> {
  const manifest = await readInstallManifest(
    variantDirectoryPath(params.pluginDirectory, params.variant),
  );

  if (manifest === null) return null;
  if (!isSidecarVersionDrifted(manifest.version, params.pluginVersion)) return null;

  return {
    installedVersion: manifest.version,
    pluginVersion: params.pluginVersion,
    variant: params.variant,
  };
}
