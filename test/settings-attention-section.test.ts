import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Platform } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import type { SettingsAttentionSnapshot } from '../src/settings/settings-attention';
import {
  type LoadedSettingsAttention,
  loadSettingsAttention,
  renderSettingsAttention,
  type SettingsAttentionActions,
  SettingsAttentionSection,
} from '../src/settings/settings-attention-section';
import {
  mountSettingsSidecarSurfaces,
  type SettingsSidecarSurfaceDependencies,
} from '../src/settings/settings-sidecar-surfaces';
import type { CudaCompatibility } from '../src/sidecar/gpu-precheck';
import type {
  ActiveSidecarInstall,
  SidecarInstallManager,
} from '../src/sidecar/sidecar-install-manager';
import type { SidecarInstallVariant } from '../src/sidecar/sidecar-installer';
import { SidecarLifecycleGate } from '../src/sidecar/sidecar-lifecycle-gate';
import { TestElement, Setting as TestSetting } from './__mocks__/obsidian';

const progressCardMock = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('../src/settings/install-progress-row', () => ({
  renderActiveInstallCard: (...args: unknown[]) => progressCardMock.render(...args),
}));

const tempDirectories: string[] = [];
let progressUpdates: Array<ReturnType<typeof vi.fn>>;

beforeEach(() => {
  TestSetting.reset();
  progressUpdates = [];
  progressCardMock.render.mockReset();
  progressCardMock.render.mockImplementation(
    (parent: TestElement, options: { isCancelling: boolean; name: string }) => {
      const progressEl = parent.createDiv({
        attr: { 'data-cancelling': String(options.isCancelling) },
        cls: 'mock-progress',
        text: options.name,
      });
      const update = vi.fn((next: { isCancelling: boolean; name: string }) => {
        progressEl.setText(next.name);
        progressEl.setAttribute('data-cancelling', String(next.isCancelling));
      });
      progressUpdates.push(update);
      return { progressEl, update };
    },
  );
  Platform.isMacOS = false;
  Platform.isLinux = true;
});

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('loadSettingsAttention', () => {
  it('uses authoritative drift rules and excludes development manifests', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeManifest(pluginDirectory, 'cpu', '2026.7.10');
    await writeManifest(pluginDirectory, 'cuda', 'dev-debug');

    const loaded = await loadSettingsAttention(
      loadDependencies(pluginDirectory, {
        accelerationPreference: 'cpu_only',
      }),
    );

    expect(loaded?.snapshot.drift).toEqual([
      {
        installedVersion: '2026.7.10',
        pluginVersion: '2026.7.11',
        variant: 'cpu',
      },
    ]);
    expect(loaded?.snapshot.manifests.cuda.status).toBe('installed');
  });

  it('keeps failed manifest reads unknown instead of inferring absence', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeManifest(pluginDirectory, 'cpu', '2026.7.11');
    await mkdir(join(pluginDirectory, 'bin', 'cuda', 'install.json'), {
      recursive: true,
    });

    const loaded = await loadSettingsAttention(loadDependencies(pluginDirectory));

    expect(loaded?.snapshot.manifests.cuda).toEqual({ status: 'unknown' });
  });

  it('does not inspect CUDA state on macOS', async () => {
    Platform.isMacOS = true;
    Platform.isLinux = false;
    const pluginDirectory = await createTempDirectory();
    await writeManifest(pluginDirectory, 'cpu', '2026.7.11');
    await writeManifest(pluginDirectory, 'cuda', '2026.7.10');
    const getCudaCompatibility = vi.fn(async () => COMPATIBLE);

    const loaded = await loadSettingsAttention({
      ...loadDependencies(pluginDirectory),
      getCudaCompatibility,
    });

    expect(getCudaCompatibility).not.toHaveBeenCalled();
    expect(loaded?.snapshot.cudaCompatibility).toEqual({ status: 'unsupported' });
    expect(loaded?.snapshot.manifests.cuda).toEqual({ status: 'absent' });
    expect(loaded?.snapshot.drift).toEqual([]);
  });

  it('re-reads settings after asynchronous probes settle', async () => {
    const pluginDirectory = await createTempDirectory();
    await writeManifest(pluginDirectory, 'cpu', '2026.7.10');
    await writeManifest(pluginDirectory, 'cuda', '2026.7.10');
    const probe = deferred<CudaCompatibility>();
    const currentSettings = settings();
    const load = loadSettingsAttention({
      ...loadDependencies(pluginDirectory),
      getCudaCompatibility: () => probe.promise,
      getSettings: () => currentSettings,
    });

    currentSettings.accelerationPreference = 'cpu_only';
    currentSettings.sidecarPathOverride = '/custom/sidecar';
    probe.resolve(COMPATIBLE);

    const loaded = await load;
    expect(loaded?.snapshot.accelerationPreference).toBe('cpu_only');
    expect(loaded?.snapshot.customSidecarConfigured).toBe(true);
    expect(loaded?.snapshot.drift.map((entry) => entry.variant)).toEqual(['cpu', 'cuda']);
  });

  it('short-circuits all installer IO for a custom sidecar path', async () => {
    const resolvePluginDirectory = vi.fn(async () => '/unused');
    const getCudaCompatibility = vi.fn(async () => COMPATIBLE);

    const loaded = await loadSettingsAttention({
      ...loadDependencies('/unused', { sidecarPathOverride: '/custom/sidecar' }),
      getCudaCompatibility,
      resolvePluginDirectory,
    });

    expect(resolvePluginDirectory).not.toHaveBeenCalled();
    expect(getCudaCompatibility).not.toHaveBeenCalled();
    expect(loaded?.snapshot.customSidecarConfigured).toBe(true);
  });
});

describe('renderSettingsAttention', () => {
  it('renders a labelled region and delegates exact update, install, and enable actions', async () => {
    const container = element();
    const actions = actionSpies();
    const onSettled = vi.fn();

    renderSettingsAttention(
      container,
      {
        items: [
          {
            action: 'update_sidecars',
            id: 'update_sidecars',
            variants: ['cpu', 'cuda'],
          },
          { action: 'install_cuda', id: 'install_cuda' },
          { action: 'enable_cuda', id: 'enable_cuda' },
        ],
        kind: 'items',
      },
      '/plugin',
      actions,
      vi.fn(),
      onSettled,
    );

    expect(asTestElement(container).attributes.get('role')).toBe('region');
    expect(asTestElement(container).attributes.get('aria-labelledby')).toBe(
      'local-stt-settings-attention-heading',
    );
    expect(asTestElement(container).children[0]?.attributes.get('id')).toBe(
      'local-stt-settings-attention-heading',
    );
    expect(asTestElement(container).children[1]?.attributes.get('role')).toBe('group');
    expect(TestSetting.named('Update speech engines').descEl.textContent).toContain(
      'CPU and CUDA speech engines',
    );

    await TestSetting.buttonNamed('Update speech engines').click();
    await TestSetting.buttonNamed('Install CUDA acceleration').click();
    await TestSetting.buttonNamed('Enable').click();

    expect(actions.updateSidecars).toHaveBeenCalledWith('/plugin', ['cpu', 'cuda']);
    expect(actions.installCuda).toHaveBeenCalledWith('/plugin');
    expect(actions.enableCuda).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('disables asynchronous action buttons and refreshes after setup settles', async () => {
    const container = element();
    const actions = actionSpies();
    const setup = deferred<void>();
    actions.openSetup.mockImplementation(() => setup.promise);
    const onSettled = vi.fn();

    renderSettingsAttention(
      container,
      { items: [{ action: 'setup', id: 'setup' }], kind: 'items' },
      '/plugin',
      actions,
      vi.fn(),
      onSettled,
    );

    const button = TestSetting.buttonNamed('Run setup');
    const click = button.click();
    await Promise.resolve();
    expect(button.disabled).toBe(true);

    setup.resolve();
    await click;
    expect(button.disabled).toBe(false);
    expect(onSettled).toHaveBeenCalledOnce();
  });
});

describe('SettingsAttentionSection', () => {
  it('keeps active progress when an older manifest load resolves', async () => {
    const container = element();
    const manager = new FakeInstallManager();
    const load = deferred<LoadedSettingsAttention | null>();
    const section = new SettingsAttentionSection(
      container,
      sectionDependencies(manager, () => load.promise),
    );

    section.init();
    manager.emit(activeInstall('cpu'));
    const progress = asTestElement(container).findByClass('mock-progress');
    load.resolve(setupLoaded());
    await settle();

    expect(asTestElement(container).findByClass('mock-progress')).toBe(progress);
    expect(TestSetting.instances.some((setting) => setting.name === 'Set up Local Dictation')).toBe(
      false,
    );
  });

  it('does not render an install that completed after the loader snapshot', async () => {
    const container = element();
    const manager = new FakeInstallManager();
    const load = deferred<LoadedSettingsAttention | null>();
    const section = new SettingsAttentionSection(
      container,
      sectionDependencies(manager, () => load.promise),
    );

    section.init();
    load.resolve({
      ...setupLoaded(),
      snapshot: {
        ...setupLoaded().snapshot,
        activeInstall: activeInstall('cpu'),
      },
    });
    await settle();

    expect(progressCardMock.render).not.toHaveBeenCalled();
    expect(TestSetting.instances.some((setting) => setting.name === 'Set up Local Dictation')).toBe(
      true,
    );
  });

  it('lets the newest refresh win when loads resolve out of order', async () => {
    const container = element();
    const manager = new FakeInstallManager();
    const first = deferred<LoadedSettingsAttention | null>();
    const second = deferred<LoadedSettingsAttention | null>();
    const load = vi
      .fn<() => Promise<LoadedSettingsAttention | null>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const section = new SettingsAttentionSection(
      container,
      sectionDependencies(manager, load, { accelerationPreference: 'cpu_only' }),
    );

    section.init();
    manager.emit(null);
    second.resolve(enableLoaded());
    await settle();
    first.resolve(setupLoaded());
    await settle();

    expect(
      TestSetting.instances.some((setting) => setting.name === 'Enable CUDA acceleration'),
    ).toBe(true);
    expect(TestSetting.instances.some((setting) => setting.name === 'Set up Local Dictation')).toBe(
      false,
    );
  });

  it.each(['disposed', 'detached'] as const)(
    'does not commit an async render after the container is %s',
    async (condition) => {
      const container = element();
      const manager = new FakeInstallManager();
      const load = deferred<LoadedSettingsAttention | null>();
      const section = new SettingsAttentionSection(
        container,
        sectionDependencies(manager, () => load.promise),
      );
      const dispose = section.init();

      if (condition === 'disposed') {
        dispose();
      } else {
        setConnected(container, false);
      }
      load.resolve(setupLoaded());
      await settle();

      expect(TestSetting.instances).toHaveLength(0);
      expect(asTestElement(container).children).toHaveLength(0);
    },
  );

  it('updates cancellation, batch variant, and progress without replacing the row', () => {
    const container = element();
    const manager = new FakeInstallManager(activeInstall('cpu'));
    const section = new SettingsAttentionSection(
      container,
      sectionDependencies(manager, async () => enableLoaded()),
    );

    section.init();
    const progress = asTestElement(container).findByClass('mock-progress');
    manager.emit({ ...activeInstall('cpu'), phase: 'canceling' });
    manager.emit(activeInstall('cuda'));

    expect(progressCardMock.render).toHaveBeenCalledOnce();
    expect(progressUpdates[0]).toHaveBeenCalledTimes(2);
    expect(asTestElement(container).findByClass('mock-progress')).toBe(progress);
    expect(progress?.textContent).toContain('CUDA');
    expect(progress?.attributes.get('data-cancelling')).toBe('false');
  });

  it('suppresses active installer progress when a custom sidecar is configured', () => {
    const container = element();
    const manager = new FakeInstallManager(activeInstall('cuda'));
    const section = new SettingsAttentionSection(
      container,
      sectionDependencies(manager, async () => setupLoaded(), {
        sidecarPathOverride: '/custom/sidecar',
      }),
    );

    section.init();

    expect(progressCardMock.render).not.toHaveBeenCalled();
    expect(asTestElement(container).className).toContain('local-stt-hidden');
  });

  it('rechecks a custom sidecar override before committing a completed load', async () => {
    const container = element();
    const manager = new FakeInstallManager();
    const currentSettings = settings();
    const load = deferred<LoadedSettingsAttention | null>();
    const section = new SettingsAttentionSection(container, {
      ...sectionDependencies(manager, () => load.promise),
      getSettings: () => currentSettings,
    });

    section.init();
    currentSettings.sidecarPathOverride = '/custom/sidecar';
    manager.setSilently(activeInstall('cpu'));
    load.resolve(setupLoaded());
    await settle();

    expect(progressCardMock.render).not.toHaveBeenCalled();
    expect(asTestElement(container).className).toContain('local-stt-hidden');
  });
});

describe('Settings attention composition', () => {
  it('owns the only progress surface while Advanced preserves its manifest rows', async () => {
    Platform.isLinux = false;
    const pluginDirectory = await createTempDirectory();
    const manager = new FakeInstallManager(activeInstall('cpu'));
    const topContainer = element();
    const advancedContainer = element();
    const dispose = mountSettingsSidecarSurfaces(topContainer, advancedContainer, {
      advanced: advancedDependencies(manager, pluginDirectory),
      attention: attentionSurfaceDependencies(manager, async () => enableLoaded()),
      detectCudaCompatibility: async () => COMPATIBLE,
    });

    await vi.waitFor(() => {
      expect(TestSetting.instances.some((setting) => setting.name === 'CPU sidecar')).toBe(true);
    });

    expect(progressCardMock.render).toHaveBeenCalledOnce();
    manager.emit({ ...activeInstall('cpu'), phase: 'canceling' });
    expect(progressCardMock.render).toHaveBeenCalledOnce();
    expect(progressUpdates[0]).toHaveBeenCalledOnce();

    dispose();
  });

  it('shares one CUDA probe between attention and Advanced consumers', async () => {
    Platform.isLinux = false;
    const pluginDirectory = await createTempDirectory();
    await writeManifest(pluginDirectory, 'cpu', '2026.7.11');
    const manager = new FakeInstallManager();
    const detect = vi.fn(async () => COMPATIBLE);
    const dispose = mountSettingsSidecarSurfaces(element(), element(), {
      advanced: advancedDependencies(manager, pluginDirectory),
      attention: attentionSurfaceDependencies(manager, undefined, {}, pluginDirectory),
      detectCudaCompatibility: detect,
    });

    await vi.waitFor(() => {
      expect(TestSetting.instances.some((setting) => setting.name === 'GPU sidecar')).toBe(true);
    });

    expect(detect).toHaveBeenCalledOnce();

    dispose();
  });
});

const COMPATIBLE: CudaCompatibility = {
  computeCapabilities: ['8.9'],
  driverVersion: '580.1',
  status: 'compatible',
};

class FakeInstallManager {
  readonly cancel = vi.fn();
  private active: ActiveSidecarInstall | null;
  private readonly listeners = new Set<() => void>();

  constructor(active: ActiveSidecarInstall | null = null) {
    this.active = active;
  }

  emit(active: ActiveSidecarInstall | null): void {
    this.active = active;
    for (const listener of this.listeners) listener();
  }

  getState(): { activeInstall: ActiveSidecarInstall | null; lastError: null } {
    return { activeInstall: this.active, lastError: null };
  }

  setSilently(active: ActiveSidecarInstall | null): void {
    this.active = active;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function actionSpies() {
  return {
    enableCuda: vi.fn(async () => {}),
    installCuda: vi.fn((_pluginDirectory: string) => {}),
    openSetup: vi.fn(async () => {}),
    updateSidecars: vi.fn(
      (_pluginDirectory: string, _variants: readonly SidecarInstallVariant[]) => {},
    ),
  } satisfies SettingsAttentionActions;
}

function advancedDependencies(
  manager: FakeInstallManager,
  pluginDirectory: string,
): SettingsSidecarSurfaceDependencies['advanced'] {
  const currentSettings = settings();
  return {
    access: {
      getSettings: () => currentSettings,
      persistOne: async (key, value) => {
        currentSettings[key] = value;
      },
    },
    app: {} as SettingsSidecarSurfaceDependencies['advanced']['app'],
    feedback: { show: vi.fn() },
    modelInstallManager: {
      init: vi.fn(async () => {}),
    } as unknown as SettingsSidecarSurfaceDependencies['advanced']['modelInstallManager'],
    pluginVersion: '2026.7.11',
    refreshSettingsTab: vi.fn(),
    resolvePluginDirectory: async () => pluginDirectory,
    restartSidecar: vi.fn(async () => {}),
    sidecarConnection: { shutdown: vi.fn(async () => {}) },
    sidecarInstallManager: manager as unknown as SidecarInstallManager,
    sidecarLifecycleGate: new SidecarLifecycleGate(),
  };
}

function attentionSurfaceDependencies(
  manager: FakeInstallManager,
  load?: () => Promise<LoadedSettingsAttention | null>,
  settingsOverrides: Partial<PluginSettings> = {},
  pluginDirectory = '/plugin',
): SettingsSidecarSurfaceDependencies['attention'] {
  const currentSettings = settings(settingsOverrides);
  return {
    actions: actionSpies(),
    getSettings: () => currentSettings,
    ...(load === undefined ? {} : { load }),
    pluginVersion: '2026.7.11',
    resolvePluginDirectory: async () => pluginDirectory,
    sidecarInstallManager: manager as unknown as SidecarInstallManager,
  };
}

function activeInstall(variant: SidecarInstallVariant): ActiveSidecarInstall {
  return {
    currentVariantNumber: 1,
    phase: 'installing',
    progress: { bytesDownloaded: 10, phase: 'download', totalBytes: 100 },
    totalVariants: 1,
    variant,
  };
}

async function createTempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'local-stt-settings-attention-'));
  tempDirectories.push(path);
  return path;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function element(): HTMLDivElement {
  const container = new TestElement();
  setConnected(container as unknown as HTMLDivElement, true);
  return container as unknown as HTMLDivElement;
}

function asTestElement(element: HTMLElement): TestElement {
  return element as unknown as TestElement;
}

function enableLoaded(): LoadedSettingsAttention {
  return {
    pluginDirectory: '/plugin',
    snapshot: snapshot({
      accelerationPreference: 'cpu_only',
      manifests: {
        cpu: { manifest: manifest('cpu'), status: 'installed' },
        cuda: { manifest: manifest('cuda'), status: 'installed' },
      },
    }),
  };
}

function loadDependencies(
  pluginDirectory: string,
  overrides: Partial<PluginSettings> = {},
): Omit<Parameters<typeof loadSettingsAttention>[0], 'resolvePluginDirectory'> & {
  resolvePluginDirectory: () => Promise<string>;
} {
  const currentSettings = settings(overrides);
  const manager = new FakeInstallManager();
  return {
    getCudaCompatibility: async () => COMPATIBLE,
    getSettings: () => currentSettings,
    pluginVersion: '2026.7.11',
    resolvePluginDirectory: async () => pluginDirectory,
    sidecarInstallManager: manager as unknown as SidecarInstallManager,
  };
}

function manifest(variant: SidecarInstallVariant, version = '2026.7.11') {
  return {
    installedAt: '2026-07-24T00:00:00.000Z',
    sha256: 'abc',
    variant,
    version,
  };
}

function sectionDependencies(
  manager: FakeInstallManager,
  load: () => Promise<LoadedSettingsAttention | null>,
  settingsOverrides: Partial<PluginSettings> = {},
): ConstructorParameters<typeof SettingsAttentionSection>[1] {
  const currentSettings = settings(settingsOverrides);
  return {
    actions: actionSpies(),
    getCudaCompatibility: async () => COMPATIBLE,
    getSettings: () => currentSettings,
    load,
    pluginVersion: '2026.7.11',
    resolvePluginDirectory: async () => '/plugin',
    sidecarInstallManager: manager as unknown as SidecarInstallManager,
  };
}

function setConnected(container: HTMLDivElement, connected: boolean): void {
  Object.defineProperty(container, 'isConnected', {
    configurable: true,
    value: connected,
  });
}

function settings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_PLUGIN_SETTINGS, ...overrides };
}

function setupLoaded(): LoadedSettingsAttention {
  return {
    pluginDirectory: '/plugin',
    snapshot: snapshot({
      manifests: { cpu: { status: 'absent' }, cuda: { status: 'absent' } },
    }),
  };
}

function snapshot(overrides: Partial<SettingsAttentionSnapshot> = {}): SettingsAttentionSnapshot {
  return {
    accelerationPreference: 'auto',
    activeInstall: null,
    cudaCompatibility: COMPATIBLE,
    customSidecarConfigured: false,
    drift: [],
    manifests: {
      cpu: { manifest: manifest('cpu'), status: 'installed' },
      cuda: { status: 'absent' },
    },
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function writeManifest(
  pluginDirectory: string,
  variant: SidecarInstallVariant,
  version: string,
): Promise<void> {
  const directory = join(pluginDirectory, 'bin', variant);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'install.json'),
    JSON.stringify(manifest(variant, version)),
    'utf8',
  );
}
