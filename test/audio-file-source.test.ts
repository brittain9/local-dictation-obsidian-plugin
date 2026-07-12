import { describe, expect, it, vi } from 'vitest';

import {
  AudioFileFrameSource,
  MAX_AUDIO_FILE_BYTES,
  MAX_AUDIO_FILE_DURATION_SECONDS,
  validateAudioFile,
} from '../src/audio/audio-file-source';
import { PCM_BYTES_PER_FRAME } from '../src/shared/pcm-format';

function createDecodedAudio(
  options: { channels?: Float32Array[]; duration?: number; sampleRate?: number } = {},
) {
  const channels = options.channels ?? [new Float32Array(320).fill(0.5)];
  const sampleRate = options.sampleRate ?? 16_000;
  return {
    duration: options.duration ?? (channels[0]?.length ?? 0) / sampleRate,
    getChannelData: (channel: number) => channels[channel] ?? new Float32Array(),
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    sampleRate,
  };
}

function createFile(overrides: { name?: string; size?: number } = {}) {
  return {
    arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    name: overrides.name ?? 'recording.wav',
    size: overrides.size ?? 8,
  };
}

describe('AudioFileFrameSource', () => {
  it('mixes channels, emits fixed little-endian PCM frames, and reports progress', async () => {
    const left = new Float32Array(320).fill(1);
    const right = new Float32Array(320).fill(0);
    const onFrame = vi.fn(async (_frame: Uint8Array) => {});
    const onProgress = vi.fn();
    const source = new AudioFileFrameSource(createFile(), {
      decodeAudio: vi.fn(async () => createDecodedAudio({ channels: [left, right] })),
      yieldToEventLoop: vi.fn(async () => {}),
    });

    await source.stream({
      abortSignal: new AbortController().signal,
      onFrame,
      onProgress,
    });

    expect(onFrame).toHaveBeenCalledOnce();
    const frame = onFrame.mock.calls[0]?.[0];
    expect(frame).toHaveLength(PCM_BYTES_PER_FRAME);
    expect(new DataView(frame?.buffer ?? new ArrayBuffer(0)).getInt16(0, true)).toBe(16_384);
    expect(onProgress).toHaveBeenNthCalledWith(1, { fraction: 0, phase: 'decoding' });
    expect(onProgress).toHaveBeenLastCalledWith({ fraction: 1, phase: 'streaming' });
  });

  it('pads short decoded audio to one complete sidecar frame', async () => {
    const onFrame = vi.fn(async (_frame: Uint8Array) => {});
    const source = new AudioFileFrameSource(createFile(), {
      decodeAudio: vi.fn(async () =>
        createDecodedAudio({ channels: [new Float32Array(100).fill(-1)] }),
      ),
      yieldToEventLoop: vi.fn(async () => {}),
    });

    await source.stream({
      abortSignal: new AbortController().signal,
      onFrame,
      onProgress: vi.fn(),
    });

    const frame = onFrame.mock.calls[0]?.[0];
    const view = new DataView(frame?.buffer ?? new ArrayBuffer(0));
    expect(frame).toHaveLength(PCM_BYTES_PER_FRAME);
    expect(view.getInt16(0, true)).toBe(-32_768);
    expect(view.getInt16(200, true)).toBe(0);
  });

  it('stops before sending another frame after cancellation', async () => {
    const abortController = new AbortController();
    const onFrame = vi.fn(async () => {
      abortController.abort();
    });
    const source = new AudioFileFrameSource(createFile(), {
      decodeAudio: vi.fn(async () =>
        createDecodedAudio({ channels: [new Float32Array(640).fill(0.25)] }),
      ),
      yieldToEventLoop: vi.fn(async () => {}),
    });

    await expect(
      source.stream({
        abortSignal: abortController.signal,
        onFrame,
        onProgress: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(onFrame).toHaveBeenCalledOnce();
  });

  it('rejects unsupported, empty, oversized, and overlong inputs', async () => {
    expect(() => validateAudioFile(createFile({ name: 'clip.m4a' }))).toThrow(/WAV or MP3/u);
    expect(() => validateAudioFile(createFile({ size: 0 }))).toThrow(/empty/u);
    expect(() => validateAudioFile(createFile({ size: MAX_AUDIO_FILE_BYTES + 1 }))).toThrow(
      /larger than 256 MB/u,
    );

    const source = new AudioFileFrameSource(createFile(), {
      decodeAudio: vi.fn(async () =>
        createDecodedAudio({ duration: MAX_AUDIO_FILE_DURATION_SECONDS + 1 }),
      ),
      yieldToEventLoop: vi.fn(async () => {}),
    });
    await expect(
      source.stream({
        abortSignal: new AbortController().signal,
        onFrame: vi.fn(async () => {}),
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow(/30 minutes or shorter/u);
  });
});
