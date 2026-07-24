import type { App } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelInstallManager } from '../src/models/model-install-manager';
import { renderHardwareAccelerationSetting } from '../src/settings/hardware-acceleration-setting';
import {
  renderMicrophonePicker,
  selectMicrophoneDetectionBusyPredicate,
} from '../src/settings/microphone-picker';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import type { SettingAccess } from '../src/settings/setting-helpers';
import {
  openSidecarInstallModal,
  openSidecarUpdateModal,
  type SidecarInstallActionDeps,
  uninstallSidecarVariantWithUx,
} from '../src/settings/sidecar-settings-section';
import { buildStartupSidecarInstallActionDeps } from '../src/settings/startup-sidecar-install-action-deps';
import type { FeedbackRequest } from '../src/shared/user-feedback';
import type { SidecarInstallManager } from '../src/sidecar/sidecar-install-manager';
import {
  assertSidecarIdle,
  createSidecarInUsePredicate,
  SidecarInUseError,
} from '../src/sidecar/sidecar-speech-interlock';
import { Setting, TestElement } from './__mocks__/obsidian';

const { uninstallSidecarVariantMock } = vi.hoisted(() => ({
  uninstallSidecarVariantMock: vi.fn(),
}));
const capturedModalOptions = vi.hoisted(() => [] as unknown[]);

vi.mock('../src/sidecar/sidecar-installer', async () => {
  const actual = await vi.importActual<typeof import('../src/sidecar/sidecar-installer')>(
    '../src/sidecar/sidecar-installer',
  );
  return {
    ...actual,
    uninstallSidecarVariant: uninstallSidecarVariantMock,
  };
});

vi.mock('../src/setup/sidecar-install-modal', () => ({
  SidecarInstallModal: class {
    constructor(_app: unknown, options: unknown) {
      capturedModalOptions.push(options);
    }

    open(): void {}
  },
}));

const BECAME_ACTIVE_MESSAGE =
  'Dictation or Read aloud became active before the sidecar operation could finish. Stop Read aloud or dictation. If dictation is still processing, run "Cancel dictation", then retry.';

afterEach(() => {
  capturedModalOptions.length = 0;
  uninstallSidecarVariantMock.mockReset();
  Setting.reset();
  vi.unstubAllGlobals();
});

function createActionDeps(isSidecarInUse: () => boolean): SidecarInstallActionDeps & {
  feedbackShow: ReturnType<typeof vi.fn>;
  modelInit: ReturnType<typeof vi.fn>;
  refreshSettingsTab: ReturnType<typeof vi.fn>;
  restartSidecarWhenIdle: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
} {
  const feedbackShow = vi.fn();
  const modelInit = vi.fn(async () => {});
  const refreshSettingsTab = vi.fn();
  const restartSidecarWhenIdle = vi.fn(async () => {});
  const shutdown = vi.fn(async () => {});
  return {
    app: {} as App,
    feedback: { show: feedbackShow },
    feedbackShow,
    isSidecarInUse,
    modelInit,
    modelInstallManager: { init: modelInit } as unknown as ModelInstallManager,
    pluginVersion: '2026.7.11',
    refreshSettingsTab,
    restartSidecarWhenIdle,
    shutdown,
    sidecarConnection: { shutdown },
    sidecarInstallManager: {} as SidecarInstallManager,
  };
}

function speechPredicate(dictationBusy: boolean, readAloudActive: boolean): () => boolean {
  return createSidecarInUsePredicate({
    isDictationBusy: () => dictationBusy,
    isReadAloudActive: () => readAloudActive,
  });
}

describe('sidecar speech interlock', () => {
  it.each([
    ['dictation', true, false],
    ['Read aloud', false, true],
  ])('does not open an install when %s alone is active', (_speech, dictation, readAloud) => {
    const deps = createActionDeps(speechPredicate(dictation, readAloud));

    openSidecarInstallModal(deps, {
      intent: 'install',
      pluginDirectory: '/plugin',
      variant: 'cpu',
    });

    expect(capturedModalOptions).toEqual([]);
    expect(deps.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message:
        'Stop dictation or Read aloud before installing a sidecar — the install restarts the engine. If dictation is still processing, run "Cancel dictation" to stop it now.',
    });
  });

  it.each([
    ['dictation', true, false],
    ['Read aloud', false, true],
  ])('does not open an update when %s alone is active', (_speech, dictation, readAloud) => {
    const deps = createActionDeps(speechPredicate(dictation, readAloud));

    openSidecarUpdateModal(deps, {
      pluginDirectory: '/plugin',
      variants: ['cpu'],
    });

    expect(capturedModalOptions).toEqual([]);
    expect(deps.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message:
        'Stop dictation or Read aloud before updating sidecars — the update restarts the engine. If dictation is still processing, run "Cancel dictation" to stop it now.',
    });
  });

  it('blocks uninstall when Read aloud alone is active without side effects', async () => {
    const deps = createActionDeps(speechPredicate(false, true));

    await uninstallSidecarVariantWithUx(deps, '/plugin', 'cpu');

    expect(uninstallSidecarVariantMock).not.toHaveBeenCalled();
    expect(deps.shutdown).not.toHaveBeenCalled();
    expect(deps.restartSidecarWhenIdle).not.toHaveBeenCalled();
    expect(deps.refreshSettingsTab).not.toHaveBeenCalled();
    expect(deps.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message:
        'Stop dictation or Read aloud before uninstalling the CPU sidecar. If dictation is still processing, run "Cancel dictation" to stop it now.',
    });
  });

  it('suppresses uninstall success when speech starts at the restart boundary', async () => {
    const deps = createActionDeps(speechPredicate(false, false));
    deps.restartSidecarWhenIdle.mockRejectedValueOnce(new SidecarInUseError(BECAME_ACTIVE_MESSAGE));
    uninstallSidecarVariantMock.mockResolvedValueOnce(undefined);

    await uninstallSidecarVariantWithUx(deps, '/plugin', 'cpu');

    expect(deps.shutdown).toHaveBeenCalledOnce();
    expect(uninstallSidecarVariantMock).toHaveBeenCalledWith('/plugin', 'cpu');
    expect(deps.restartSidecarWhenIdle).toHaveBeenCalledOnce();
    expect(deps.refreshSettingsTab).not.toHaveBeenCalled();
    expect(deps.feedbackShow).toHaveBeenCalledOnce();
    expect(deps.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message: BECAME_ACTIVE_MESSAGE,
    });
  });

  it('persists and restarts hardware acceleration only when the sidecar is idle', async () => {
    const saveSettings = vi.fn(async () => {});
    const restartSidecarWhenIdle = vi.fn(async () => {});
    const feedbackShow = vi.fn();
    let sidecarInUse = true;
    const toggle = renderHardwareToggle({
      feedbackShow,
      isSidecarInUse: () => sidecarInUse,
      restartSidecarWhenIdle,
      saveSettings,
    });

    toggle.change(false);
    await Promise.resolve();

    expect(toggle.value).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(restartSidecarWhenIdle).not.toHaveBeenCalled();
    expect(feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message:
        'Cannot change hardware acceleration while dictation or Read aloud is active. If dictation is still processing after you stop it, run "Cancel dictation".',
    });

    sidecarInUse = false;
    toggle.change(false);
    await vi.waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ accelerationPreference: 'cpu_only' }),
      );
      expect(restartSidecarWhenIdle).toHaveBeenCalledOnce();
    });
  });

  it('rolls hardware preference back when speech starts during persistence', async () => {
    let releasePersistence: (() => void) | undefined;
    let sidecarInUse = false;
    const saveSettings = vi
      .fn<(settings: typeof DEFAULT_PLUGIN_SETTINGS) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releasePersistence = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const restartConnection = vi.fn(async () => {});
    const restartSidecarWhenIdle = vi.fn(async () => {
      assertSidecarIdle(() => sidecarInUse, BECAME_ACTIVE_MESSAGE);
      await restartConnection();
    });
    const feedbackShow = vi.fn();
    const toggle = renderHardwareToggle({
      feedbackShow,
      isSidecarInUse: () => sidecarInUse,
      restartSidecarWhenIdle,
      saveSettings,
    });

    toggle.change(false);
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());

    sidecarInUse = true;
    releasePersistence?.();

    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2));
    expect(saveSettings.mock.calls[0]?.[0].accelerationPreference).toBe('cpu_only');
    expect(saveSettings.mock.calls[1]?.[0].accelerationPreference).toBe('auto');
    expect(toggle.value).toBe(true);
    expect(restartSidecarWhenIdle).toHaveBeenCalledOnce();
    expect(restartConnection).not.toHaveBeenCalled();
    expect(feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message: BECAME_ACTIVE_MESSAGE,
    });
    expect(feedbackShow).not.toHaveBeenCalledWith({
      intent: 'success',
      message: 'Hardware acceleration off.',
    });
  });

  it('rolls a later racing hardware change back to the last successful preference', async () => {
    const saveSettings = vi.fn<(settings: typeof DEFAULT_PLUGIN_SETTINGS) => Promise<void>>(
      async () => {},
    );
    const restartSidecarWhenIdle = vi.fn(async () => {});
    const feedbackShow = vi.fn();
    const toggle = renderHardwareToggle({
      feedbackShow,
      isSidecarInUse: () => false,
      restartSidecarWhenIdle,
      saveSettings,
    });

    toggle.change(false);
    await vi.waitFor(() => expect(restartSidecarWhenIdle).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(feedbackShow).toHaveBeenCalledWith({
        intent: 'success',
        message: 'Hardware acceleration off.',
      }),
    );
    expect(toggle.value).toBe(false);

    restartSidecarWhenIdle.mockRejectedValueOnce(new SidecarInUseError(BECAME_ACTIVE_MESSAGE));
    feedbackShow.mockClear();
    toggle.change(true);

    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(3));
    expect(saveSettings.mock.calls.map(([settings]) => settings.accelerationPreference)).toEqual([
      'cpu_only',
      'auto',
      'cpu_only',
    ]);
    expect(toggle.value).toBe(false);
    expect(feedbackShow).toHaveBeenCalledOnce();
    expect(feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message: BECAME_ACTIVE_MESSAGE,
    });
  });

  it('derives sidecar use from both live predicates without caching either', () => {
    let dictationBusy = false;
    let readAloudActive = false;
    const isSidecarInUse = createSidecarInUsePredicate({
      isDictationBusy: () => dictationBusy,
      isReadAloudActive: () => readAloudActive,
    });

    expect(isSidecarInUse()).toBe(false);
    dictationBusy = true;
    expect(isSidecarInUse()).toBe(true);
    dictationBusy = false;
    readAloudActive = true;
    expect(isSidecarInUse()).toBe(true);
  });

  it('wires the startup drift action to both live speech predicates', () => {
    let dictationBusy = false;
    let readAloudActive = false;
    const baseDeps = createActionDeps(() => false);
    const { isSidecarInUse: _unused, ...sources } = baseDeps;
    const deps = buildStartupSidecarInstallActionDeps({
      ...sources,
      speechPredicates: {
        isDictationBusy: () => dictationBusy,
        isReadAloudActive: () => readAloudActive,
      },
    });

    expect(deps.isSidecarInUse()).toBe(false);
    dictationBusy = true;
    expect(deps.isSidecarInUse()).toBe(true);
    dictationBusy = false;
    readAloudActive = true;
    expect(deps.isSidecarInUse()).toBe(true);

    openSidecarUpdateModal(deps, {
      pluginDirectory: '/plugin',
      variants: ['cpu'],
    });

    expect(capturedModalOptions).toEqual([]);
    expect(baseDeps.feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message:
        'Stop dictation or Read aloud before updating sidecars — the update restarts the engine. If dictation is still processing, run "Cancel dictation" to stop it now.',
    });
  });

  it('wires Settings microphone detection to dictation only', async () => {
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
    const combinedSidecarPredicate = createSidecarInUsePredicate({
      isDictationBusy,
      isReadAloudActive: () => true,
    });
    const isSidecarInUse = vi.fn(() => combinedSidecarPredicate());
    const isMicrophoneDetectionBusy = selectMicrophoneDetectionBusyPredicate({
      isDictationBusy,
      isSidecarInUse,
    });
    const feedbackShow = vi.fn();
    const dispose = renderMicrophonePicker(new TestElement() as unknown as HTMLElement, {
      access: {
        getSettings: () => DEFAULT_PLUGIN_SETTINGS,
        persistOne: vi.fn(async () => {}),
      },
      feedback: { show: feedbackShow },
      isDictationBusy: isMicrophoneDetectionBusy,
    });

    expect(combinedSidecarPredicate()).toBe(true);
    await Setting.named('Microphone').extraButtonComponents[0]?.click();

    expect(isDictationBusy).toHaveBeenCalled();
    expect(isSidecarInUse).not.toHaveBeenCalled();
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
  isSidecarInUse: () => boolean;
  restartSidecarWhenIdle: () => Promise<void>;
  saveSettings: (settings: typeof DEFAULT_PLUGIN_SETTINGS) => Promise<void>;
}) {
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
  renderHardwareAccelerationSetting(new TestElement() as unknown as HTMLElement, {
    access,
    feedback: { show: deps.feedbackShow },
    isSidecarInUse: deps.isSidecarInUse,
    restartSidecarWhenIdle: deps.restartSidecarWhenIdle,
  });
  return Setting.named('Hardware acceleration').onlyToggle();
}
