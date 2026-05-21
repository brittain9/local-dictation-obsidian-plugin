import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const { spawn } = await import('node:child_process');
const { detectNvidiaDriver } = await import('../src/sidecar/gpu-precheck');

class FakeChild extends EventEmitter {
  kill = vi.fn();
}

const mockedSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

function queueChild(): FakeChild {
  const child = new FakeChild();
  mockedSpawn.mockReturnValueOnce(child);
  return child;
}

beforeEach(() => {
  mockedSpawn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('detectNvidiaDriver', () => {
  it('returns "present" when nvidia-smi exits successfully', async () => {
    const child = queueChild();
    const promise = detectNvidiaDriver();
    child.emit('exit', 0, null);
    await expect(promise).resolves.toBe('present');
  });

  it('returns "absent" when nvidia-smi is not on PATH (ENOENT)', async () => {
    const child = queueChild();
    const promise = detectNvidiaDriver();
    child.emit(
      'error',
      Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException,
    );
    await expect(promise).resolves.toBe('absent');
  });

  it('returns "unknown" when nvidia-smi is installed but reports an error', async () => {
    const child = queueChild();
    const promise = detectNvidiaDriver();
    child.emit('exit', 1, null);
    await expect(promise).resolves.toBe('unknown');
  });
});
