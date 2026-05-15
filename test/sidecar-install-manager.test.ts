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

function createInstallOptions(
  overrides?: Partial<Parameters<SidecarInstallManager['install']>[0]>,
) {
  return {
    onInstalled: vi.fn(async () => {}),
    pluginDirectory: '/plugin',
    successNotice: 'Installed.',
    variant: 'cpu' as const,
    version: '2026.5.15',
    ...overrides,
  };
}

describe('SidecarInstallManager', () => {
  it('tracks active install progress and exposes shared progress state', () => {
    installSidecarMock.mockImplementationOnce(() => new Promise(() => {}));
    const manager = new SidecarInstallManager({ notice: vi.fn() });
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.install(createInstallOptions());
    const capturedOptions = installSidecarMock.mock.calls[0]?.[0] as
      | InstallSidecarOptions
      | undefined;
    capturedOptions?.onProgress?.({
      bytesDownloaded: 50,
      phase: 'download',
      totalBytes: 100,
    });

    const activeInstall = manager.getState().activeInstall;
    expect(activeInstall).not.toBeNull();
    expect(activeInstall?.progress.bytesDownloaded).toBe(50);
    expect(activeInstall ? buildSidecarProgressState(activeInstall) : null).toMatchObject({
      downloadedBytes: 50,
      isCancelling: false,
      message: 'Downloading',
      totalBytes: 100,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rejects concurrent installs', () => {
    installSidecarMock.mockImplementationOnce(() => new Promise(() => {}));
    const manager = new SidecarInstallManager({ notice: vi.fn() });

    manager.install(createInstallOptions());

    expect(() => {
      manager.install(createInstallOptions());
    }).toThrow('Another sidecar is already being installed.');
  });

  it('cancels the active AbortController', () => {
    installSidecarMock.mockImplementationOnce(() => new Promise(() => {}));
    const manager = new SidecarInstallManager({ notice: vi.fn() });

    manager.install(createInstallOptions());
    const capturedOptions = installSidecarMock.mock.calls[0]?.[0] as
      | InstallSidecarOptions
      | undefined;
    manager.cancel();

    expect(manager.getState().activeInstall?.phase).toBe('canceling');
    expect(capturedOptions?.signal?.aborted).toBe(true);
  });

  it('clears active state and shows success notice after install completes', async () => {
    installSidecarMock.mockResolvedValueOnce({
      manifest: {
        installedAt: '2026-05-03T00:00:00.000Z',
        sha256: 'abc',
        variant: 'cpu',
        version: '2026.5.15',
      },
      variantDirectory: '/plugin/bin/cpu',
    });
    const notice = vi.fn();
    const onInstalled = vi.fn(async () => {});
    const manager = new SidecarInstallManager({ notice });

    manager.install(createInstallOptions({ onInstalled }));
    await vi.waitFor(() => {
      expect(manager.getState().activeInstall).toBeNull();
    });

    expect(onInstalled).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith('Installed.');
    expect(manager.getState().lastError).toBeNull();
  });

  it('records failed install errors after clearing active state', async () => {
    installSidecarMock.mockRejectedValueOnce(new Error('network failed'));
    const notice = vi.fn();
    const manager = new SidecarInstallManager({ notice });

    manager.install(createInstallOptions());
    await vi.waitFor(() => {
      expect(manager.getState().activeInstall).toBeNull();
    });

    expect(manager.getState().lastError).toBe('network failed');
    expect(notice).toHaveBeenCalledWith('Sidecar install failed: network failed');
  });

  it('clears state and notifies on abort error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    installSidecarMock.mockRejectedValueOnce(abortError);
    const notice = vi.fn();
    const manager = new SidecarInstallManager({ notice });

    manager.install(createInstallOptions());
    await vi.waitFor(() => {
      expect(manager.getState().activeInstall).toBeNull();
    });

    expect(notice).toHaveBeenCalledWith('Sidecar install cancelled.');
    expect(manager.getState().lastError).toBeNull();
  });
});
