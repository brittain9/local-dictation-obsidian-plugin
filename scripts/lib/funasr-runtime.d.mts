export const FUNASR_SENSEVOICE_HELPER: string;
export const FUNASR_NANO_HELPER: string;
export const FUNASR_AUDIO_CPP_HELPER: string;
export const FUNASR_SIDECAR_RUNTIME_ARTIFACTS: string[];

export function ensureFunasrSenseVoiceRuntime(options: {
  destinationDirectory: string;
  download?: boolean;
}): Promise<string | null>;

export function ensureFunasrNanoRuntime(options: {
  destinationDirectory: string;
  download?: boolean;
}): Promise<string | null>;

export function ensureFunasrAudioCppRuntime(options: {
  destinationDirectory: string;
  download?: boolean;
}): Promise<string | null>;

export function ensureFunasrSidecarArtifacts(options: {
  destinationDirectory: string;
  download?: boolean;
}): Promise<string[]>;

export function requireFunasrSidecarArtifacts(options: {
  destinationDirectory: string;
}): Promise<string[]>;
