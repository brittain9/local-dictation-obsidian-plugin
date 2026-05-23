import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ErrorEvent,
  encodeJsonFrame,
  type ModelInstallUpdateEvent,
  type SidecarEvent,
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

  deliver(event: SidecarEvent): void {
    this.handlers?.onStdoutChunk(encodeJsonFrame(event));
  }

  exit(code: number | null = 1, signal: NodeJS.Signals | null = null): void {
    this.running = false;
    this.handlers?.onExit(code, signal);
  }
}

function createHarness(timeoutMs = 5_000): {
  connection: SidecarConnection;
  process: FakeSidecarProcess;
} {
  const process = new FakeSidecarProcess();
  const resolveLaunchSpec: ResolveSidecarLaunchSpec = async () => ({
    command: '/tmp/local-dictation-sidecar-test',
  });
  const connection = new SidecarConnection({
    createProcess: (_resolve, handlers) => process.attach(handlers),
    getRequestTimeoutMs: () => timeoutMs,
    resolveLaunchSpec,
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
});
