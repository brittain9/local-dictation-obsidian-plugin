import { beforeEach, describe, expect, it, vi } from 'vitest';

const { installSidecarMock } = vi.hoisted(() => ({
  installSidecarMock: vi.fn(),
}));

vi.mock('../src/sidecar/sidecar-installer', async () => {
  const actual = await vi.importActual<typeof import('../src/sidecar/sidecar-installer')>(
    '../src/sidecar/sidecar-installer',
  );

  return {
    ...actual,
    installSidecar: installSidecarMock,
  };
});

import {
  buildSidecarProgressState,
  SidecarInstallManager,
} from '../src/sidecar/sidecar-install-manager';
import type { InstallSidecarOptions } from '../src/sidecar/sidecar-installer';

beforeEach(() => {
  installSidecarMock.mockReset();
});

function defaultInstallOptions() {
  return {
    onInstalled: vi.fn(async () => {}),
    pluginDirectory: '/plugin',
    successNotice: 'Installed.',
    variant: 'cpu' as const,
    version: '2026.5.16',
  };
}

function successfulInstallResult(variant: 'cpu' | 'cuda' = 'cpu') {
  return {
    manifest: {
      installedAt: '2026-05-03T00:00:00.000Z',
      sha256: 'abc',
      variant,
      version: '2026.5.16',
    },
    variantDirectory: `/plugin/bin/${variant}`,
  };
}

describe('SidecarInstallManager', () => {
  it('rejects concurrent installs while one is in flight', () => {
    installSidecarMock.mockImplementationOnce(() => new Promise(() => {}));
    const manager = new SidecarInstallManager({ notice: vi.fn() });

    manager.install(defaultInstallOptions());

    expect(() => manager.install(defaultInstallOptions())).toThrow(
      'Another sidecar is already being installed.',
    );
  });

  it('aborts the installer signal when cancel is called and marks phase canceling', () => {
    installSidecarMock.mockImplementationOnce(() => new Promise(() => {}));
    const manager = new SidecarInstallManager({ notice: vi.fn() });

    manager.install(defaultInstallOptions());
    const captured = installSidecarMock.mock.calls[0]?.[0] as InstallSidecarOptions | undefined;
    manager.cancel();

    expect(captured?.signal?.aborted).toBe(true);
    expect(manager.getState().activeInstall?.phase).toBe('canceling');
  });

  it('clears state, invokes the onInstalled hook, and shows the success notice', async () => {
    installSidecarMock.mockResolvedValueOnce(successfulInstallResult());
    const notice = vi.fn();
    const onInstalled = vi.fn(async () => {});
    const manager = new SidecarInstallManager({ notice });

    manager.install({ ...defaultInstallOptions(), onInstalled });
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(onInstalled).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith('Installed.');
    expect(manager.getState().lastError).toBeNull();
  });

  it('allows a second install after the first completes successfully', async () => {
    installSidecarMock
      .mockResolvedValueOnce(successfulInstallResult('cpu'))
      .mockResolvedValueOnce(successfulInstallResult('cuda'));
    const notice = vi.fn();
    const firstInstalled = vi.fn(async () => {});
    const secondInstalled = vi.fn(async () => {});
    const manager = new SidecarInstallManager({ notice });

    manager.install({
      ...defaultInstallOptions(),
      onInstalled: firstInstalled,
      successNotice: 'CPU installed.',
      variant: 'cpu',
    });
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    manager.install({
      ...defaultInstallOptions(),
      onInstalled: secondInstalled,
      successNotice: 'CUDA installed.',
      variant: 'cuda',
    });
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(installSidecarMock).toHaveBeenCalledTimes(2);
    expect(firstInstalled).toHaveBeenCalledOnce();
    expect(secondInstalled).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenNthCalledWith(1, 'CPU installed.');
    expect(notice).toHaveBeenNthCalledWith(2, 'CUDA installed.');
    expect(manager.getState().lastError).toBeNull();
  });

  it('installs a variant batch in order with intermediate and final hooks', async () => {
    installSidecarMock
      .mockResolvedValueOnce(successfulInstallResult('cpu'))
      .mockResolvedValueOnce(successfulInstallResult('cuda'));
    const notice = vi.fn();
    const onInstalled = vi.fn(async () => {});
    const onVariantInstalled = vi.fn(async () => {});
    const manager = new SidecarInstallManager({ notice });

    manager.installBatch({
      ...defaultInstallOptions(),
      onInstalled,
      onVariantInstalled,
      successNotice: 'Sidecars updated.',
      variants: ['cpu', 'cuda'],
    });
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(installSidecarMock.mock.calls.map(([options]) => options.variant)).toEqual([
      'cpu',
      'cuda',
    ]);
    expect(onVariantInstalled).toHaveBeenCalledOnce();
    expect(onVariantInstalled).toHaveBeenCalledWith('cpu');
    expect(onInstalled).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith('Sidecars updated.');
  });

  it('continues the batch when an intermediate restart fails', async () => {
    installSidecarMock
      .mockResolvedValueOnce(successfulInstallResult('cpu'))
      .mockResolvedValueOnce(successfulInstallResult('cuda'));
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const onInstalled = vi.fn(async () => {});
    const manager = new SidecarInstallManager({ logger, notice: vi.fn() });

    manager.installBatch({
      ...defaultInstallOptions(),
      onInstalled,
      onVariantInstalled: vi.fn(async () => {
        throw new Error('stale CUDA could not restart');
      }),
      variants: ['cpu', 'cuda'],
    });
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(installSidecarMock).toHaveBeenCalledTimes(2);
    expect(onInstalled).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'installer',
      'intermediate restart after cpu sidecar update failed; continuing batch',
      expect.any(Error),
    );
  });

  it('exposes the current variant and batch position while installing', async () => {
    let resolveCpu: ((value: ReturnType<typeof successfulInstallResult>) => void) | undefined;
    installSidecarMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCpu = resolve;
        }),
    );
    const manager = new SidecarInstallManager({ notice: vi.fn() });

    manager.installBatch({
      ...defaultInstallOptions(),
      variants: ['cpu', 'cuda'],
    });

    const active = manager.getState().activeInstall;
    expect(active).toMatchObject({
      currentVariantNumber: 1,
      totalVariants: 2,
      variant: 'cpu',
    });
    expect(active === null ? null : buildSidecarProgressState(active).message).toBe(
      'Downloading CPU sidecar (1 of 2)',
    );

    resolveCpu?.(successfulInstallResult('cpu'));
    await vi.waitFor(() => expect(installSidecarMock).toHaveBeenCalledTimes(2));
  });

  it('stops a batch after the failing variant without running final initialization', async () => {
    installSidecarMock
      .mockResolvedValueOnce(successfulInstallResult('cpu'))
      .mockRejectedValueOnce(new Error('CUDA download failed'));
    const notice = vi.fn();
    const onInstalled = vi.fn(async () => {});
    const manager = new SidecarInstallManager({ notice });

    manager.installBatch({
      ...defaultInstallOptions(),
      onInstalled,
      variants: ['cpu', 'cuda'],
    });
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(installSidecarMock).toHaveBeenCalledTimes(2);
    expect(onInstalled).not.toHaveBeenCalled();
    expect(manager.getState().lastError).toBe('CUDA download failed');
    expect(notice).toHaveBeenCalledWith('Sidecar install failed: CUDA download failed');
  });

  it('deduplicates variants and rejects an empty batch', async () => {
    installSidecarMock.mockResolvedValueOnce(successfulInstallResult('cpu'));
    const manager = new SidecarInstallManager({ notice: vi.fn() });

    expect(() =>
      manager.installBatch({
        ...defaultInstallOptions(),
        variants: [],
      }),
    ).toThrow('At least one sidecar variant is required.');

    manager.installBatch({
      ...defaultInstallOptions(),
      variants: ['cpu', 'cpu'],
    });
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(installSidecarMock).toHaveBeenCalledOnce();
  });

  it('records install failures and clears active state', async () => {
    installSidecarMock.mockRejectedValueOnce(new Error('network failed'));
    const notice = vi.fn();
    const manager = new SidecarInstallManager({ notice });

    manager.install(defaultInstallOptions());
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(manager.getState().lastError).toBe('network failed');
    expect(notice).toHaveBeenCalledWith('Sidecar install failed: network failed');
  });

  it('treats AbortError as a user-initiated cancel, not a failure', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    installSidecarMock.mockRejectedValueOnce(abortError);
    const notice = vi.fn();
    const manager = new SidecarInstallManager({ notice });

    manager.install(defaultInstallOptions());
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(notice).toHaveBeenCalledWith('Sidecar install cancelled.');
    expect(manager.getState().lastError).toBeNull();
  });
});
