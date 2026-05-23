import { asError } from '../shared/error-utils';
import { PCM_BYTES_PER_FRAME, PCM_CHANNEL_COUNT } from '../shared/pcm-format';
import type { PluginLogger } from '../shared/plugin-logger';
import type { AudioVisualizerAttachable } from './audio-visualizer-tap';
import { PCM_RECORDER_WORKLET_NAME } from './pcm-recorder-worklet-shared';
import { PCM_RECORDER_WORKLET_SOURCE } from './pcm-recorder-worklet-source';

type AudioFrameListener = (sessionId: string, frameBytes: Uint8Array) => void;

interface AudioCaptureStreamOptions {
  logger?: PluginLogger;
  // Invoked when a saved deviceId is unavailable and we transparently fall back
  // to the OS default. Lets the wiring layer (main.ts) surface a Notice without
  // pulling Obsidian UI imports into this module.
  onDeviceFallback?: () => void;
  visualizer?: AudioVisualizerAttachable;
}

export interface AudioCaptureStartOptions {
  audioInputDeviceId?: string | null;
  sessionId: string;
}

export class AudioCaptureStream {
  private audioContext: AudioContext | null = null;
  private frameListener: AudioFrameListener | null = null;
  private mediaStream: MediaStream | null = null;
  private muteNode: GainNode | null = null;
  private recorderNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  constructor(private readonly options: AudioCaptureStreamOptions) {}

  isCapturing(): boolean {
    return this.mediaStream !== null;
  }

  async start(options: AudioCaptureStartOptions, frameListener: AudioFrameListener): Promise<void> {
    const { sessionId, audioInputDeviceId } = options;

    if (this.isCapturing()) {
      throw new Error('Audio capture is already active.');
    }

    const mediaDevices = globalThis.navigator?.mediaDevices;

    if (mediaDevices?.getUserMedia === undefined) {
      throw new Error('Microphone capture is not available in this Obsidian runtime.');
    }

    const mediaStream = await this.requestUserMedia(mediaDevices, audioInputDeviceId);

    let audioContext: AudioContext | null = null;

    try {
      const AudioContextConstructor = getAudioContextConstructor();
      audioContext = new AudioContextConstructor();
      await installRecorderWorklet(audioContext, this.options.logger);
      await audioContext.resume();

      const sourceNode = audioContext.createMediaStreamSource(mediaStream);
      const recorderNode = new AudioWorkletNode(audioContext, PCM_RECORDER_WORKLET_NAME, {
        channelCount: PCM_CHANNEL_COUNT,
        channelCountMode: 'explicit',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [PCM_CHANNEL_COUNT],
      });
      const muteNode = audioContext.createGain();
      muteNode.gain.value = 0;

      recorderNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const frameBytes = new Uint8Array(event.data);

        if (frameBytes.byteLength !== PCM_BYTES_PER_FRAME) {
          this.options.logger?.warn(
            'audio',
            `ignored a mis-sized audio frame from the recorder worklet (${frameBytes.byteLength} bytes)`,
          );
          return;
        }

        this.frameListener?.(sessionId, frameBytes);
      };

      sourceNode.connect(recorderNode);
      recorderNode.connect(muteNode);
      muteNode.connect(audioContext.destination);
      this.options.visualizer?.attach(audioContext, sourceNode);

      this.audioContext = audioContext;
      this.frameListener = frameListener;
      this.mediaStream = mediaStream;
      this.muteNode = muteNode;
      this.recorderNode = recorderNode;
      this.sourceNode = sourceNode;
      this.options.logger?.debug('audio', 'capture started');
    } catch (error) {
      this.options.logger?.error('audio', 'failed to initialize streaming audio capture', error);
      this.options.visualizer?.detach();
      await stopMediaStream(mediaStream);

      if (audioContext !== null) {
        await closeAudioContext(audioContext);
      }

      throw asError(error, 'Failed to initialize microphone capture.');
    }
  }

  async stop(): Promise<void> {
    if (!this.isCapturing()) {
      return;
    }

    await this.releaseCapture();
    this.options.logger?.debug('audio', 'capture stopped');
  }

  private async requestUserMedia(
    mediaDevices: MediaDevices,
    audioInputDeviceId: string | null | undefined,
  ): Promise<MediaStream> {
    const baseConstraints: MediaTrackConstraints = {
      autoGainControl: false,
      channelCount: PCM_CHANNEL_COUNT,
      echoCancellation: false,
      noiseSuppression: false,
    };

    if (typeof audioInputDeviceId !== 'string' || audioInputDeviceId.length === 0) {
      return mediaDevices.getUserMedia({ audio: baseConstraints, video: false });
    }

    try {
      return await mediaDevices.getUserMedia({
        audio: { ...baseConstraints, deviceId: { exact: audioInputDeviceId } },
        video: false,
      });
    } catch (error) {
      if (!isDeviceConstraintError(error)) {
        throw error;
      }

      this.options.logger?.warn(
        'audio',
        'saved microphone unavailable; falling back to the default input device',
        error,
      );
      this.options.onDeviceFallback?.();
      return mediaDevices.getUserMedia({ audio: baseConstraints, video: false });
    }
  }

  private async releaseCapture(): Promise<void> {
    const audioContext = this.audioContext;
    const mediaStream = this.mediaStream;
    const muteNode = this.muteNode;
    const recorderNode = this.recorderNode;
    const sourceNode = this.sourceNode;

    this.audioContext = null;
    this.frameListener = null;
    this.mediaStream = null;
    this.muteNode = null;
    this.recorderNode = null;
    this.sourceNode = null;

    try {
      this.options.visualizer?.detach();
      recorderNode?.disconnect();
      sourceNode?.disconnect();
      muteNode?.disconnect();
    } catch (error) {
      this.options.logger?.warn(
        'audio',
        'failed to disconnect the audio capture graph cleanly',
        error,
      );
    }

    if (recorderNode !== null) {
      recorderNode.port.onmessage = null;
    }

    if (mediaStream !== null) {
      await stopMediaStream(mediaStream);
    }

    if (audioContext !== null) {
      await closeAudioContext(audioContext);
    }
  }
}

// OverconstrainedError is the spec-defined rejection when `deviceId: { exact }`
// matches nothing. We only treat that exact case as a "fall back to default"
// signal — other DOMExceptions (NotAllowed, NotFound, NotReadable) propagate so
// the existing top-level error path can surface them.
function isDeviceConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const named = error as { constraint?: unknown; name?: unknown };
  return named.name === 'OverconstrainedError' && named.constraint === 'deviceId';
}

function getAudioContextConstructor(): typeof AudioContext {
  if (globalThis.AudioContext !== undefined) {
    return globalThis.AudioContext;
  }

  throw new Error('AudioContext is not available in this Obsidian runtime.');
}

async function stopMediaStream(mediaStream: MediaStream): Promise<void> {
  for (const track of mediaStream.getTracks()) {
    track.stop();
  }
}

async function closeAudioContext(audioContext: AudioContext): Promise<void> {
  if (audioContext.state !== 'closed') {
    await audioContext.close();
  }
}

async function installRecorderWorklet(
  audioContext: AudioContext,
  logger?: PluginLogger,
): Promise<void> {
  if (audioContext.audioWorklet === undefined) {
    throw new Error('AudioWorklet is not available in this Obsidian runtime.');
  }

  logger?.debug('audio', 'installing recorder worklet');
  const workletModuleUrl = URL.createObjectURL(
    new Blob([PCM_RECORDER_WORKLET_SOURCE], { type: 'text/javascript' }),
  );

  try {
    await audioContext.audioWorklet.addModule(workletModuleUrl);
  } catch (error) {
    logger?.error('audio', 'failed to load recorder worklet module', error);
    throw asError(error, 'Failed to load recorder worklet module.');
  } finally {
    URL.revokeObjectURL(workletModuleUrl);
  }
}
