import { describe, expect, it, vi } from 'vitest';

import type { ModelInstallManager } from '../src/models/model-install-manager';
import { SetupWizardModal } from '../src/setup/setup-wizard-modal';
import type { SidecarInstallManager } from '../src/sidecar/sidecar-install-manager';

describe('SetupWizardModal lifecycle', () => {
  it('does not subscribe or render when the modal closes during its prerequisite check', async () => {
    let resolveInstalled: ((installed: boolean) => void) | undefined;
    const isSidecarInstalled = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveInstalled = resolve;
        }),
    );
    const hasSelectedModel = vi.fn(() => true);
    const subscribe = vi.fn(() => vi.fn());
    const modal = new SetupWizardModal({
      app: {} as never,
      feedback: { show: vi.fn() },
      hasDictationTarget: () => true,
      hasSelectedModel,
      isDictationBusy: () => false,
      isSidecarInstalled,
      modelInstallManager: { subscribe } as unknown as ModelInstallManager,
      onCompleted: vi.fn(async () => {}),
      pluginDirectory: '/plugin',
      pluginVersion: '2026.8.2',
      postSidecarInstalled: vi.fn(async () => {}),
      sidecarConnection: {
        restart: vi.fn(async () => ({
          sidecarVersion: '2026.8.2',
          status: 'ready' as const,
          type: 'health_ok' as const,
        })),
      },
      sidecarInstallManager: {} as SidecarInstallManager,
      sidecarStartupTimeoutMs: 4_000,
      startDictation: vi.fn(async () => {}),
    });

    modal.open();
    expect(isSidecarInstalled).toHaveBeenCalledOnce();
    modal.close();

    resolveInstalled?.(true);
    await Promise.resolve();

    expect(hasSelectedModel).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(modal.contentEl.children).toHaveLength(0);
  });
});
