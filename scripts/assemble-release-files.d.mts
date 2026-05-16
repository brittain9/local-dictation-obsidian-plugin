export const EXPECTED_SIDECAR_ARCHIVES: readonly string[];

export function validateSidecarArchives(
  presentEntries: ReadonlyArray<{ name: string; size: number }>,
): string[];

export function buildChecksumsFile(archiveContents: ReadonlyMap<string, Buffer>): string;

export function assembleReleaseFiles(
  rootDir?: string,
): Promise<{ pluginReleaseDir: string; sidecarReleaseDir: string }>;
