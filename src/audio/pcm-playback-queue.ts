export interface PcmPlaybackQueueCallbacks {
  onDrained: () => void;
  onPlayedThrough: (sequence: number) => void;
}

type AudioContextFactory = () => AudioContext;

interface ScheduledSource {
  source: AudioBufferSourceNode;
}

/** Schedules mono PCM chunks without coupling playback to microphone capture. */
export class PcmPlaybackQueue {
  private context: AudioContext | null = null;
  private generationComplete = false;
  private nextStartTime = 0;
  private paused = false;
  private scheduled = new Map<number, ScheduledSource>();

  constructor(
    private readonly callbacks: PcmPlaybackQueueCallbacks,
    private readonly createAudioContext: AudioContextFactory = () => new AudioContext(),
  ) {}

  start(): void {
    this.stop();
    this.context = this.createAudioContext();
    this.nextStartTime = this.context.currentTime;
  }

  enqueue(sequence: number, sampleRate: number, pcm16le: Uint8Array): void {
    const context = this.context;
    if (context === null) throw new Error('Playback has not started.');
    if (sampleRate <= 0 || pcm16le.byteLength % 2 !== 0) {
      throw new Error('Invalid PCM synthesis frame.');
    }

    const samples = pcm16le.byteLength / 2;
    const buffer = context.createBuffer(1, samples, sampleRate);
    const channel = buffer.getChannelData(0);
    const view = new DataView(pcm16le.buffer, pcm16le.byteOffset, pcm16le.byteLength);
    for (let index = 0; index < samples; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 32_768;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startTime = Math.max(context.currentTime, this.nextStartTime);
    this.nextStartTime = startTime + buffer.duration;
    this.scheduled.set(sequence, { source });
    source.onended = () => {
      if (!this.scheduled.delete(sequence)) return;
      this.callbacks.onPlayedThrough(sequence);
      this.notifyIfDrained();
    };
    source.start(startTime);
  }

  markGenerationComplete(): void {
    this.generationComplete = true;
    this.notifyIfDrained();
  }

  async togglePaused(): Promise<boolean> {
    const context = this.context;
    if (context === null) return false;
    if (this.paused) {
      await context.resume();
      if (this.context !== context) return false;
      this.paused = false;
    } else {
      await context.suspend();
      if (this.context !== context) return false;
      this.paused = true;
    }
    return this.paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  stop(): void {
    const context = this.context;
    this.context = null;
    this.generationComplete = false;
    this.nextStartTime = 0;
    this.paused = false;
    for (const { source } of this.scheduled.values()) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source may already have ended between state checks.
      }
      source.disconnect();
    }
    this.scheduled.clear();
    if (context !== null) void context.close();
  }

  private notifyIfDrained(): void {
    if (this.generationComplete && this.scheduled.size === 0) {
      this.callbacks.onDrained();
    }
  }
}
