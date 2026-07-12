import type { AudioFrameSource, AudioFrameSourceProgress } from './audio-frame-source';
import { mixChannelsToMono, PcmFrameProcessor } from './pcm-frame-processor';

export const AUDIO_FILE_ACCEPT = '.mp3,.wav,audio/mpeg,audio/wav';
export const MAX_AUDIO_FILE_DURATION_SECONDS = 30 * 60;
export const MAX_AUDIO_FILE_BYTES = 256 * 1024 * 1024;

const SOURCE_CHUNK_SAMPLES = 16_384;
const METADATA_PROBE_TIMEOUT_MS = 10_000;
// Yield after at most ~1 second of 16 kHz source audio (and more often for the
// common 44.1/48 kHz case) so sidecar queue events can reach the flow gate.
const YIELD_EVERY_CHUNKS = 1;

export interface AudioFileLike extends Blob {
  readonly name: string;
}

interface DecodedAudio {
  duration: number;
  getChannelData(channel: number): Float32Array;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
}

interface AudioFileFrameSourceDependencies {
  decodeAudio: (encodedAudio: ArrayBuffer) => Promise<DecodedAudio>;
  probeDuration: (file: AudioFileLike, abortSignal: AbortSignal) => Promise<number>;
  yieldToEventLoop: () => Promise<void>;
}

interface AudioMetadataProbeDependencies {
  createAudioElement: () => HTMLAudioElement;
  createObjectUrl: (file: Blob) => string;
  revokeObjectUrl: (url: string) => void;
}

export class AudioFileFrameSource implements AudioFrameSource {
  private readonly dependencies: AudioFileFrameSourceDependencies;
  private readonly file: AudioFileLike;

  constructor(
    file: AudioFileLike,
    dependencies: AudioFileFrameSourceDependencies = {
      decodeAudio: decodeWithWebAudio,
      probeDuration: probeAudioDuration,
      yieldToEventLoop,
    },
  ) {
    validateAudioFile(file);
    this.file = file;
    this.dependencies = dependencies;
  }

  async stream(options: {
    abortSignal: AbortSignal;
    onFrame: (frameBytes: Uint8Array) => Promise<void>;
    onProgress: (progress: AudioFrameSourceProgress) => void;
  }): Promise<void> {
    throwIfAborted(options.abortSignal);
    options.onProgress({ fraction: 0, phase: 'decoding' });

    validateAudioDuration(await this.dependencies.probeDuration(this.file, options.abortSignal));
    throwIfAborted(options.abortSignal);

    const decoded = await this.dependencies.decodeAudio(await this.file.arrayBuffer());
    validateDecodedAudio(decoded);
    throwIfAborted(options.abortSignal);
    options.onProgress({ fraction: 0, phase: 'streaming' });

    const processor = new PcmFrameProcessor({ sourceSampleRate: decoded.sampleRate });

    for (let offset = 0, chunkIndex = 0; offset < decoded.length; chunkIndex += 1) {
      throwIfAborted(options.abortSignal);
      const end = Math.min(offset + SOURCE_CHUNK_SAMPLES, decoded.length);
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
        decoded.getChannelData(channel).subarray(offset, end),
      );

      for (const frame of processor.push(mixChannelsToMono(channels))) {
        throwIfAborted(options.abortSignal);
        await options.onFrame(encodePcm16Le(frame));
      }

      offset = end;
      options.onProgress({ fraction: offset / decoded.length, phase: 'streaming' });
      if ((chunkIndex + 1) % YIELD_EVERY_CHUNKS === 0) {
        await this.dependencies.yieldToEventLoop();
      }
    }

    const finalFrame = processor.finish();
    if (finalFrame !== null) {
      throwIfAborted(options.abortSignal);
      await options.onFrame(encodePcm16Le(finalFrame));
    }
  }
}

export function validateAudioFile(file: Pick<AudioFileLike, 'name' | 'size'>): void {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (extension !== '.mp3' && extension !== '.wav') {
    throw new Error('Choose a WAV or MP3 audio file.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('The selected audio file is empty.');
  }
  if (file.size > MAX_AUDIO_FILE_BYTES) {
    throw new Error('The selected audio file is larger than 256 MB.');
  }
}

function validateDecodedAudio(decoded: DecodedAudio): void {
  if (
    !Number.isFinite(decoded.duration) ||
    decoded.duration <= 0 ||
    !Number.isInteger(decoded.length) ||
    decoded.length <= 0 ||
    !Number.isInteger(decoded.numberOfChannels) ||
    decoded.numberOfChannels <= 0 ||
    !Number.isFinite(decoded.sampleRate) ||
    decoded.sampleRate <= 0
  ) {
    throw new Error('The selected audio file did not contain decodable audio.');
  }
  validateAudioDuration(decoded.duration);
}

function validateAudioDuration(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('The selected audio file did not contain decodable audio.');
  }
  if (duration > MAX_AUDIO_FILE_DURATION_SECONDS) {
    throw new Error('Choose an audio file that is 30 minutes or shorter.');
  }
}

export async function probeAudioDuration(
  file: AudioFileLike,
  abortSignal: AbortSignal,
  dependencies: AudioMetadataProbeDependencies = {
    createAudioElement: () => createEl('audio'),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  },
): Promise<number> {
  throwIfAborted(abortSignal);
  const audio = dependencies.createAudioElement();
  const objectUrl = dependencies.createObjectUrl(file);
  audio.preload = 'metadata';

  try {
    return await new Promise<number>((resolve, reject) => {
      let timeoutId: number | null = null;
      const cleanup = (): void => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        audio.removeEventListener('error', onError);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        abortSignal.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        const error = new Error('Audio file transcription was cancelled.');
        error.name = 'AbortError';
        reject(error);
      };
      const onError = (): void => {
        cleanup();
        reject(new Error('Obsidian could not read metadata from this WAV or MP3 file.'));
      };
      const onLoadedMetadata = (): void => {
        cleanup();
        resolve(audio.duration);
      };
      const onTimeout = (): void => {
        cleanup();
        reject(new Error('Timed out while reading metadata from the selected audio file.'));
      };

      audio.addEventListener('error', onError, { once: true });
      audio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
      abortSignal.addEventListener('abort', onAbort, { once: true });
      timeoutId = window.setTimeout(onTimeout, METADATA_PROBE_TIMEOUT_MS);
      audio.src = objectUrl;
      audio.load();
    });
  } finally {
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } finally {
      dependencies.revokeObjectUrl(objectUrl);
    }
  }
}

function encodePcm16Le(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, samples[index] ?? 0, true);
  }
  return bytes;
}

async function decodeWithWebAudio(encodedAudio: ArrayBuffer): Promise<DecodedAudio> {
  if (window.AudioContext === undefined) {
    throw new Error('Audio file decoding is not available in this Obsidian runtime.');
  }

  const context = new window.AudioContext();
  try {
    return await context.decodeAudioData(encodedAudio);
  } catch (error) {
    throw new Error('Obsidian could not decode this WAV or MP3 file.', { cause: error });
  } finally {
    await context.close().catch(() => {});
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  const error = new Error('Audio file transcription was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
