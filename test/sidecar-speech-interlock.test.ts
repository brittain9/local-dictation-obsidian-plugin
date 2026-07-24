import type { App, Plugin } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LocalDictationPlugin from '../src/main';
import type { ModelInstallManager } from '../src/models/model-install-manager';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { LocalSttSettingTab } from '../src/settings/settings-tab';
import {
  openSidecarInstallModal,
  openSidecarUpdateModal,
  type SidecarInstallActionDeps,
} from '../src/settings/sidecar-settings-section';
import type { SidecarInstallModalOptions } from '../src/setup/sidecar-install-modal';
import type { SidecarInstallManager } from '../src/sidecar/sidecar-install-manager';
import { Setting, TestElement } from './__mocks__/obsidian';

const capturedModalOptions = vi.hoisted(() => [] as unknown[]);

vi.mock('../src/setup/sidecar-install-modal', () => ({
  SidecarInstallModal: class {
    constructor(_app: unknown, options: unknown) {
      capturedModalOptions.push(options);
    }

    open(): void {}
  },
}));

afterEach(() => {
  capturedModalOptions.length = 0;
  Setting.reset();
});

function createActionDeps(isSidecarInUse: () => boolean): SidecarInstallActionDeps & {
  feedbackShow: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
} {
  const feedbackShow = vi.fn();
  const shutdown = vi.fn(async () => {});
  return {
    app: {} as App,
    feedback: { show: feedbackShow },
    feedbackShow,
    isSidecarInUse,
    modelInstallManager: { init: vi.fn(async () => {}) } as unknown as ModelInstallManager,
    pluginVersion: '2026.7.11',
    refreshSettingsTab: vi.fn(),
    restartSidecar: vi.fn(async () => {}),
    shutdown,
    sidecarConnection: { shutdown },
    sidecarInstallManager: {} as SidecarInstallManager,
  };
}

describe('sidecar speech interlock', () => {
  it.each([
    [
      'dictation',
      'Stop dictation or Read aloud before installing a sidecar — the install restarts the engine.',
    ],
    [
      'Read aloud',
      'Stop dictation or Read aloud before installing a sidecar — the install restarts the engine.',
    ],
  ])('does not open an install when %s is active', (_speech, message) => {
    const deps = createActionDeps(() => true);

    openSidecarInstallModal(deps, {
      intent: 'install',
      pluginDirectory: '/plugin',
      variant: 'cpu',
    });

    expect(capturedModalOptions).toEqual([]);
    expect(deps.feedbackShow).toHaveBeenCalledWith({ intent: 'warning', message });
  });

  it.each([
    [
      'dictation',
      'Stop dictation or Read aloud before updating sidecars — the update restarts the engine.',
    ],
    [
      'Read aloud',
      'Stop dictation or Read aloud before updating sidecars — the update restarts the engine.',
    ],
  ])('does not open an update when %s is active', (_speech, message) => {
    const deps = createActionDeps(() => true);

    openSidecarUpdateModal(deps, {
      pluginDirectory: '/plugin',
      variants: ['cpu'],
    });

    expect(capturedModalOptions).toEqual([]);
    expect(deps.feedbackShow).toHaveBeenCalledWith({ intent: 'warning', message });
  });

  it('rechecks before replacing files after an idle install was opened', async () => {
    let sidecarInUse = false;
    const deps = createActionDeps(() => sidecarInUse);

    openSidecarInstallModal(deps, {
      intent: 'install',
      pluginDirectory: '/plugin',
      variant: 'cpu',
    });

    expect(capturedModalOptions).toHaveLength(1);
    sidecarInUse = true;
    const options = capturedModalOptions[0] as SidecarInstallModalOptions;

    await expect(options.beforeReplace?.()).rejects.toThrow(
      'Dictation or Read aloud became active before the sidecar files could be changed. Stop it, then retry.',
    );
    expect(deps.shutdown).not.toHaveBeenCalled();
  });

  it('persists and restarts hardware acceleration only when the sidecar is idle', async () => {
    const saveSettings = vi.fn(async () => {});
    const restartSidecar = vi.fn(async () => {});
    const feedbackShow = vi.fn();
    let sidecarInUse = true;
    const tab = new LocalSttSettingTab({} as App, {} as Plugin, {
      feedback: { show: feedbackShow },
      getSettings: () => ({
        ...DEFAULT_PLUGIN_SETTINGS,
        selectedModel: {
          familyId: 'whisper',
          kind: 'catalog_model',
          modelId: 'whisper_small_en_q5_1',
          runtimeId: 'whisper_cpp',
        },
      }),
      isDictationBusy: () => false,
      isSidecarInUse: () => sidecarInUse,
      modelInstallManager: {
        getState: () => ({
          compiledAdapters: [],
          compiledRuntimes: [
            {
              runtimeCapabilities: { availableAccelerators: ['cpu', 'cuda'] },
              runtimeId: 'whisper_cpp',
            },
          ],
          selectedModelCapabilities: { status: 'none' },
        }),
      } as unknown as ModelInstallManager,
      openModelPicker: vi.fn(async () => {}),
      openSetupWizard: vi.fn(async () => {}),
      pluginVersion: '2026.7.11',
      resetLlmTransformation: vi.fn(async () => {}),
      resolvePluginDirectory: vi.fn(async () => '/plugin'),
      restartSidecar,
      saveSettings,
      sidecarConnection: { probeSystemAudio: vi.fn(), shutdown: vi.fn(async () => {}) },
      sidecarInstallManager: {} as SidecarInstallManager,
    });
    const group = new TestElement();
    const heading = new Setting(group);
    const container = new TestElement();
    const renderer = tab as unknown as {
      renderEngineOptions(group: HTMLDivElement, heading: Setting, container: HTMLDivElement): void;
    };

    renderer.renderEngineOptions(
      group as unknown as HTMLDivElement,
      heading,
      container as unknown as HTMLDivElement,
    );
    const toggle = Setting.named('Hardware acceleration').onlyToggle();

    toggle.change(false);
    await Promise.resolve();

    expect(toggle.value).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(restartSidecar).not.toHaveBeenCalled();
    expect(feedbackShow).toHaveBeenCalledWith({
      intent: 'warning',
      message: 'Cannot change hardware acceleration while dictation or Read aloud is active.',
    });

    sidecarInUse = false;
    toggle.change(false);
    await vi.waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({
        ...DEFAULT_PLUGIN_SETTINGS,
        accelerationPreference: 'cpu_only',
        selectedModel: {
          familyId: 'whisper',
          kind: 'catalog_model',
          modelId: 'whisper_small_en_q5_1',
          runtimeId: 'whisper_cpp',
        },
      });
      expect(restartSidecar).toHaveBeenCalledOnce();
    });
  });

  it('derives the startup update interlock from both live speech controllers', () => {
    let dictationBusy = false;
    let readAloudActive = false;
    const plugin = Object.assign(Object.create(LocalDictationPlugin.prototype), {
      app: {} as App,
      dictationController: { isBusy: () => dictationBusy },
      feedback: { show: vi.fn() },
      logger: undefined,
      manifest: { version: '2026.7.11' },
      modelInstallManager: {} as ModelInstallManager,
      readAloudController: { isActive: () => readAloudActive },
      settings: DEFAULT_PLUGIN_SETTINGS,
      sidecarConnection: { restart: vi.fn(async () => {}) },
      sidecarInstallManager: {} as SidecarInstallManager,
    }) as {
      buildSidecarInstallActionDeps(): SidecarInstallActionDeps;
    };
    const deps = plugin.buildSidecarInstallActionDeps();

    expect(deps.isSidecarInUse()).toBe(false);
    dictationBusy = true;
    expect(deps.isSidecarInUse()).toBe(true);
    dictationBusy = false;
    readAloudActive = true;
    expect(deps.isSidecarInUse()).toBe(true);
  });
});
