import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';

import { Platform } from 'obsidian';

export interface SidecarLaunchSpec {
  args?: string[];
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

interface SidecarProcessHandlers {
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onStderrLine: (line: string) => void;
  onStdoutChunk: (chunk: Uint8Array) => void;
}

export type ResolveSidecarLaunchSpec = () => Promise<SidecarLaunchSpec>;

export class SidecarProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private stderrReader: ReadLineInterface | null = null;
  private stdinDead = false;

  constructor(
    private readonly resolveLaunchSpec: ResolveSidecarLaunchSpec,
    private readonly handlers: SidecarProcessHandlers,
  ) {}

  isRunning(): boolean {
    // A child that has been sent a kill signal but has not yet emitted 'exit'
    // still owns the slot: Node sets `child.killed` synchronously inside
    // kill(), well before the OS reaps the process. Treating it as "not
    // running" here would let start() spawn a replacement while the old
    // process is still alive. `exitCode` (and `signalCode` for
    // signal-terminated processes) only flip once 'exit' has actually fired.
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  async start(): Promise<void> {
    if (this.isRunning()) {
      return;
    }

    if (this.startPromise !== null) {
      return this.startPromise;
    }

    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    assertDesktopRuntime();

    const launchSpec = await this.resolveLaunchSpec();
    const child = spawn(launchSpec.command, launchSpec.args ?? [], {
      cwd: launchSpec.cwd,
      env: launchSpec.env ? { ...process.env, ...launchSpec.env } : undefined,
      stdio: 'pipe',
    });

    await waitForSpawn(child);

    this.stdinDead = false;
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      this.stdinDead = true;

      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') {
        this.handlers.onStderrLine(`stdin error: ${error.message} (${error.code})`);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: Uint8Array) => {
      this.handlers.onStdoutChunk(chunk);
    });

    this.child = child;
    this.stderrReader = createInterface({ input: child.stderr });
    this.stderrReader.on('line', this.handlers.onStderrLine);

    child.once('exit', (code, signal) => {
      // Guard against a stale exit: if `this.child` has already moved on to a
      // newer generation (only reachable if a future change weakens the
      // invariants above), this exit belongs to a process we no longer own —
      // clearing shared state or firing onExit here would clobber the
      // replacement.
      if (this.child !== child) {
        return;
      }

      this.disposeReaders();
      child.stdout.removeAllListeners('data');
      this.child = null;
      this.handlers.onExit(code, signal);
    });
  }

  async stop(): Promise<void> {
    const child = this.child;

    if (child === null) {
      return;
    }

    if (child.stdin.writable) {
      child.stdin.end();
    }

    if (child.exitCode !== null) {
      return;
    }

    await waitForExit(child);
  }

  write(frameBytes: Uint8Array): void {
    this.requireWritableChild().stdin.write(frameBytes);
  }

  async writeWithBackpressure(frameBytes: Uint8Array): Promise<void> {
    const child = this.requireWritableChild();
    if (child.stdin.write(frameBytes)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        child.stdin.off('drain', onDrain);
        child.stdin.off('error', onError);
        child.off('exit', onExit);
      };
      const onDrain = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onExit = (): void => {
        cleanup();
        reject(new Error('Sidecar process exited before its audio buffer drained.'));
      };

      child.stdin.once('drain', onDrain);
      child.stdin.once('error', onError);
      child.once('exit', onExit);
    });
  }

  private requireWritableChild(): ChildProcessWithoutNullStreams {
    const child = this.child;
    if (child === null || this.stdinDead || !child.stdin.writable) {
      throw new Error('Sidecar process is not running.');
    }
    return child;
  }

  private disposeReaders(): void {
    this.stderrReader?.close();
    this.stderrReader = null;
  }
}

function assertDesktopRuntime(): void {
  if (!Platform.isDesktopApp) {
    throw new Error('Local Dictation sidecar support requires Obsidian desktop.');
  }
}

async function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      child.off('error', onError);
      child.off('spawn', onSpawn);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onSpawn = () => {
      cleanup();
      resolve();
    };

    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  // stop()'s contract is "the process is gone" -- resolving as soon as we
  // *ask* it to die (rather than waiting for the real 'exit' event) is what
  // let a slow-to-die child outlive stop() and later clobber a replacement
  // spawned in the meantime. Give the process a grace period to exit on its
  // own, then escalate to SIGKILL, but always wait for the actual 'exit'
  // event -- a SIGKILLed process is guaranteed to exit on Linux/macOS.
  await new Promise<void>((resolve) => {
    const timeoutHandle = window.setTimeout(() => {
      child.kill('SIGKILL');
    }, 2_000);

    child.once('exit', () => {
      window.clearTimeout(timeoutHandle);
      resolve();
    });
  });
}
