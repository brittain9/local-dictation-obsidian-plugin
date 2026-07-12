import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/audio/pcm-recorder-worklet-source', () => ({
  PCM_RECORDER_WORKLET_SOURCE: 'registerProcessor("pcm-recorder", class {});',
}));

import { AudioCaptureStream } from '../src/audio/audio-capture-stream';

class FakeAudioNode {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = { value: 1 };
}

class FakeAudioContext {
  readonly audioWorklet = { addModule: vi.fn(async (_url: string) => {}) };
  readonly destination = new FakeAudioNode();
  readonly close = vi.fn(async () => {
    this.state = 'closed';
  });
  readonly createGain = vi.fn(() => new FakeGainNode());
  readonly createMediaStreamSource = vi.fn((_stream: MediaStream) => new FakeAudioNode());
  readonly resume = vi.fn(async () => {});
  state: AudioContextState = 'running';
}

class FakeAudioWorkletNode extends FakeAudioNode {
  readonly port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };
}

function createMediaStream(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

function createUnavailableDeviceError(): Error {
  return Object.assign(new Error('deviceId does not match an available input'), {
    constraint: 'deviceId',
    name: 'OverconstrainedError',
  });
}

describe('audio device fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recorder-worklet');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports the unavailable device and waits for settings repair after default capture opens', async () => {
    const defaultStream = createMediaStream();
    let openDefaultMicrophone: ((stream: MediaStream) => void) | undefined;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(createUnavailableDeviceError())
      .mockImplementationOnce(
        () =>
          new Promise<MediaStream>((resolve) => {
            openDefaultMicrophone = resolve;
          }),
      );
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const repairControl: { finish?: () => void } = {};
    const onDeviceFallback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          repairControl.finish = resolve;
        }),
    );
    const capture = new AudioCaptureStream({ onDeviceFallback });

    let startSettled = false;
    const start = capture
      .start({ audioInputDeviceId: 'missing-device', sessionId: 'session-a' }, vi.fn())
      .then(() => {
        startSettled = true;
      });
    await vi.waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(2);
    });

    expect(onDeviceFallback).not.toHaveBeenCalled();
    expect(startSettled).toBe(false);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: expect.objectContaining({ deviceId: { exact: 'missing-device' } }),
      video: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: expect.not.objectContaining({ deviceId: expect.anything() }),
      video: false,
    });

    openDefaultMicrophone?.(defaultStream);
    await vi.waitFor(() => {
      expect(onDeviceFallback).toHaveBeenCalledWith('missing-device');
    });

    const finishRepair = repairControl.finish;
    if (finishRepair === undefined) {
      throw new Error('fallback repair did not start');
    }
    finishRepair();
    await start;
    expect(capture.isCapturing()).toBe(true);
  });

  it('does not announce fallback when opening the default microphone also fails', async () => {
    const fallbackError = Object.assign(new Error('permission denied'), {
      name: 'NotAllowedError',
    });
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(createUnavailableDeviceError())
      .mockRejectedValueOnce(fallbackError);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const onDeviceFallback = vi.fn();
    const capture = new AudioCaptureStream({ onDeviceFallback });

    await expect(
      capture.start({ audioInputDeviceId: 'missing-device', sessionId: 'session-a' }, vi.fn()),
    ).rejects.toBe(fallbackError);
    expect(onDeviceFallback).not.toHaveBeenCalled();
    expect(capture.isCapturing()).toBe(false);
  });

  it.each([
    [
      'a different unsatisfied constraint',
      Object.assign(new Error('channel count unavailable'), {
        constraint: 'channelCount',
        name: 'OverconstrainedError',
      }),
    ],
    [
      'a non-constraint capture error',
      Object.assign(new Error('microphone is busy'), {
        name: 'NotReadableError',
      }),
    ],
  ])('does not fall back for %s', async (_description, captureError) => {
    const getUserMedia = vi.fn().mockRejectedValueOnce(captureError);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const onDeviceFallback = vi.fn();
    const capture = new AudioCaptureStream({ onDeviceFallback });

    await expect(
      capture.start({ audioInputDeviceId: 'saved-device', sessionId: 'session-a' }, vi.fn()),
    ).rejects.toBe(captureError);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onDeviceFallback).not.toHaveBeenCalled();
    expect(capture.isCapturing()).toBe(false);
  });

  it('continues default capture when the fallback callback rejects', async () => {
    const callbackError = new Error('settings persistence failed');
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(createUnavailableDeviceError())
      .mockResolvedValueOnce(createMediaStream());
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const capture = new AudioCaptureStream({
      logger,
      onDeviceFallback: vi.fn(async () => {
        throw callbackError;
      }),
    });

    await capture.start({ audioInputDeviceId: 'missing-device', sessionId: 'session-a' }, vi.fn());

    expect(capture.isCapturing()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'audio',
      'microphone fallback handler failed; continuing with the default input device',
      callbackError,
    );
  });
});
