import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInstallLifecycleLogMessage,
  isTerminalInstallState,
  ModelInstallManager,
} from '../src/models/model-install-manager';
import type {
  CatalogModelSelection,
  EngineCapabilitiesRecord,
  ModelInstallUpdateRecord,
} from '../src/models/model-management-types';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import type { SidecarEvent } from '../src/sidecar/protocol';
import { sampleCatalog } from './fixtures/catalog';
import {
  sampleInstalledModel,
  sampleInstallUpdate,
  sampleModelStore,
  sampleMoonshineInstalledModel,
  sampleMoonshineInstallUpdate,
  sampleMoonshineSelection,
  sampleSelection,
} from './fixtures/models';

// ---------------------------------------------------------------------------
// Shared helpers (pure exports)
// ---------------------------------------------------------------------------

describe('isTerminalInstallState', () => {
  it.each([
    ['completed', true],
    ['cancelled', true],
    ['failed', true],
    ['downloading', false],
    ['queued', false],
    ['verifying', false],
    ['probing', false],
  ] as const)('classifies %s terminal=%s', (state, expected) => {
    expect(isTerminalInstallState(state)).toBe(expected);
  });
});

describe('createInstallLifecycleLogMessage', () => {
  it('emits a log line for lifecycle boundaries (download start, completed, cancelled)', () => {
    const base = sampleInstallUpdate();

    expect(createInstallLifecycleLogMessage(base)).toBe(
      'install whisper_large_v3_turbo_q8_0 (install-1): download started',
    );
    expect(createInstallLifecycleLogMessage({ ...base, state: 'completed' })).toBe(
      'install whisper_large_v3_turbo_q8_0 (install-1): completed',
    );
    expect(createInstallLifecycleLogMessage({ ...base, state: 'cancelled' })).toBe(
      'install whisper_large_v3_turbo_q8_0 (install-1): cancelled',
    );
  });

  it.each([
    'failed',
    'verifying',
    'probing',
    'queued',
  ] as const)('returns null at intermediate state %s', (state) => {
    expect(createInstallLifecycleLogMessage({ ...sampleInstallUpdate(), state })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ModelInstallManager — state machine and orchestration
// ---------------------------------------------------------------------------

describe('ModelInstallManager', () => {
  let harness: ManagerHarness;

  beforeEach(() => {
    harness = createManagerHarness();
  });

  afterEach(() => {
    harness.manager.dispose();
  });

  describe('init()', () => {
    it('hydrates state from the sidecar and transitions to ready', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      expect(harness.manager.getState().loadStatus).toBe('loading');

      await harness.manager.init();

      const state = harness.manager.getState();
      expect(state).toMatchObject({
        catalog: expect.objectContaining({ models: expect.any(Array) }),
        loadError: null,
        loadStatus: 'ready',
      });
      expect(state.catalog.models).toHaveLength(3);
      expect(state.installedModels).toHaveLength(1);
      expect(state.modelStore.path).toBe('/models');
      expect(state.compiledRuntimes.map((r) => r.runtimeId)).toEqual([
        'onnx_runtime',
        'whisper_cpp',
      ]);
      expect(state.compiledAdapters.map((a) => `${a.runtimeId}:${a.familyId}`)).toEqual([
        'onnx_runtime:cohere_transcribe',
        'onnx_runtime:moonshine',
        'whisper_cpp:whisper',
      ]);
    });

    it('captures the failure message and surfaces loadStatus=error when the sidecar is unreachable', async () => {
      const error = new Error('connection lost');
      harness.sidecarConnection.listModelCatalog.mockRejectedValue(error);
      harness.sidecarConnection.listInstalledModels.mockRejectedValue(error);
      harness.sidecarConnection.getModelStore.mockRejectedValue(error);
      harness.sidecarConnection.getSystemInfo.mockRejectedValue(error);

      await harness.manager.init();

      expect(harness.manager.getState()).toMatchObject({
        loadError: 'connection lost',
        loadStatus: 'error',
      });
    });
  });

  describe('install lifecycle', () => {
    beforeEach(async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
    });

    it('forwards install requests to the sidecar when idle', async () => {
      harness.sidecarConnection.installModel.mockResolvedValueOnce(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(sampleSelection());

      expect(harness.sidecarConnection.installModel).toHaveBeenCalledWith(
        expect.objectContaining({
          familyId: 'whisper',
          modelId: 'whisper_large_v3_turbo_q8_0',
          runtimeId: 'whisper_cpp',
        }),
      );
    });

    it('supports the managed install, select, and remove lifecycle for Moonshine', async () => {
      const installedModel = sampleMoonshineInstalledModel();
      const installUpdate = sampleMoonshineInstallUpdate();
      const selection = sampleMoonshineSelection();

      harness.sidecarConnection.installModel.mockResolvedValueOnce({
        ...installUpdate,
        state: 'queued',
      });

      await harness.manager.install(selection);

      expect(harness.sidecarConnection.installModel).toHaveBeenCalledWith(
        expect.objectContaining({
          familyId: selection.familyId,
          modelId: selection.modelId,
          runtimeId: selection.runtimeId,
        }),
      );

      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel(), installedModel],
      });
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(
        sampleReadyProbeResult(selection),
      );
      emitInstallUpdate(harness, { ...installUpdate, state: 'downloading' });
      emitInstallUpdate(harness, { ...installUpdate, state: 'completed' });

      await vi.waitFor(() => {
        expect(harness.getSettings().selectedModel).toEqual(selection);
        expect(
          harness.manager
            .getState()
            .installedModels.some((model) => model.modelId === selection.modelId),
        ).toBe(true);
      });

      await harness.manager.clearSelection();
      harness.sidecarConnection.removeModel.mockResolvedValueOnce({ removed: true });
      await harness.manager.remove(selection);

      expect(harness.sidecarConnection.removeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          familyId: selection.familyId,
          modelId: selection.modelId,
          runtimeId: selection.runtimeId,
        }),
      );
      expect(
        harness.manager
          .getState()
          .installedModels.some((model) => model.modelId === selection.modelId),
      ).toBe(false);
    });

    it('rejects a second install while one is active', async () => {
      emitInstallUpdate(harness);

      await expect(
        harness.manager.install(sampleSelection('whisper_small_en_q5_1')),
      ).rejects.toThrow('Another model is already being installed.');
      expect(harness.sidecarConnection.installModel).not.toHaveBeenCalled();
    });

    it('transitions to installing on the first progress event and tracks byte progress', () => {
      expect(harness.manager.getState().activeInstall).toBeNull();

      emitInstallUpdate(harness, { downloadedBytes: 100 });
      expect(harness.manager.getState().activeInstall).toMatchObject({
        installUpdate: expect.objectContaining({
          downloadedBytes: 100,
          modelId: 'whisper_large_v3_turbo_q8_0',
        }),
        phase: 'installing',
      });

      emitInstallUpdate(harness, { downloadedBytes: 400 });
      expect(harness.manager.getState().activeInstall?.installUpdate.downloadedBytes).toBe(400);
    });

    it.each([
      'completed',
      'failed',
      'cancelled',
    ] as const)('returns to idle on terminal state %s', (state) => {
      emitInstallUpdate(harness);
      emitInstallUpdate(harness, { state });

      expect(harness.manager.getState().activeInstall).toBeNull();
    });

    it('refreshes installedModels after a completed event', async () => {
      expect(harness.manager.getState().installedModels).toHaveLength(1);

      emitInstallUpdate(harness, {
        modelId: 'whisper_small_en_q5_1',
        installId: 'install-refresh',
      });
      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel(), sampleInstalledModel('whisper_small_en_q5_1')],
      });
      emitInstallUpdate(harness, {
        installId: 'install-refresh',
        modelId: 'whisper_small_en_q5_1',
        state: 'completed',
      });

      await vi.waitFor(() => {
        expect(harness.manager.getState().installedModels).toHaveLength(2);
      });
    });
  });

  describe('cancel()', () => {
    beforeEach(async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
    });

    it('asks the sidecar to cancel and marks phase as canceling', async () => {
      emitInstallUpdate(harness);

      await harness.manager.cancel();

      expect(harness.sidecarConnection.cancelModelInstall).toHaveBeenCalledWith('install-1');
      expect(harness.manager.getState().activeInstall?.phase).toBe('canceling');
    });

    it('reverts phase to installing when the cancel command itself fails', async () => {
      emitInstallUpdate(harness);
      harness.sidecarConnection.cancelModelInstall.mockImplementationOnce(() => {
        throw new Error('write failed');
      });

      await expect(harness.manager.cancel()).rejects.toThrow('write failed');
      expect(harness.manager.getState().activeInstall?.phase).toBe('installing');
    });

    it('keeps the canceling phase even as progress events keep arriving', async () => {
      emitInstallUpdate(harness);
      await harness.manager.cancel();

      emitInstallUpdate(harness, { downloadedBytes: 999 });

      expect(harness.manager.getState().activeInstall).toMatchObject({
        installUpdate: expect.objectContaining({ downloadedBytes: 999 }),
        phase: 'canceling',
      });
    });

    it('is a no-op when no install is active', async () => {
      await harness.manager.cancel();
      expect(harness.sidecarConnection.cancelModelInstall).not.toHaveBeenCalled();
    });
  });

  describe('cancelStuck timeout', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('escalates from canceling to cancelStuck after 30s without a terminal event', async () => {
      emitInstallUpdate(harness);
      await harness.manager.cancel();
      expect(harness.manager.getState().activeInstall?.phase).toBe('canceling');

      vi.advanceTimersByTime(30_000);

      expect(harness.manager.getState().activeInstall?.phase).toBe('cancelStuck');
    });

    it('does not fire when the terminal event arrives before the timeout', async () => {
      emitInstallUpdate(harness);
      await harness.manager.cancel();
      emitInstallUpdate(harness, { state: 'cancelled' });

      vi.advanceTimersByTime(30_000);

      expect(harness.manager.getState().activeInstall).toBeNull();
    });

    it('still accepts a late terminal event during cancelStuck and returns to idle', async () => {
      emitInstallUpdate(harness);
      await harness.manager.cancel();
      vi.advanceTimersByTime(30_000);

      emitInstallUpdate(harness, { state: 'cancelled' });

      expect(harness.manager.getState().activeInstall).toBeNull();
    });

    it('dismissCancelStuck returns to idle and refreshes installed models', async () => {
      emitInstallUpdate(harness);
      await harness.manager.cancel();
      vi.advanceTimersByTime(30_000);
      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel(), sampleInstalledModel('whisper_small_en_q5_1')],
      });

      await harness.manager.dismissCancelStuck();

      expect(harness.manager.getState()).toMatchObject({
        activeInstall: null,
        installedModels: expect.arrayContaining([
          expect.objectContaining({ modelId: 'whisper_small_en_q5_1' }),
        ]),
      });
    });

    it('dismissCancelStuck is a no-op while the install is still running', async () => {
      emitInstallUpdate(harness);

      await harness.manager.dismissCancelStuck();

      expect(harness.manager.getState().activeInstall).not.toBeNull();
      // Only the init call should have hit listInstalledModels.
      expect(harness.sidecarConnection.listInstalledModels).toHaveBeenCalledOnce();
    });
  });

  describe('remove()', () => {
    it('refuses to remove the currently selected model', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();

      await expect(harness.manager.remove(sampleSelection())).rejects.toThrow(
        'Cannot remove the currently selected model.',
      );
      expect(harness.sidecarConnection.removeModel).not.toHaveBeenCalled();
    });

    it('refuses to remove a model that is actively installing', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      emitInstallUpdate(harness);

      await expect(harness.manager.remove(sampleSelection())).rejects.toThrow(
        'This model is currently being installed and cannot be removed.',
      );
      expect(harness.sidecarConnection.removeModel).not.toHaveBeenCalled();
    });

    it('removes a non-selected, non-installing model and drops it from local state', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection('whisper_small_en_q5_1') });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();

      harness.sidecarConnection.removeModel.mockResolvedValueOnce({ removed: true });
      await harness.manager.remove(sampleSelection());

      expect(
        harness.manager
          .getState()
          .installedModels.find((m) => m.modelId === 'whisper_large_v3_turbo_q8_0'),
      ).toBeUndefined();
    });

    it('keeps the local list intact when the sidecar reports removed=false', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      harness.sidecarConnection.removeModel.mockResolvedValueOnce({ removed: false });

      await harness.manager.remove(sampleSelection());

      expect(
        harness.manager
          .getState()
          .installedModels.find((m) => m.modelId === 'whisper_large_v3_turbo_q8_0'),
      ).toBeDefined();
    });
  });

  describe('select() / clearSelection()', () => {
    beforeEach(async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
    });

    it('persists the selection after a successful probe', async () => {
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());

      await harness.manager.select(sampleSelection());

      expect(harness.getSettings().selectedModel).toEqual(sampleSelection());
    });

    it('validates and selects Moonshine through the external-file path', async () => {
      const selection = {
        familyId: 'moonshine' as const,
        filePath: '/models/moonshine/frontend.ort',
        kind: 'external_file' as const,
        runtimeId: 'onnx_runtime' as const,
      };
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce({
        ...sampleReadyProbeResult(),
        displayName: 'frontend.ort',
        familyId: selection.familyId,
        mergedCapabilities: {
          ...sampleMergedCapabilities(),
          family: {
            ...sampleMergedCapabilities().family,
            supportsInitialPrompt: false,
            supportsStreaming: true,
          },
          familyId: selection.familyId,
          runtimeId: selection.runtimeId,
        },
        modelId: null,
        resolvedPath: selection.filePath,
        runtimeId: selection.runtimeId,
        selection,
      });

      await harness.manager.validateAndSelectExternalFile(selection.filePath, selection);

      expect(harness.sidecarConnection.probeModelSelection).toHaveBeenCalledWith(
        expect.objectContaining({ modelSelection: selection }),
      );
      expect(harness.getSettings().selectedModel).toEqual(selection);
    });

    it('refuses to persist when the probe reports the model as unavailable', async () => {
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce({
        ...sampleReadyProbeResult(),
        available: false,
        details: 'missing install metadata',
        installed: false,
        mergedCapabilities: null,
        message: 'Model is not installed.',
        resolvedPath: null,
        sizeBytes: null,
        status: 'missing',
      });

      await expect(harness.manager.select(sampleSelection())).rejects.toThrow(
        'Model is not installed. (missing install metadata)',
      );
      expect(harness.getSettings().selectedModel).toBeNull();
    });

    it('clearSelection clears both selectedModel and capabilities', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());
      await harness.manager.init();
      await vi.waitFor(() => {
        expect(harness.manager.getState().selectedModelCapabilities.status).toBe('ready');
      });

      await harness.manager.clearSelection();

      expect(harness.getSettings().selectedModel).toBeNull();
      expect(harness.manager.getState().selectedModelCapabilities).toEqual({ status: 'none' });
    });
  });

  describe('selection / install independence', () => {
    beforeEach(async () => {
      configureSidecarForInit(harness.sidecarConnection);
    });

    it('starting an install does not block selecting a different model', async () => {
      await harness.manager.init();
      emitInstallUpdate(harness, { modelId: 'whisper_small_en_q5_1', installId: 'install-sel' });
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());

      await harness.manager.select(sampleSelection());

      expect(harness.getSettings().selectedModel).toEqual(sampleSelection());
      expect(harness.manager.getState().activeInstall?.installUpdate.installId).toBe('install-sel');
    });

    it('completing an install never mutates the persisted selection', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel()],
      });

      emitInstallUpdate(harness, { modelId: 'whisper_small_en_q5_1', installId: 'install-comp' });
      emitInstallUpdate(harness, {
        installId: 'install-comp',
        modelId: 'whisper_small_en_q5_1',
        state: 'completed',
      });

      await vi.waitFor(() => {
        expect(harness.sidecarConnection.listInstalledModels).toHaveBeenCalledTimes(2);
      });
      expect(harness.getSettings().selectedModel).toEqual(sampleSelection());
    });

    it('cancelling an install never mutates the persisted selection', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();

      emitInstallUpdate(harness, { modelId: 'whisper_small_en_q5_1', installId: 'install-cancel' });
      await harness.manager.cancel();
      emitInstallUpdate(harness, {
        installId: 'install-cancel',
        modelId: 'whisper_small_en_q5_1',
        state: 'cancelled',
      });

      expect(harness.getSettings().selectedModel).toEqual(sampleSelection());
    });

    it('auto-selects the just-installed model when nothing is currently selected', async () => {
      // First-install UX: a fresh user installing their first model shouldn't
      // need a second "Use" click. After completion, the manager probes and
      // persists the selection automatically.
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      expect(harness.getSettings().selectedModel).toBeNull();
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());

      emitInstallUpdate(harness, { installId: 'install-auto' });
      emitInstallUpdate(harness, { installId: 'install-auto', state: 'completed' });

      await vi.waitFor(() => {
        expect(harness.getSettings().selectedModel).toEqual(sampleSelection());
      });
    });

    it('does not auto-select after install when a selection already exists', async () => {
      const existing = sampleSelection('whisper_small_en_q5_1');
      harness = createManagerHarness({ selectedModel: existing });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      harness.sidecarConnection.probeModelSelection.mockClear();

      emitInstallUpdate(harness, { installId: 'install-keep' });
      emitInstallUpdate(harness, { installId: 'install-keep', state: 'completed' });

      await vi.waitFor(() => {
        expect(harness.sidecarConnection.listInstalledModels).toHaveBeenCalledTimes(2);
      });
      expect(harness.getSettings().selectedModel).toEqual(existing);
      expect(harness.sidecarConnection.probeModelSelection).not.toHaveBeenCalled();
    });
  });

  describe('selectedModelCapabilities', () => {
    it('is `none` when no model is selected', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();

      expect(harness.manager.getState().selectedModelCapabilities).toEqual({ status: 'none' });
    });

    it('transitions pending → ready when a previously-selected model probes successfully', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      let resolveProbe!: (result: ReturnType<typeof sampleReadyProbeResult>) => void;
      harness.sidecarConnection.probeModelSelection.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
      );

      await harness.manager.init();
      expect(harness.manager.getState().selectedModelCapabilities).toEqual({
        selection: sampleSelection(),
        status: 'pending',
      });

      resolveProbe(sampleReadyProbeResult());
      await vi.waitFor(() => {
        expect(harness.manager.getState().selectedModelCapabilities).toEqual({
          capabilities: sampleMergedCapabilities(),
          selection: sampleSelection(),
          status: 'ready',
        });
      });
    });

    it('maps a non-throwing probe failure to `unavailable` with the message', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce({
        ...sampleReadyProbeResult(),
        available: false,
        details: 'file not found',
        displayName: null,
        installed: false,
        mergedCapabilities: null,
        message: 'Model is not installed.',
        resolvedPath: null,
        sizeBytes: null,
        status: 'missing',
      });

      await harness.manager.init();

      await vi.waitFor(() => {
        expect(harness.manager.getState().selectedModelCapabilities).toEqual({
          details: 'Model is not installed. (file not found)',
          reason: 'missing',
          selection: sampleSelection(),
          status: 'unavailable',
        });
      });
    });

    it('maps a thrown probe error to `unavailable` with reason=probe_failed', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      harness.sidecarConnection.probeModelSelection.mockRejectedValueOnce(
        new Error('sidecar pipe closed'),
      );

      await harness.manager.init();

      await vi.waitFor(() => {
        expect(harness.manager.getState().selectedModelCapabilities).toEqual({
          reason: 'probe_failed',
          selection: sampleSelection(),
          status: 'unavailable',
        });
      });
    });

    it('select() populates ready capabilities without an extra probe round-trip', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());

      await harness.manager.select(sampleSelection());

      expect(harness.sidecarConnection.probeModelSelection).toHaveBeenCalledTimes(1);
      expect(harness.manager.getState().selectedModelCapabilities).toEqual({
        capabilities: sampleMergedCapabilities(),
        selection: sampleSelection(),
        status: 'ready',
      });
    });

    it('select() persists a capabilities snapshot alongside the selection', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());

      await harness.manager.select(sampleSelection());

      expect(harness.getSettings().selectedModelCapabilitiesSnapshot).toEqual({
        capabilities: sampleMergedCapabilities(),
        selection: sampleSelection(),
      });
    });
  });

  describe('startup probe skip (issue #195)', () => {
    it('trusts a matching persisted capabilities snapshot on init and never probes the sidecar', async () => {
      harness = createManagerHarness({
        selectedModel: sampleSelection(),
        selectedModelCapabilitiesSnapshot: {
          capabilities: sampleMergedCapabilities(),
          selection: sampleSelection(),
        },
      });
      configureSidecarForInit(harness.sidecarConnection);

      await harness.manager.init();

      expect(harness.sidecarConnection.probeModelSelection).not.toHaveBeenCalled();
      expect(harness.manager.getState().selectedModelCapabilities).toEqual({
        capabilities: sampleMergedCapabilities(),
        selection: sampleSelection(),
        status: 'ready',
      });
    });

    it('falls back to probing when the persisted snapshot belongs to a different selection', async () => {
      harness = createManagerHarness({
        selectedModel: sampleSelection(),
        selectedModelCapabilitiesSnapshot: {
          capabilities: sampleMergedCapabilities(),
          selection: sampleSelection('whisper_small_en_q5_1'),
        },
      });
      configureSidecarForInit(harness.sidecarConnection);
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());

      await harness.manager.init();

      await vi.waitFor(() => {
        expect(harness.sidecarConnection.probeModelSelection).toHaveBeenCalledTimes(1);
        expect(harness.manager.getState().selectedModelCapabilities).toEqual({
          capabilities: sampleMergedCapabilities(),
          selection: sampleSelection(),
          status: 'ready',
        });
      });
    });

    it('falls back to probing when no snapshot has been persisted', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());

      await harness.manager.init();

      await vi.waitFor(() => {
        expect(harness.sidecarConnection.probeModelSelection).toHaveBeenCalledTimes(1);
      });
    });

    it('re-selecting a model whose probe now fails invalidates its persisted snapshot', async () => {
      harness = createManagerHarness({
        selectedModel: sampleSelection(),
        selectedModelCapabilitiesSnapshot: {
          capabilities: sampleMergedCapabilities(),
          selection: sampleSelection(),
        },
      });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      expect(harness.sidecarConnection.probeModelSelection).not.toHaveBeenCalled();

      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce({
        ...sampleReadyProbeResult(),
        available: false,
        details: 'file removed',
        installed: false,
        mergedCapabilities: null,
        message: 'Model is not installed.',
        resolvedPath: null,
        sizeBytes: null,
        status: 'missing',
      });

      await expect(harness.manager.select(sampleSelection())).rejects.toThrow(
        'Model is not installed. (file removed)',
      );
      expect(harness.getSettings().selectedModelCapabilitiesSnapshot).toBeNull();
    });

    it('clearSelection() clears the persisted capabilities snapshot', async () => {
      harness = createManagerHarness({
        selectedModel: sampleSelection(),
        selectedModelCapabilitiesSnapshot: {
          capabilities: sampleMergedCapabilities(),
          selection: sampleSelection(),
        },
      });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();

      await harness.manager.clearSelection();

      expect(harness.getSettings().selectedModelCapabilitiesSnapshot).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface ManagerHarness {
  emit(event: SidecarEvent): void;
  getSettings(): PluginSettings;
  manager: ModelInstallManager;
  sidecarConnection: ReturnType<typeof createSidecarConnectionStub>;
}

function createManagerHarness(settingsOverride?: Partial<PluginSettings>): ManagerHarness {
  const listeners = new Set<(event: SidecarEvent) => void>();
  const sidecarConnection = createSidecarConnectionStub(listeners);
  let settings: PluginSettings = { ...DEFAULT_PLUGIN_SETTINGS, ...settingsOverride };

  const manager = new ModelInstallManager({
    getSettings: () => settings,
    saveSettings: async (next) => {
      settings = next;
    },
    sidecarConnection,
  });

  return {
    emit: (event) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
    getSettings: () => settings,
    manager,
    sidecarConnection,
  };
}

function createSidecarConnectionStub(listeners: Set<(event: SidecarEvent) => void>) {
  return {
    cancelModelInstall: vi.fn(() => {}),
    getModelStore: vi.fn(),
    getSystemInfo: vi.fn(),
    installModel: vi.fn(),
    listInstalledModels: vi.fn(),
    listModelCatalog: vi.fn(),
    probeModelSelection: vi.fn(),
    removeModel: vi.fn(),
    subscribe: (listener: (event: SidecarEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function configureSidecarForInit(
  sidecarConnection: ReturnType<typeof createSidecarConnectionStub>,
): void {
  sidecarConnection.listModelCatalog.mockResolvedValue(sampleCatalog());
  sidecarConnection.listInstalledModels.mockResolvedValue({
    models: [sampleInstalledModel()],
  });
  sidecarConnection.getModelStore.mockResolvedValue(sampleModelStore());
  sidecarConnection.getSystemInfo.mockResolvedValue(sampleSystemInfo());
}

function emitInstallUpdate(harness: ManagerHarness, overrides?: Partial<ModelInstallUpdateRecord>) {
  harness.emit({
    ...sampleInstallUpdate(overrides),
    type: 'model_install_update',
  });
}

// ---------------------------------------------------------------------------
// Fixtures (test-local; shared model/install fixtures live in fixtures/models.ts)
// ---------------------------------------------------------------------------

function sampleSystemInfo() {
  return {
    compiledAdapters: [
      {
        displayName: 'Cohere Transcribe',
        familyCapabilities: {
          maxAudioDurationSecs: null,
          producesPunctuation: true,
          supportedLanguages: { kind: 'all' as const },
          supportsInitialPrompt: false,
          supportsStreaming: false,
          supportsLanguageSelection: true,
          supportsSegmentTimestamps: true,
          supportsWordTimestamps: false,
        },
        familyId: 'cohere_transcribe' as const,
        runtimeId: 'onnx_runtime' as const,
      },
      {
        displayName: 'Moonshine',
        familyCapabilities: {
          maxAudioDurationSecs: null,
          producesPunctuation: true,
          supportedLanguages: { kind: 'english_only' as const },
          supportsInitialPrompt: false,
          supportsStreaming: true,
          supportsLanguageSelection: false,
          supportsSegmentTimestamps: false,
          supportsWordTimestamps: false,
        },
        familyId: 'moonshine' as const,
        runtimeId: 'onnx_runtime' as const,
      },
      {
        displayName: 'Whisper',
        familyCapabilities: {
          maxAudioDurationSecs: null,
          producesPunctuation: true,
          supportedLanguages: { kind: 'all' as const },
          supportsInitialPrompt: true,
          supportsStreaming: false,
          supportsLanguageSelection: true,
          supportsSegmentTimestamps: true,
          supportsWordTimestamps: false,
        },
        familyId: 'whisper' as const,
        runtimeId: 'whisper_cpp' as const,
      },
    ],
    compiledRuntimes: [
      {
        displayName: 'ONNX Runtime',
        runtimeCapabilities: {
          acceleratorDetails: {
            cpu: { available: true, unavailableReason: null },
          },
          availableAccelerators: ['cpu' as const],
          supportedModelFormats: ['onnx' as const],
        },
        runtimeId: 'onnx_runtime' as const,
      },
      {
        displayName: 'Whisper.cpp',
        runtimeCapabilities: {
          acceleratorDetails: {
            cpu: { available: true, unavailableReason: null },
          },
          availableAccelerators: ['cpu' as const],
          supportedModelFormats: ['ggml' as const, 'gguf' as const],
        },
        runtimeId: 'whisper_cpp' as const,
      },
    ],
    sidecarVersion: '0.0.0-test',
    systemInfo: 'stub',
    type: 'system_info' as const,
  };
}

function sampleMergedCapabilities(): EngineCapabilitiesRecord {
  return {
    family: {
      maxAudioDurationSecs: null,
      producesPunctuation: true,
      supportedLanguages: { kind: 'english_only' },
      supportsInitialPrompt: true,
      supportsStreaming: false,
      supportsLanguageSelection: false,
      supportsSegmentTimestamps: true,
      supportsWordTimestamps: false,
    },
    familyId: 'whisper',
    runtime: {
      acceleratorDetails: {
        cpu: { available: true, unavailableReason: null },
      },
      availableAccelerators: ['cpu'],
      supportedModelFormats: ['ggml'],
    },
    runtimeId: 'whisper_cpp',
  };
}

function sampleReadyProbeResult(selection: CatalogModelSelection = sampleSelection()) {
  const isMoonshine = selection.familyId === 'moonshine';
  const mergedCapabilities = sampleMergedCapabilities();

  return {
    available: true,
    details: null,
    displayName: isMoonshine ? 'Moonshine Small' : 'Whisper Large V3 Turbo Q8_0',
    familyId: selection.familyId,
    installed: true,
    mergedCapabilities: {
      ...mergedCapabilities,
      family: {
        ...mergedCapabilities.family,
        supportsInitialPrompt: !isMoonshine,
        supportsStreaming: isMoonshine,
      },
      familyId: selection.familyId,
      runtime: {
        ...mergedCapabilities.runtime,
        supportedModelFormats: isMoonshine ? (['onnx'] as const) : ['ggml'],
      },
      runtimeId: selection.runtimeId,
    },
    message: 'Model selection is ready.',
    modelId: 'modelId' in selection ? selection.modelId : null,
    resolvedPath: isMoonshine
      ? '/models/onnx_runtime/moonshine_small_streaming_en/frontend.ort'
      : '/models/whisper_cpp/whisper_large_v3_turbo_q8_0/model.bin',
    runtimeId: selection.runtimeId,
    selection,
    sizeBytes: isMoonshine ? 700 : 900,
    status: 'ready' as const,
  };
}
