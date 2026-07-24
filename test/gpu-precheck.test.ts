import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const { spawn } = await import('node:child_process');
const {
  classifyCudaCompatibility,
  CUDA_PROBE_OUTPUT_LIMIT_BYTES,
  detectCudaCompatibility,
  isCudaReleaseTarget,
  parseCudaProbeOutput,
} = await import('../src/sidecar/gpu-precheck');

class FakeChild extends EventEmitter {
  kill = vi.fn();
  stdout = new EventEmitter();
}

const mockedSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
const originalPlatform = process.platform;
const originalArch = process.arch;

function queueChild(): FakeChild {
  const child = new FakeChild();
  mockedSpawn.mockReturnValueOnce(child);
  return child;
}

function setTarget(platform: NodeJS.Platform, arch: string): void {
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
}

beforeEach(() => {
  mockedSpawn.mockReset();
  setTarget('linux', 'x64');
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  Object.defineProperty(process, 'arch', { value: originalArch });
});

describe('CUDA release targets', () => {
  it.each([
    ['linux', 'x64', true],
    ['win32', 'x64', true],
    ['darwin', 'arm64', false],
    ['linux', 'arm64', false],
    ['win32', 'arm64', false],
    ['freebsd', 'x64', false],
  ] as const)('supports %s %s: %s', (platform, arch, expected) => {
    expect(isCudaReleaseTarget(platform, arch)).toBe(expected);
  });
});

describe('parseCudaProbeOutput', () => {
  it.each([
    ['579.99, 7.5', { driverVersion: '579.99', computeCapabilities: ['7.5'] }],
    ['580.12.01,8.9', { driverVersion: '580.12.01', computeCapabilities: ['8.9'] }],
    [
      '581.0, 10.0\r\n581.0, 12.1\r\n',
      {
        driverVersion: '581.0',
        computeCapabilities: ['10.0', '12.1'],
      },
    ],
    ['  580.0 , 7.5  \n', { driverVersion: '580.0', computeCapabilities: ['7.5'] }],
  ])('parses supported CSV output %j', (output, expected) => {
    expect(parseCudaProbeOutput(output)).toEqual(expected);
  });

  it.each([
    '',
    '   \r\n',
    '580.0',
    '580.0, 7.5, extra',
    'N/A, 7.5',
    '580.0, N/A',
    '580, 7',
    '999999999999999999999999999999, 7.5',
    '580.0, 999999999999999999999999999999.0',
    'driver_version, compute_cap',
    '580.0, 7.5\n581.0, 8.9',
  ])('rejects malformed or untrustworthy output %j', (output) => {
    expect(parseCudaProbeOutput(output)).toBeNull();
  });
});

describe('classifyCudaCompatibility', () => {
  it.each([
    ['579.99', ['8.9'], 'incompatible_driver'],
    ['580.0', ['7.4'], 'incompatible_gpu'],
    ['580.0', ['7.5'], 'compatible'],
    ['580.0', ['7.4', '8.9'], 'compatible'],
    ['581.0.1', ['10.0', '12.1'], 'compatible'],
  ] as const)(
    'classifies driver %s and GPUs %j as %s',
    (driverVersion, computeCapabilities, status) => {
      expect(classifyCudaCompatibility({ driverVersion, computeCapabilities })).toMatchObject({
        computeCapabilities,
        driverVersion,
        status,
      });
    },
  );
});

describe('detectCudaCompatibility', () => {
  it('queries driver and compute capability without a shell and collects stdout', async () => {
    const child = queueChild();
    const promise = detectCudaCompatibility();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'nvidia-smi',
      ['--query-gpu=driver_version,compute_cap', '--format=csv,noheader,nounits'],
      { shell: false, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );

    child.stdout.emit('data', Buffer.from('580.12, 7.5\n'));
    child.emit('exit', 0, null);

    await expect(promise).resolves.toEqual({
      computeCapabilities: ['7.5'],
      driverVersion: '580.12',
      status: 'compatible',
    });
  });

  it('returns absent when nvidia-smi is not on PATH', async () => {
    const child = queueChild();
    const promise = detectCudaCompatibility();
    child.emit(
      'error',
      Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException,
    );
    await expect(promise).resolves.toEqual({ status: 'absent' });
  });

  it('returns unknown when spawning nvidia-smi throws', async () => {
    mockedSpawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });

    await expect(detectCudaCompatibility()).resolves.toEqual({ status: 'unknown' });
  });

  it.each([
    ['non-zero exit', (child: FakeChild) => child.emit('exit', 1, null)],
    ['signal exit', (child: FakeChild) => child.emit('exit', null, 'SIGTERM')],
    ['unexpected process error', (child: FakeChild) => child.emit('error', new Error('denied'))],
    [
      'malformed output',
      (child: FakeChild) => {
        child.stdout.emit('data', '580.0, N/A\n');
        child.emit('exit', 0, null);
      },
    ],
  ])('returns unknown on %s', async (_case, emit) => {
    const child = queueChild();
    const promise = detectCudaCompatibility();
    emit(child);
    await expect(promise).resolves.toEqual({ status: 'unknown' });
  });

  it('kills and returns unknown when the probe times out', async () => {
    vi.useFakeTimers();
    const child = queueChild();
    const promise = detectCudaCompatibility();

    await vi.advanceTimersByTimeAsync(3_000);

    expect(child.kill).toHaveBeenCalledOnce();
    await expect(promise).resolves.toEqual({ status: 'unknown' });
  });

  it('kills and returns unknown when stdout exceeds the bound', async () => {
    const child = queueChild();
    const promise = detectCudaCompatibility();

    child.stdout.emit('data', Buffer.alloc(CUDA_PROBE_OUTPUT_LIMIT_BYTES + 1));

    expect(child.kill).toHaveBeenCalledOnce();
    await expect(promise).resolves.toEqual({ status: 'unknown' });
  });

  it('settles once and clears the timeout across error, exit, and timeout races', async () => {
    vi.useFakeTimers();
    const child = queueChild();
    const settled = vi.fn();
    const promise = detectCudaCompatibility().then((result) => {
      settled(result);
      return result;
    });

    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(promise).resolves.toEqual({ status: 'absent' });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles once when timeout wins an exit and error race', async () => {
    vi.useFakeTimers();
    const child = queueChild();
    const settled = vi.fn();
    const promise = detectCudaCompatibility().then((result) => {
      settled(result);
      return result;
    });

    await vi.advanceTimersByTimeAsync(3_000);
    child.emit('exit', 0, null);
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    child.emit('close', 0, null);

    await expect(promise).resolves.toEqual({ status: 'unknown' });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.stdout.listenerCount('data')).toBe(0);
  });

  it.each([
    ['darwin', 'arm64'],
    ['linux', 'arm64'],
    ['win32', 'arm64'],
  ] as const)('does not spawn on unsupported %s %s', async (platform, arch) => {
    setTarget(platform, arch);

    await expect(detectCudaCompatibility()).resolves.toEqual({ status: 'unsupported' });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });
});
