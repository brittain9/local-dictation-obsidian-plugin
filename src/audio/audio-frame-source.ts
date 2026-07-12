export interface AudioFrameSourceProgress {
  fraction: number;
  phase: 'decoding' | 'streaming';
}

export interface AudioFrameSource {
  stream(options: {
    abortSignal: AbortSignal;
    onFrame: (frameBytes: Uint8Array) => Promise<void>;
    onProgress: (progress: AudioFrameSourceProgress) => void;
  }): Promise<void>;
}
