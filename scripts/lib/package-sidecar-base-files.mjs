import { copyFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIRD_PARTY_NOTICES_PATH = fileURLToPath(
  new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url),
);

export async function stageSidecarBaseFiles({
  artifactDirectory,
  binaryName,
  binaryPath,
  extraFilePaths = [],
  helperName,
  helperPath,
}) {
  await mkdir(artifactDirectory, { recursive: true });
  await Promise.all([
    copyFile(binaryPath, join(artifactDirectory, binaryName)),
    copyFile(helperPath, join(artifactDirectory, helperName)),
    copyFile(THIRD_PARTY_NOTICES_PATH, join(artifactDirectory, 'THIRD_PARTY_NOTICES.md')),
    ...extraFilePaths.map((path) => copyFile(path, join(artifactDirectory, basename(path)))),
  ]);
}
