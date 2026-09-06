export function stageSidecarBaseFiles(options: {
  artifactDirectory: string;
  binaryName: string;
  binaryPath: string;
  extraFilePaths?: string[];
  helperName: string;
  helperPath: string;
}): Promise<void>;
