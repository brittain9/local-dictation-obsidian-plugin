export const SIDECAR_EXECUTABLE_BASENAME = 'local-dictation-sidecar';

export function formatSidecarExecutableName(isWindows: boolean): string {
  return isWindows ? `${SIDECAR_EXECUTABLE_BASENAME}.exe` : SIDECAR_EXECUTABLE_BASENAME;
}
