import type { App } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelInstallManager } from '../src/models/model-install-manager';
import {
  changeHardwareAcceleration,
  type HardwareAccelerationActionDependencies,
} from '../src/settings/hardware-acceleration-action';
import { renderHardwareAccelerationSetting } from '../src/settings/hardware-acceleration-setting';
import { renderMicrophonePicker } from '../src/settings/microphone-picker';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import type { SettingAccess } from '../src/settings/setting-helpers';
import {
  type SidecarInstallActionDeps,
  uninstallSidecarVariantWithUx,
} from '../src/settings/sidecar-settings-section';
import type { FeedbackRequest } from '../src/shared/user-feedback';
import type { SidecarInstallManager } from '../src/sidecar/sidecar-install-manager';
import {
  SidecarLifecycleConflictError,
  SidecarLifecycleGate,
} from '../src/sidecar/sidecar-lifecycle-gate';
import { Setting, TestElement } from './__mocks__/obsidian';

const { uninstallSidecarVariantMock } = vi.hoisted(() => ({
  uninstallSidecarVariantMock: vi.fn(),
}));

vi.mock('../src/sidecar/sidecar-installer', async () => {
  const actual = await vi.importActual<typeof import('../src/sidecar/sidecar-installer')>(
    '../src/sidecar/sidecar-installer',
  );
  return {
    ...actual,
    uninstallSidecarVariant: uninstallSidecarVariantMock,
  };
});

afterEach(() => {
  uninstallSidecarVariantMock.mockReset();
  Setting.reset();
  vi.unstubAllGlobals();
});

function createActionDeps(sidecarLifecycleGate = new SidecarLifecycleGate()) {
  const feedbackShow = vi.fn();
  const modelInit = vi.fn(async () => {});
  const refreshSettingsTab = vi.fn();
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
    sidecarInstallManager: {} as SidecarInstallManager,
    sidecarLifecycleGate,
  };
  return {
    deps,
    feedbackShow,
    refreshSettingsTab,
    restartSidecar,
    shutdown,
    sidecarLifecycleGate,
  };
}

describe('direct sidecar mutations', () => {
  it('blocks uninstall synchronously while speech is active', async () => {
    const harness = createActionDeps();
    const speech = harness.sidecarLifecycleGate.acquireSpeech();

    await uninstallSidecarVariantWithUx(harness.deps, '/plugin', 'cpu');

    expect(uninstallSidecarVariantMock).not.toHaveBeenCalled();
    expect(harness.shutdown).not.toHaveBeenCalled();
    expect(harness.restartSidecar).not.toHaveBeenCalled();
    expect(harness.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message:
        'Stop dictation or Read aloud before uninstalling the CPU sidecar. If dictation is still processing, run "Cancel dictation" to stop it now.',
    });
    speech.release();
  });

  it('holds the uninstall lease through shutdown, removal, and restart', async () => {
    const harness = createActionDeps();
    harness.shutdown.mockImplementationOnce(async () => {
      expect(() => harness.sidecarLifecycleGate.acquireSpeech()).toThrow(
        SidecarLifecycleConflictError,
      );
    });
    uninstallSidecarVariantMock.mockImplementationOnce(async () => {
      expect(() => harness.sidecarLifecycleGate.acquireSpeech()).toThrow(
        SidecarLifecycleConflictError,
      );
    });
    harness.restartSidecar.mockImplementationOnce(async () => {
      expect(() => harness.sidecarLifecycleGate.acquireSpeech()).toThrow(
        SidecarLifecycleConflictError,
      );
    });

    await uninstallSidecarVariantWithUx(harness.deps, '/plugin', 'cpu');

    expect(harness.shutdown).toHaveBeenCalledOnce();
    expect(uninstallSidecarVariantMock).toHaveBeenCalledWith('/plugin', 'cpu');
    expect(harness.restartSidecar).toHaveBeenCalledOnce();
    expect(harness.refreshSettingsTab).toHaveBeenCalledOnce();
    expect(harness.feedbackShow).toHaveBeenCalledWith({
      intent: 'success',
      message: 'CPU sidecar uninstalled.',
    });
    const speech = harness.sidecarLifecycleGate.acquireSpeech();
    speech.release();
  });
});

describe('hardware acceleration mutation', () => {
  it('exposes the atomic transaction to non-visual consumers', async () => {
    const saveSettings = vi.fn(async () => {});
    const restartSidecar = vi.fn(async () => {});
    const feedbackShow = vi.fn();
    const harness = createHardwareActionHarness({
      feedbackShow,
      restartSidecar,
      saveSettings,
      sidecarLifecycleGate: new SidecarLifecycleGate(),
    });

    await changeHardwareAcceleration(harness.actionDeps, false);

    expect(harness.getSettings().accelerationPreference).toBe('cpu_only');
    expect(restartSidecar).toHaveBeenCalledOnce();
    expect(feedbackShow).toHaveBeenCalledWith({
      intent: 'success',
      message: 'Hardware acceleration off.',
    });
  });

  it('blocks the non-visual action while speech is active', async () => {
    const sidecarLifecycleGate = new SidecarLifecycleGate();
    const speech = sidecarLifecycleGate.acquireSpeech();
    const saveSettings = vi.fn(async () => {});
    const restartSidecar = vi.fn(async () => {});
    const feedbackShow = vi.fn();
    const harness = createHardwareActionHarness({
      feedbackShow,
      restartSidecar,
      saveSettings,
      sidecarLifecycleGate,
    });

    await changeHardwareAcceleration(harness.actionDeps, false);

    expect(saveSettings).not.toHaveBeenCalled();
    expect(restartSidecar).not.toHaveBeenCalled();
    expect(harness.getSettings().accelerationPreference).toBe('auto');
    speech.release();
  });

  it('blocks persistence while speech is active', async () => {
    const sidecarLifecycleGate = new SidecarLifecycleGate();
    const speech = sidecarLifecycleGate.acquireSpeech();
    const saveSettings = vi.fn(async () => {});
    const restartSidecar = vi.fn(async () => {});
    const feedbackShow = vi.fn();
    const { toggle } = renderHardwareToggle({
      feedbackShow,
      restartSidecar,
      saveSettings,
      sidecarLifecycleGate,
    });

    toggle.change(false);
    await Promise.resolve();

    expect(toggle.value).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(restartSidecar).not.toHaveBeenCalled();
    expect(feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message:
        'Cannot change hardware acceleration while dictation or Read aloud is active. If dictation is still processing after you stop it, run "Cancel dictation".',
    });
    speech.release();
  });

  it('serializes rapid clicks while persistence is pending', async () => {
    let finishSave: (() => void) | undefined;
    const saveSettings = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const restartSidecar = vi.fn(async () => {});
    const { getSettings, toggle } = renderHardwareToggle({
      feedbackShow: vi.fn(),
      restartSidecar,
      saveSettings,
      sidecarLifecycleGate: new SidecarLifecycleGate(),
    });

    toggle.change(false);
    expect(toggle.toggleEl.disabled).toBe(true);
    toggle.change(true);
    expect(saveSettings).toHaveBeenCalledOnce();

    finishSave?.();
    await vi.waitFor(() => expect(restartSidecar).toHaveBeenCalledOnce());

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(getSettings().accelerationPreference).toBe('cpu_only');
    expect(toggle.value).toBe(false);
    expect(toggle.toggleEl.disabled).toBe(false);
  });

  it('restores the UI when initial persistence fails without restarting', async () => {
    const saveSettings = vi
      .fn<(settings: typeof DEFAULT_PLUGIN_SETTINGS) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce(undefined);
    const restartSidecar = vi.fn(async () => {});
    const feedbackShow = vi.fn();
    const { getSettings, toggle } = renderHardwareToggle({
      feedbackShow,
      restartSidecar,
      saveSettings,
      sidecarLifecycleGate: new SidecarLifecycleGate(),
    });

    toggle.change(false);
    await vi.waitFor(() =>
      expect(feedbackShow).toHaveBeenCalledWith({
        cause: expect.any(Error),
        intent: 'error',
        message:
          'Could not save the hardware acceleration setting. The previous setting is still active.',
      }),
    );

    expect(saveSettings.mock.calls.map(([settings]) => settings.accelerationPreference)).toEqual([
      'cpu_only',
      'auto',
    ]);
    expect(getSettings().accelerationPreference).toBe('auto');
    expect(toggle.value).toBe(true);
    expect(toggle.toggleEl.disabled).toBe(false);
    expect(restartSidecar).not.toHaveBeenCalled();
  });

  it('restores production-ordered in-memory state when initial persistence fails', async () => {
    let settings = { ...DEFAULT_PLUGIN_SETTINGS };
    const persistOne = vi
      .fn<SettingAccess['persistOne']>()
      .mockImplementationOnce(async (key, value) => {
        settings = { ...settings, [key]: value };
        throw new Error('disk unavailable');
      })
      .mockImplementationOnce(async (key, value) => {
        settings = { ...settings, [key]: value };
      });
    const feedbackShow = vi.fn();
    const restartSidecar = vi.fn(async () => {});

    await changeHardwareAcceleration(
      {
        access: {
          getSettings: () => settings,
          persistOne,
        },
        feedback: { show: feedbackShow },
        restartSidecar,
        sidecarLifecycleGate: new SidecarLifecycleGate(),
      },
      false,
    );

    expect(persistOne.mock.calls.map(([, value]) => value)).toEqual(['cpu_only', 'auto']);
    expect(settings.accelerationPreference).toBe('auto');
    expect(restartSidecar).not.toHaveBeenCalled();
    expect(feedbackShow).toHaveBeenCalledWith({
      cause: expect.any(Error),
      intent: 'error',
      message:
        'Could not save the hardware acceleration setting. The previous setting is still active.',
    });
  });

  it('rolls persistence and the engine back after a restart failure', async () => {
    const saveSettings = vi.fn<(settings: typeof DEFAULT_PLUGIN_SETTINGS) => Promise<void>>(
      async () => {},
    );
    const restartSidecar = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('restart failed'))
      .mockResolvedValueOnce(undefined);
    const feedbackShow = vi.fn();
    const { getSettings, toggle } = renderHardwareToggle({
      feedbackShow,
      restartSidecar,
      saveSettings,
      sidecarLifecycleGate: new SidecarLifecycleGate(),
    });

    toggle.change(false);
    await vi.waitFor(() => expect(restartSidecar).toHaveBeenCalledTimes(2));

    expect(saveSettings.mock.calls.map(([settings]) => settings.accelerationPreference)).toEqual([
      'cpu_only',
      'auto',
    ]);
    expect(getSettings().accelerationPreference).toBe('auto');
    expect(toggle.value).toBe(true);
    expect(feedbackShow).toHaveBeenCalledWith({
      cause: expect.any(Error),
      intent: 'error',
      message:
        'The speech engine could not restart with that setting. The previous setting was restored.',
    });
  });

  it('reports a distinct state when rollback persistence fails', async () => {
    const saveSettings = vi
      .fn<(settings: typeof DEFAULT_PLUGIN_SETTINGS) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rollback save failed'));
    const restartSidecar = vi.fn(async () => {
      throw new Error('restart failed');
    });
    const feedbackShow = vi.fn();
    const { getSettings, toggle } = renderHardwareToggle({
      feedbackShow,
      restartSidecar,
      saveSettings,
      sidecarLifecycleGate: new SidecarLifecycleGate(),
    });

    toggle.change(false);
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2));

    expect(restartSidecar).toHaveBeenCalledOnce();
    expect(getSettings().accelerationPreference).toBe('cpu_only');
    expect(toggle.value).toBe(false);
    expect(feedbackShow).toHaveBeenCalledWith({
      cause: expect.any(Error),
      intent: 'error',
      message:
        'The speech engine could not restart, and the previous hardware acceleration setting could not be restored. Restart Obsidian before trying again.',
    });
  });

  it('reports a distinct state when rollback restart fails', async () => {
    const saveSettings = vi.fn(async () => {});
    const restartSidecar = vi
      .fn(async () => {
        throw new Error('restart failed');
      })
      .mockRejectedValueOnce(new Error('initial restart failed'))
      .mockRejectedValueOnce(new Error('rollback restart failed'));
    const feedbackShow = vi.fn();
    const { getSettings, toggle } = renderHardwareToggle({
      feedbackShow,
      restartSidecar,
      saveSettings,
      sidecarLifecycleGate: new SidecarLifecycleGate(),
    });

    toggle.change(false);
    await vi.waitFor(() => expect(restartSidecar).toHaveBeenCalledTimes(2));

    expect(getSettings().accelerationPreference).toBe('auto');
    expect(toggle.value).toBe(true);
    expect(feedbackShow).toHaveBeenCalledWith({
      cause: expect.any(Error),
      intent: 'error',
      message:
        'The previous hardware acceleration setting was restored, but the speech engine could not restart. Restart Obsidian before dictating.',
    });
  });
});

describe('microphone detection', () => {
  it('remains available when only Read aloud is active', async () => {
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    }));
    vi.stubGlobal('navigator', {
      mediaDevices: {
        addEventListener: vi.fn(),
        enumerateDevices: vi.fn(async () => []),
        getUserMedia,
        removeEventListener: vi.fn(),
      },
    });
    const isDictationBusy = vi.fn(() => false);
    const feedbackShow = vi.fn();
    const dispose = renderMicrophonePicker(new TestElement() as unknown as HTMLElement, {
      access: {
        getSettings: () => DEFAULT_PLUGIN_SETTINGS,
        persistOne: vi.fn(async () => {}),
      },
      feedback: { show: feedbackShow },
      isDictationBusy,
    });

    await Setting.named('Microphone').extraButtonComponents[0]?.click();

    expect(isDictationBusy).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(feedbackShow).not.toHaveBeenCalledWith({
      intent: 'warning',
      message: 'Stop dictation to detect microphones.',
    });
    dispose();
  });
});

function renderHardwareToggle(deps: {
  feedbackShow: (request: FeedbackRequest) => void;
  restartSidecar: () => Promise<void>;
  saveSettings: (settings: typeof DEFAULT_PLUGIN_SETTINGS) => Promise<void>;
  sidecarLifecycleGate: SidecarLifecycleGate;
}) {
  const harness = createHardwareActionHarness(deps);
  renderHardwareAccelerationSetting(new TestElement() as unknown as HTMLElement, {
    ...harness.actionDeps,
    acceleration: null,
  });
  return {
    getSettings: harness.getSettings,
    toggle: Setting.named('Hardware acceleration').onlyToggle(),
  };
}

function createHardwareActionHarness(deps: {
  feedbackShow: (request: FeedbackRequest) => void;
  restartSidecar: () => Promise<void>;
  saveSettings: (settings: typeof DEFAULT_PLUGIN_SETTINGS) => Promise<void>;
  sidecarLifecycleGate: SidecarLifecycleGate;
}): {
  actionDeps: HardwareAccelerationActionDependencies;
  getSettings: () => typeof DEFAULT_PLUGIN_SETTINGS;
} {
  let settings = { ...DEFAULT_PLUGIN_SETTINGS };
  const access: SettingAccess = {
    getSettings: () => settings,
    persistOne: async (key, value) => {
      const nextSettings = {
        ...settings,
        [key]: value,
      };
      await deps.saveSettings(nextSettings);
      settings = nextSettings;
    },
  };
  return {
    actionDeps: {
      access,
      feedback: { show: deps.feedbackShow },
      restartSidecar: deps.restartSidecar,
      sidecarLifecycleGate: deps.sidecarLifecycleGate,
    },
    getSettings: () => settings,
  };
}
