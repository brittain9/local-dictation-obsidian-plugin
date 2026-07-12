import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/audio/pcm-recorder-worklet-source', () => ({
  PCM_RECORDER_WORKLET_SOURCE: 'registerProcessor("pcm-recorder", class {});',
}));

import { AudioCaptureStream } from '../src/audio/audio-capture-stream';

class FakeMediaStreamTrack {
  private readonly endedListeners = new Set<EventListenerOrEventListenerObject>();
  public readyState: MediaStreamTrackState = 'live';
  public readonly stop = vi.fn(() => {
    this.readyState = 'ended';
    this.emitEnded();
  });

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type === 'ended' && listener !== null) {
      this.endedListeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type === 'ended' && listener !== null) {
      this.endedListeners.delete(listener);
    }
  }

  endUnexpectedly(): void {
    this.readyState = 'ended';
    this.emitEnded();
  }

  listenerCount(): number {
    return this.endedListeners.size;
  }

  private emitEnded(): void {
    const event = new Event('ended');
    for (const listener of this.endedListeners) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

class FakeMediaStream {
  constructor(private readonly track: FakeMediaStreamTrack) {}

  getAudioTracks(): MediaStreamTrack[] {
    return [this.track as unknown as MediaStreamTrack];
  }

  getTracks(): MediaStreamTrack[] {
    return this.getAudioTracks();
  }
}

class FakeAudioNode {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class FakeAudioContext {
  readonly audioWorklet = { addModule: vi.fn(async (_url: string) => {}) };
  readonly destination = new FakeAudioNode();
  readonly close = vi.fn(async () => {
    this.state = 'closed';
  });
  readonly createGain = vi.fn(() => ({
    ...new FakeAudioNode(),
    gain: { value: 1 },
  }));
  readonly createMediaStreamSource = vi.fn((_stream: MediaStream) => new FakeAudioNode());
  readonly resume = vi.fn(async () => {});
  state: AudioContextState = 'running';
}

class FakeAudioWorkletNode extends FakeAudioNode {
  readonly port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };
}

describe('AudioCaptureStream', () => {
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

  it('reports an unexpected microphone track end once for the owning session', async () => {
    const track = new FakeMediaStreamTrack();
    const mediaStream = new FakeMediaStream(track);
    const getUserMedia = vi.fn(async () => mediaStream as unknown as MediaStream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const onUnexpectedEnd = vi.fn();
    const capture = new AudioCaptureStream({ onUnexpectedEnd });

    await capture.start({ sessionId: 'session-a' }, vi.fn());
    track.endUnexpectedly();
    track.endUnexpectedly();

    expect(onUnexpectedEnd).toHaveBeenCalledOnce();
    expect(onUnexpectedEnd).toHaveBeenCalledWith('session-a');
    expect(track.listenerCount()).toBe(1);
  });

  it('removes the old track listener before teardown and rapid restart', async () => {
    const firstTrack = new FakeMediaStreamTrack();
    const secondTrack = new FakeMediaStreamTrack();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(new FakeMediaStream(firstTrack) as unknown as MediaStream)
      .mockResolvedValueOnce(new FakeMediaStream(secondTrack) as unknown as MediaStream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const onUnexpectedEnd = vi.fn();
    const capture = new AudioCaptureStream({ onUnexpectedEnd });

    await capture.start({ sessionId: 'session-a' }, vi.fn());
    await capture.stop();
    await capture.start({ sessionId: 'session-b' }, vi.fn());
    firstTrack.endUnexpectedly();

    expect(firstTrack.listenerCount()).toBe(0);
    expect(secondTrack.listenerCount()).toBe(1);
    expect(onUnexpectedEnd).not.toHaveBeenCalled();

    secondTrack.endUnexpectedly();
    expect(onUnexpectedEnd).toHaveBeenCalledOnce();
    expect(onUnexpectedEnd).toHaveBeenCalledWith('session-b');
  });
});
