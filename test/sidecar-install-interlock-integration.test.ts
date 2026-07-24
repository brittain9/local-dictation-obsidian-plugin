import type { App } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelInstallManager } from '../src/models/model-install-manager';
import {
  openSidecarInstallModal,
  type SidecarInstallActionDeps,
} from '../src/settings/sidecar-settings-section';
import type { UserFeedback } from '../src/shared/user-feedback';
import { SidecarInstallManager } from '../src/sidecar/sidecar-install-manager';
import type { InstallSidecarOptions } from '../src/sidecar/sidecar-installer';
import {
  SidecarLifecycleConflictError,
  SidecarLifecycleGate,
} from '../src/sidecar/sidecar-lifecycle-gate';
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
  const feedbackShow = vi.fn();
  const sidecarLifecycleGate = new SidecarLifecycleGate();
  const manager = new SidecarInstallManager({
    feedback: { show: feedbackShow },
    sidecarLifecycleGate,
  });
  const modelInit = vi.fn(async () => {});
  const refreshSettingsTab = vi.fn();
  const replacement = vi.fn();
  const restartSidecar = vi.fn(async () => {});
  const shutdown = vi.fn(async () => {});
  const deps: SidecarInstallActionDeps = {
    app: {} as App,
    feedback: { show: feedbackShow },
    modelInstallManager: { init: modelInit } as unknown as ModelInstallManager,
    pluginVersion: '2026.7.11',
    refreshSettingsTab,
    restartSidecar,
    sidecarConnection: { shutdown },
    sidecarInstallManager: manager,
    sidecarLifecycleGate,
  };

  return {
    deps,
    feedbackShow,
    manager,
    modelInit,
    refreshSettingsTab,
    replacement,
    restartSidecar,
    shutdown,
    sidecarLifecycleGate,
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

function attemptSpeechStart(
  gate: SidecarLifecycleGate,
  feedback: Pick<UserFeedback, 'show'>,
): boolean {
  try {
    const speech = gate.acquireSpeech();
    speech.release();
    return true;
  } catch (error) {
    if (!(error instanceof SidecarLifecycleConflictError)) throw error;
    feedback.show({
      intent: 'warning',
      key: 'sidecar-maintenance',
      message:
        'The speech engine is being installed or restarted. Wait for it to finish, then try again.',
    });
    return false;
  }
}

describe('sidecar install lifecycle interlock', () => {
  it('lets download finish but refuses replacement while speech is active', async () => {
    const harness = createHarness();
    const speech = harness.sidecarLifecycleGate.acquireSpeech();
    installSidecarMock.mockImplementationOnce(async (options: InstallSidecarOptions) => {
      await options.beforeReplace?.();
      harness.replacement();
      return successfulInstallResult();
    });

    await startInstallThroughModal(harness);

    expect(harness.shutdown).not.toHaveBeenCalled();
    expect(harness.replacement).not.toHaveBeenCalled();
    expect(harness.restartSidecar).not.toHaveBeenCalled();
    expect(harness.modelInit).not.toHaveBeenCalled();
    expect(harness.refreshSettingsTab).not.toHaveBeenCalled();
    expect(harness.manager.getState().lastError).toBeNull();
    expect(harness.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message:
        'Stop dictation or Read aloud before installing a sidecar — the install restarts the engine. If dictation is still processing, run "Cancel dictation" to stop it now.',
    });
    speech.release();
  });

  it('refuses speech during shutdown and restart while completing a promoted install', async () => {
    const harness = createHarness();
    const speechAttempts: boolean[] = [];
    harness.shutdown.mockImplementationOnce(async () => {
      speechAttempts.push(
        attemptSpeechStart(harness.sidecarLifecycleGate, { show: harness.feedbackShow }),
      );
    });
    harness.restartSidecar.mockImplementationOnce(async () => {
      speechAttempts.push(
        attemptSpeechStart(harness.sidecarLifecycleGate, { show: harness.feedbackShow }),
      );
    });
    installSidecarMock.mockImplementationOnce(async (options: InstallSidecarOptions) => {
      await options.beforeReplace?.();
      harness.replacement();
      return successfulInstallResult();
    });

    await startInstallThroughModal(harness);

    expect(speechAttempts).toEqual([false, false]);
    expect(harness.shutdown).toHaveBeenCalledOnce();
    expect(harness.replacement).toHaveBeenCalledOnce();
    expect(harness.restartSidecar).toHaveBeenCalledOnce();
    expect(harness.modelInit).toHaveBeenCalledOnce();
    expect(harness.refreshSettingsTab).toHaveBeenCalledOnce();
    expect(harness.feedbackShow).toHaveBeenCalledWith({
      intent: 'success',
      message: 'CPU sidecar installed and started.',
    });
    const postInstallSpeech = harness.sidecarLifecycleGate.acquireSpeech();
    postInstallSpeech.release();
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
