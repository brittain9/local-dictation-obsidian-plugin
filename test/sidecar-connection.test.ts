import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ErrorEvent,
  encodeJsonFrame,
  FRAME_HEADER_LENGTH,
  type HealthOkEvent,
  MAX_FRAME_PAYLOAD_BYTES,
  type ModelInstallUpdateEvent,
  type SidecarEvent,
  type TranscriptReadyEvent,
  type WarningEvent,
} from '../src/sidecar/protocol';
import { SidecarConnection, type SidecarError } from '../src/sidecar/sidecar-connection';
import type { ResolveSidecarLaunchSpec } from '../src/sidecar/sidecar-process';

interface SidecarProcessHandlers {
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onStderrLine: (line: string) => void;
  onStdoutChunk: (chunk: Uint8Array) => void;
}

class FakeSidecarProcess {
  readonly writtenFrames: Uint8Array[] = [];
  startCalls = 0;
  stopCalls = 0;
  private handlers: SidecarProcessHandlers | null = null;
  private running = false;

  attach(handlers: SidecarProcessHandlers): this {
    this.handlers = handlers;
    return this;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.startCalls += 1;
    this.running = true;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.running = false;
  }

  write(frameBytes: Uint8Array): void {
    if (!this.running) {
      throw new Error('Fake sidecar process is not running.');
    }
    this.writtenFrames.push(frameBytes);
  }

  async writeWithBackpressure(frameBytes: Uint8Array): Promise<void> {
    this.write(frameBytes);
  }

  deliver(event: SidecarEvent): void {
    this.handlers?.onStdoutChunk(encodeJsonFrame(event));
  }

  exit(code: number | null = 1, signal: NodeJS.Signals | null = null): void {
    this.running = false;
    this.handlers?.onExit(code, signal);
  }

  stderr(line: string): void {
    this.handlers?.onStderrLine(line);
  }

  stdout(chunk: Uint8Array): void {
    this.handlers?.onStdoutChunk(chunk);
  }
}

function createHarness(
  timeoutMs = 5_000,
  logger?: ConstructorParameters<typeof SidecarConnection>[0]['logger'],
): {
  connection: SidecarConnection;
  process: FakeSidecarProcess;
} {
  const process = new FakeSidecarProcess();
  const resolveLaunchSpec: ResolveSidecarLaunchSpec = async () => ({
    command: '/tmp/local-dictation-sidecar-test',
  });
  const options: ConstructorParameters<typeof SidecarConnection>[0] = {
    createProcess: (_resolve, handlers) => process.attach(handlers),
    getRequestTimeoutMs: () => timeoutMs,
    resolveLaunchSpec,
  };
  if (logger !== undefined) {
    options.logger = logger;
  }
  const connection = new SidecarConnection({
    ...options,
  });

  return { connection, process };
}

function modelInstallUpdate(
  overrides: Partial<ModelInstallUpdateEvent> = {},
): ModelInstallUpdateEvent {
  return {
    details: null,
    downloadedBytes: null,
    familyId: 'whisper',
    installId: 'install-1',
    message: null,
    modelId: 'small',
    runtimeId: 'whisper_cpp',
    state: 'queued',
    totalBytes: null,
    type: 'model_install_update',
    ...overrides,
  };
}

function warningEvent(overrides: Partial<WarningEvent> = {}): WarningEvent {
  return {
    code: 'queue_lag',
    message: 'queue lag detected',
    type: 'warning',
    ...overrides,
  };
}

function errorEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    code: 'invalid_frame',
    message: 'invalid frame',
    type: 'error',
    ...overrides,
  };
}

function healthOkEvent(overrides: Partial<HealthOkEvent> = {}): HealthOkEvent {
  return {
    sidecarVersion: '0.0.0-test',
    status: 'ready',
    type: 'health_ok',
    ...overrides,
  };
}

function readJsonPayload(frame: Uint8Array): unknown {
  const payloadLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(
    1,
    true,
  );
  return JSON.parse(
    new TextDecoder().decode(frame.slice(FRAME_HEADER_LENGTH, FRAME_HEADER_LENGTH + payloadLength)),
  );
}

function transcriptReadyEvent(overrides: Partial<TranscriptReadyEvent> = {}): TranscriptReadyEvent {
  return {
    isFinal: true,
    pauseMsBeforeUtterance: null,
    processingDurationMs: 12,
    revision: 0,
    segments: [],
    sessionId: 'session-1',
    speakerIndex: null,
    stageResults: [],
    text: 'hello',
    type: 'transcript_ready',
    utteranceDurationMs: 1000,
    utteranceEndMsInSession: 1000,
    utteranceId: 'utterance-1',
    utteranceIndex: 0,
    utteranceStartMsInSession: 0,
    warnings: [],
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SidecarConnection', () => {
  it('resolves a waiter only after the matching correlated event arrives', async () => {
    const { connection, process } = createHarness();

    const resultPromise = connection.installModel({
      familyId: 'whisper',
      installId: 'install-1',
      modelId: 'small',
      runtimeId: 'whisper_cpp',
    });
    await flushMicrotasks();

    process.deliver(modelInstallUpdate({ installId: 'install-2' }));
    process.deliver(modelInstallUpdate({ installId: 'install-1' }));

    await expect(resultPromise).resolves.toMatchObject({
      installId: 'install-1',
      state: 'queued',
      type: 'model_install_update',
    });
    expect(process.startCalls).toBe(1);
    expect(process.writtenFrames).toHaveLength(1);
  });

  it('probes system audio with the dedicated command and result event', async () => {
    const { connection, process } = createHarness();

    const resultPromise = connection.probeSystemAudio();
    await flushMicrotasks();

    expect(readJsonPayload(process.writtenFrames[0] ?? new Uint8Array())).toEqual({
      type: 'probe_system_audio',
    });

    process.deliver({ ok: true, type: 'system_audio_probe_result' });

    await expect(resultPromise).resolves.toEqual({ ok: true, type: 'system_audio_probe_result' });
  });

  it('notifies subscribed listeners until they unsubscribe', () => {
    const { connection, process } = createHarness();
    const listener = vi.fn();
    const unsubscribe = connection.subscribe(listener);

    process.deliver(warningEvent({ message: 'first' }));
    unsubscribe();
    process.deliver(warningEvent({ message: 'second' }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(warningEvent({ message: 'first' }));
  });

  it('writes file audio through the backpressure-aware process boundary', async () => {
    const { connection, process } = createHarness();
    await connection.ensureStarted();

    await connection.sendAudioFrameWithBackpressure(
      crypto.randomUUID(),
      new Uint8Array(640).fill(3),
    );

    expect(process.writtenFrames).toHaveLength(1);
    expect(process.writtenFrames[0]?.byteLength).toBeGreaterThan(640);
  });

  it('rejects a waiter when the matching event times out', async () => {
    vi.useFakeTimers();
    const { connection } = createHarness(1_000);

    const resultPromise = connection.healthCheck();
    const assertion = expect(resultPromise).rejects.toThrow(
      'Timed out waiting for sidecar event: health_ok',
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
  });

  it('rejects a pending waiter when the sidecar exits mid-request', async () => {
    const { connection, process } = createHarness();

    const resultPromise = connection.healthCheck();
    await flushMicrotasks();
    process.exit(1, null);

    await expect(resultPromise).rejects.toThrow(
      'Sidecar exited unexpectedly (code: 1, signal: null).',
    );
  });

  it('rejects waiters on error events using SidecarError details', async () => {
    const { connection, process } = createHarness();

    const resultPromise = connection.healthCheck();
    await flushMicrotasks();
    process.deliver(
      errorEvent({
        code: 'invalid_frame',
        details: 'bad length',
        message: 'Invalid frame',
      }),
    );

    await expect(resultPromise).rejects.toMatchObject({
      code: 'invalid_frame',
      details: 'bad length',
      message: 'Invalid frame (bad length)',
      name: 'SidecarError',
    } satisfies Partial<SidecarError>);
  });

  it('drains waiters during shutdown without writing a wire-level shutdown command', async () => {
    const { connection, process } = createHarness();

    const resultPromise = connection.healthCheck();
    const assertion = expect(resultPromise).rejects.toThrow('Sidecar is shutting down.');
    await flushMicrotasks();
    expect(process.writtenFrames).toHaveLength(1);

    await connection.shutdown();

    await assertion;
    expect(process.stopCalls).toBe(1);
    expect(process.writtenFrames).toHaveLength(1);
  });

  it('keeps restart waiter cleanup isolated from the new process', async () => {
    const { connection, process } = createHarness();

    const stalePromise = connection.getSystemInfo();
    const staleAssertion = expect(stalePromise).rejects.toThrow('Sidecar is shutting down.');
    await flushMicrotasks();
    expect(process.writtenFrames).toHaveLength(1);

    const restartPromise = connection.restart();
    await vi.waitFor(() => expect(process.writtenFrames).toHaveLength(2));
    process.deliver(healthOkEvent());

    await expect(restartPromise).resolves.toMatchObject({
      status: 'ready',
      type: 'health_ok',
    });
    await staleAssertion;
    expect(process.startCalls).toBe(2);
    expect(process.stopCalls).toBe(1);
  });

  it('does not start the sidecar just to cancel a stale model install', async () => {
    const { connection, process } = createHarness();

    await connection.cancelModelInstall('install-1');

    expect(process.startCalls).toBe(0);
    expect(process.writtenFrames).toHaveLength(0);
  });

  it('does not mirror routine session lifecycle or transcript events into protocol logs', () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    const { connection, process } = createHarness(5_000, logger);
    const listener = vi.fn();
    connection.subscribe(listener);

    process.deliver({ mode: 'always_on', sessionId: 'session-1', type: 'session_started' });
    process.deliver({ sessionId: 'session-1', state: 'listening', type: 'session_state_changed' });
    process.deliver(transcriptReadyEvent({ isFinal: false, revision: 1 }));
    process.deliver(transcriptReadyEvent({ isFinal: true, revision: 2, text: 'hello world' }));
    process.deliver({ reason: 'user_stop', sessionId: 'session-1', type: 'session_stopped' });

    expect(listener).toHaveBeenCalledTimes(5);
    expect(listener).toHaveBeenLastCalledWith({
      reason: 'user_stop',
      sessionId: 'session-1',
      type: 'session_stopped',
    });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs fatal protocol corruption and stops the sidecar', () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    const { process } = createHarness(5_000, logger);
    const corruptHeader = new Uint8Array(FRAME_HEADER_LENGTH);
    corruptHeader[0] = 1;
    new DataView(corruptHeader.buffer).setUint32(1, MAX_FRAME_PAYLOAD_BYTES + 1, true);

    process.stdout(corruptHeader);

    expect(logger.warn).toHaveBeenCalledWith(
      'protocol',
      'fatal sidecar stream error; restarting',
      expect.any(Error),
    );
    expect(process.stopCalls).toBe(1);
  });

  it('keeps native warnings, system-audio diagnostics, and unexpected exits observable', () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    const { process } = createHarness(5_000, logger);

    process.stderr('system-audio diagnostics: received=42 silent=0 dropped=0 mixed=42 mic_only=0');
    process.stderr('error: native worker failed');
    process.exit(9, null);

    expect(logger.debug).toHaveBeenCalledWith(
      'sidecar',
      'sidecar: system-audio diagnostics: received=42 silent=0 dropped=0 mixed=42 mic_only=0',
    );
    expect(logger.warn).toHaveBeenCalledWith('sidecar', 'sidecar: error: native worker failed');
    expect(logger.warn).toHaveBeenCalledWith(
      'sidecar',
      'sidecar process exited unexpectedly (code: 9, signal: null)',
    );
  });
});
