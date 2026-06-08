import { spawn } from 'node:child_process';

export type NvidiaDriverStatus = 'present' | 'absent' | 'unknown';

const PROBE_TIMEOUT_MS = 3_000;

export async function detectNvidiaDriver(): Promise<NvidiaDriverStatus> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (status: NvidiaDriverStatus): void => {
      if (settled) return;
      settled = true;
      resolve(status);
    };

    let child: ReturnType<typeof spawn>;

    try {
      child = spawn('nvidia-smi', ['-L'], { stdio: 'ignore', windowsHide: true });
    } catch {
      settle('absent');
      return;
    }

    const timeoutHandle = window.setTimeout(() => {
      child.kill();
      settle('unknown');
    }, PROBE_TIMEOUT_MS);

    child.once('error', (error: NodeJS.ErrnoException) => {
      window.clearTimeout(timeoutHandle);
      settle(error.code === 'ENOENT' ? 'absent' : 'unknown');
    });

    child.once('exit', (code) => {
      window.clearTimeout(timeoutHandle);
      settle(code === 0 ? 'present' : 'unknown');
    });
  });
}
