import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Platform } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { SidecarSettingsSection } from '../src/settings/sidecar-settings-section';
import type { SidecarInstallManager } from '../src/sidecar/sidecar-install-manager';
import { SidecarLifecycleGate } from '../src/sidecar/sidecar-lifecycle-gate';
import { Setting, TestElement } from './__mocks__/obsidian';

vi.mock('../src/sidecar/gpu-precheck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sidecar/gpu-precheck')>();
  return {
    ...actual,
    detectCudaCompatibility: vi.fn(async () => ({
      computeCapabilities: ['8.9'],
      driverVersion: '594.0',
      status: 'incompatible_driver',
    })),
  };
});

const tempDirectories: string[] = [];

afterEach(async () => {
  Setting.reset();
  Platform.isMacOS = false;
  Platform.isLinux = true;
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('CUDA sidecar Settings actions', () => {
  it('preserves uninstall but hides reinstall for an incompatible installed variant', async () => {
    Platform.isMacOS = false;
    Platform.isLinux = false;
    const pluginDirectory = await mkdtemp(join(tmpdir(), 'local-stt-cuda-settings-'));
    tempDirectories.push(pluginDirectory);
    const cudaDirectory = join(pluginDirectory, 'bin', 'cuda');
    await mkdir(cudaDirectory, { recursive: true });
    await writeFile(
      join(cudaDirectory, 'install.json'),
      JSON.stringify({
        installedAt: '2026-07-24T00:00:00.000Z',
        sha256: 'abc',
        variant: 'cuda',
        version: '2026.7.11',
      }),
      'utf8',
    );
    const container = new TestElement();
    Object.defineProperty(container, 'isConnected', { value: true });
    const manager = {
      getState: () => ({ activeInstall: null, lastError: null }),
      subscribe: () => () => {},
    } as unknown as SidecarInstallManager;
    const settings = { ...DEFAULT_PLUGIN_SETTINGS };
    const section = new SidecarSettingsSection(container as unknown as HTMLDivElement, {
      access: {
        getSettings: () => settings,
        persistOne: async (key, value) => {
          settings[key] = value;
        },
      },
      app: {} as ConstructorParameters<typeof SidecarSettingsSection>[1]['app'],
      feedback: { show: vi.fn() },
      modelInstallManager: {
        init: vi.fn(async () => {}),
      } as unknown as ConstructorParameters<
        typeof SidecarSettingsSection
      >[1]['modelInstallManager'],
      pluginVersion: '2026.7.11',
      refreshSettingsTab: vi.fn(),
      resolvePluginDirectory: async () => pluginDirectory,
      restartSidecar: vi.fn(async () => {}),
      sidecarConnection: { shutdown: vi.fn(async () => {}) },
      sidecarInstallManager: manager,
      sidecarLifecycleGate: new SidecarLifecycleGate(),
    });

    const dispose = section.init();
    await vi.waitFor(() => {
      expect(Setting.instances.some((setting) => setting.name === 'GPU sidecar')).toBe(true);
    });

    const gpuSetting = Setting.named('GPU sidecar');
    expect(gpuSetting.buttonComponents.map((button) => button.text)).toEqual(['Uninstall']);

    dispose();
  });
});
