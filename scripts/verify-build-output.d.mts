export interface VerifyFrontendBuildOutputOptions {
  rootDir?: string;
}

export interface VerifySidecarBuildOutputOptions {
  profile?: 'debug' | 'release';
  rootDir?: string;
}

export function verifyFrontendBuildOutput(
  options?: VerifyFrontendBuildOutputOptions,
): Promise<void>;

export function verifySidecarBuildOutput(
  options?: VerifySidecarBuildOutputOptions,
): Promise<boolean>;
