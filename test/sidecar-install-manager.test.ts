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

import { SidecarInstallManager } from '../src/sidecar/sidecar-install-manager';
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
    installSidecarMock.mockResolvedValueOnce({
      manifest: {
        installedAt: '2026-05-03T00:00:00.000Z',
        sha256: 'abc',
        variant: 'cpu',
        version: '2026.5.16',
      },
      variantDirectory: '/plugin/bin/cpu',
    });
    const notice = vi.fn();
    const onInstalled = vi.fn(async () => {});
    const manager = new SidecarInstallManager({ notice });

    manager.install({ ...defaultInstallOptions(), onInstalled });
    await vi.waitFor(() => expect(manager.getState().activeInstall).toBeNull());

    expect(onInstalled).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith('Installed.');
    expect(manager.getState().lastError).toBeNull();
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
