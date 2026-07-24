import type { App } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelInstallManager } from '../src/models/model-install-manager';
import {
  openSidecarInstallModal,
  type SidecarInstallActionDeps,
} from '../src/settings/sidecar-settings-section';
import { SidecarInstallManager } from '../src/sidecar/sidecar-install-manager';
import type { InstallSidecarOptions } from '../src/sidecar/sidecar-installer';
import { assertSidecarIdle } from '../src/sidecar/sidecar-speech-interlock';
import { Modal, TestElement } from './__mocks__/obsidian';

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

const BECAME_ACTIVE_MESSAGE =
  'Dictation or Read aloud became active before the sidecar operation could finish. Stop Read aloud or dictation. If dictation is still processing, run "Cancel dictation", then retry.';

beforeEach(() => {
  installSidecarMock.mockReset();
  Modal.instances.length = 0;
  vi.stubGlobal('createDiv', () => new TestElement());
  vi.stubGlobal('createFragment', () => new TestElement());
  vi.stubGlobal('createSpan', () => new TestElement());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createHarness() {
  let sidecarInUse = false;
  const feedbackShow = vi.fn();
  const manager = new SidecarInstallManager({ feedback: { show: feedbackShow } });
  const modelInit = vi.fn(async () => {});
  const refreshSettingsTab = vi.fn();
  const replacement = vi.fn();
  const restartConnection = vi.fn(async () => {});
  const restartSidecarWhenIdle = vi.fn(async () => {
    assertSidecarIdle(() => sidecarInUse, BECAME_ACTIVE_MESSAGE);
    await restartConnection();
  });
  const shutdown = vi.fn(async () => {});
  const deps: SidecarInstallActionDeps = {
    app: {} as App,
    feedback: { show: feedbackShow },
    isSidecarInUse: () => sidecarInUse,
    modelInstallManager: { init: modelInit } as unknown as ModelInstallManager,
    pluginVersion: '2026.7.11',
    refreshSettingsTab,
    restartSidecarWhenIdle,
    sidecarConnection: { shutdown },
    sidecarInstallManager: manager,
  };

  return {
    deps,
    feedbackShow,
    manager,
    modelInit,
    refreshSettingsTab,
    replacement,
    restartConnection,
    restartSidecarWhenIdle,
    setSidecarInUse(value: boolean) {
      sidecarInUse = value;
    },
    shutdown,
  };
}

async function startInstallThroughModal(harness: ReturnType<typeof createHarness>) {
  openSidecarInstallModal(harness.deps, {
    intent: 'install',
    pluginDirectory: '/plugin',
    variant: 'cpu',
  });
  const modal = Modal.instances[0];
  expect(modal).toBeDefined();
  const installButton = modal?.contentEl.findByText('Download CPU sidecar');
  expect(installButton).toBeDefined();

  await installButton?.click();
  await vi.waitFor(() => expect(harness.manager.getState().activeInstall).toBeNull());
}

describe('sidecar install interlock integration', () => {
  it('shows actionable recovery when speech starts before replacement', async () => {
    const harness = createHarness();
    installSidecarMock.mockImplementationOnce(async (options: InstallSidecarOptions) => {
      harness.setSidecarInUse(true);
      await options.beforeReplace?.();
      harness.replacement();
      return successfulInstallResult();
    });

    await startInstallThroughModal(harness);

    expect(harness.shutdown).not.toHaveBeenCalled();
    expect(harness.replacement).not.toHaveBeenCalled();
    expect(harness.restartSidecarWhenIdle).not.toHaveBeenCalled();
    expect(harness.modelInit).not.toHaveBeenCalled();
    expect(harness.refreshSettingsTab).not.toHaveBeenCalled();
    expect(harness.manager.getState().lastError).toBeNull();
    expect(harness.feedbackShow).toHaveBeenCalledOnce();
    expect(harness.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message: BECAME_ACTIVE_MESSAGE,
    });
  });

  it('defers restart and success when speech starts after replacement', async () => {
    const harness = createHarness();
    installSidecarMock.mockImplementationOnce(async (options: InstallSidecarOptions) => {
      await options.beforeReplace?.();
      harness.replacement();
      harness.setSidecarInUse(true);
      return successfulInstallResult();
    });

    await startInstallThroughModal(harness);

    expect(harness.shutdown).toHaveBeenCalledOnce();
    expect(harness.replacement).toHaveBeenCalledOnce();
    expect(harness.restartSidecarWhenIdle).toHaveBeenCalledOnce();
    expect(harness.restartConnection).not.toHaveBeenCalled();
    expect(harness.modelInit).not.toHaveBeenCalled();
    expect(harness.refreshSettingsTab).not.toHaveBeenCalled();
    expect(harness.manager.getState().lastError).toBeNull();
    expect(harness.feedbackShow).toHaveBeenCalledOnce();
    expect(harness.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message: BECAME_ACTIVE_MESSAGE,
    });
  });
});

function successfulInstallResult() {
  return {
    manifest: {
      installedAt: '2026-07-24T00:00:00.000Z',
      sha256: 'abc',
      variant: 'cpu' as const,
      version: '2026.7.11',
    },
    variantDirectory: '/plugin/bin/cpu',
  };
}
