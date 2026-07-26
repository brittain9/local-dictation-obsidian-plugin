import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInstallLifecycleLogMessage,
  isTerminalInstallState,
  ModelInstallManager,
} from '../src/models/model-install-manager';
import type {
  CatalogModelRecord,
  CatalogModelSelection,
  EngineCapabilitiesRecord,
  InstalledModelRecord,
  ModelInstallUpdateRecord,
} from '../src/models/model-management-types';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import type { SidecarEvent, SystemInfoEvent } from '../src/sidecar/protocol';
import {
  SidecarLifecycleConflictError,
  SidecarLifecycleGate,
} from '../src/sidecar/sidecar-lifecycle-gate';
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

  it.each(['failed', 'verifying', 'probing', 'queued'] as const)(
    'returns null at intermediate state %s',
    (state) => {
      expect(createInstallLifecycleLogMessage({ ...sampleInstallUpdate(), state })).toBeNull();
    },
  );
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
    vi.restoreAllMocks();
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

    it('blocks downloading a model that cannot serve the selected language', async () => {
      harness = createManagerHarness({ dictationLanguage: 'ja' });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();

      await expect(harness.manager.install(sampleMoonshineSelection())).rejects.toThrow(
        'does not support 日本語',
      );
      expect(harness.sidecarConnection.installModel).not.toHaveBeenCalled();
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
      const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (request === undefined) throw new Error('Expected an install request');

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
      emitInstallUpdate(harness, {
        ...installUpdate,
        installId: request.installId,
        state: 'downloading',
      });
      emitInstallUpdate(harness, {
        ...installUpdate,
        installId: request.installId,
        state: 'completed',
      });

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

    it.each(['completed', 'failed', 'cancelled'] as const)(
      'returns to idle on terminal state %s',
      (state) => {
        emitInstallUpdate(harness);
        emitInstallUpdate(harness, { state });

        expect(harness.manager.getState().activeInstall).toBeNull();
      },
    );

    it('retains a safe exact request when a manager-initiated install fails', async () => {
      const artifactIds = ['voice-alba', 'voice-cosette'];
      const selection = sampleSelection();
      harness.sidecarConnection.installModel.mockResolvedValueOnce(
        sampleInstallUpdate({ state: 'queued' }),
      );

      await harness.manager.install(selection, artifactIds);
      const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (request === undefined) throw new Error('Expected an install request');
      selection.modelId = 'mutated-model';
      artifactIds.push('mutated-voice');

      emitInstallUpdate(harness, {
        details: '/private/models/download.tmp',
        installId: request.installId,
        message: 'hash mismatch at https://download.example.com/model',
        state: 'failed',
      });

      expect(harness.manager.getState()).toMatchObject({
        activeInstall: null,
        failedInstall: {
          artifactIds: ['voice-alba', 'voice-cosette'],
          failureId: request.installId,
          // Kept verbatim: the row reports the reason in place, and "hash mismatch"
          // is the only thing that tells the user a retry is worth attempting.
          message: 'hash mismatch at https://download.example.com/model',
          selection: sampleSelection(),
        },
      });
      expect(harness.manager.getState().failedInstall).not.toHaveProperty('details');
    });

    it('copies failed request arrays when exposing state', async () => {
      harness.sidecarConnection.installModel.mockResolvedValueOnce(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(sampleSelection(), ['voice-alba']);
      const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (request === undefined) throw new Error('Expected an install request');
      emitInstallUpdate(harness, {
        installId: request.installId,
        message: 'connection reset by peer',
        state: 'failed',
      });

      const exposed = harness.manager.getState().failedInstall;
      if (exposed === null) throw new Error('Expected a failed install');
      exposed.artifactIds?.push('mutated-voice');
      exposed.selection.modelId = 'mutated-model';

      expect(harness.manager.getState().failedInstall).toEqual({
        artifactIds: ['voice-alba'],
        failureId: request.installId,
        message: 'connection reset by peer',
        selection: sampleSelection(),
      });
    });

    it('publishes a recoverable failure and rethrows when the initial command rejects', async () => {
      const error = new Error('permission denied at /private/models');
      harness.sidecarConnection.installModel.mockRejectedValueOnce(error);
      const onStateChange = vi.fn();
      harness.manager.subscribe(onStateChange);

      await expect(harness.manager.install(sampleSelection(), ['voice-alba'])).rejects.toBe(error);

      expect(harness.manager.getState().failedInstall).toMatchObject({
        artifactIds: ['voice-alba'],
        selection: sampleSelection(),
      });
      expect(harness.logger.warn).toHaveBeenCalledWith(
        'model',
        expect.stringContaining('failed before progress'),
        error,
      );
      expect(onStateChange).toHaveBeenCalledOnce();
    });

    it('resumes a rejected request when same-ID progress arrives late', async () => {
      harness.sidecarConnection.installModel.mockRejectedValueOnce(
        new Error('Timed out waiting for sidecar event'),
      );

      await expect(harness.manager.install(sampleSelection(), ['voice-alba'])).rejects.toThrow(
        'Timed out waiting for sidecar event',
      );
      const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (request === undefined) throw new Error('Expected an install request');

      emitInstallUpdate(harness, {
        downloadedBytes: 128,
        installId: request.installId,
        state: 'downloading',
      });

      expect(harness.manager.getState()).toMatchObject({
        activeInstall: {
          installUpdate: {
            downloadedBytes: 128,
            installId: request.installId,
          },
          phase: 'installing',
        },
        failedInstall: null,
      });
      await expect(
        harness.manager.install(sampleSelection('whisper_small_en_q5_1')),
      ).rejects.toThrow('Another model is already being installed.');
      expect(harness.sidecarConnection.installModel).toHaveBeenCalledOnce();

      harness.getSettings().selectedModel = sampleSelection();
      emitInstallUpdate(harness, { installId: request.installId, state: 'completed' });
      expect(harness.manager.getState()).toMatchObject({
        activeInstall: null,
        failedInstall: null,
      });
    });

    it.each([
      ['completed', null],
      ['cancelled', null],
      ['failed', 'retained'],
    ] as const)(
      'reconciles a rejected request when same-ID %s arrives late',
      async (state, expectedFailure) => {
        harness.sidecarConnection.installModel.mockRejectedValueOnce(
          new Error('Timed out waiting for sidecar event'),
        );
        await expect(harness.manager.install(sampleSelection())).rejects.toThrow(
          'Timed out waiting for sidecar event',
        );
        const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
        if (request === undefined) throw new Error('Expected an install request');
        harness.getSettings().selectedModel = sampleSelection();

        emitInstallUpdate(harness, { installId: request.installId, state });

        expect(harness.manager.getState().activeInstall).toBeNull();
        if (expectedFailure === null) {
          expect(harness.manager.getState().failedInstall).toBeNull();
        } else {
          expect(harness.manager.getState().failedInstall?.failureId).toBe(request.installId);
        }
      },
    );

    it('refreshes without auto-selecting an unmatched completion over a newer request', async () => {
      harness.sidecarConnection.installModel
        .mockRejectedValueOnce(new Error('Timed out waiting for sidecar event'))
        .mockResolvedValueOnce(sampleInstallUpdate({ state: 'queued' }));

      await expect(harness.manager.install(sampleSelection())).rejects.toThrow(
        'Timed out waiting for sidecar event',
      );
      const staleRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (staleRequest === undefined) throw new Error('Expected a stale install request');

      await harness.manager.install(sampleSelection('whisper_small_en_q5_1'));
      const currentRequest = harness.sidecarConnection.installModel.mock.calls[1]?.[0];
      if (currentRequest === undefined) throw new Error('Expected a current install request');
      harness.sidecarConnection.listInstalledModels.mockClear();
      harness.sidecarConnection.probeModelSelection.mockClear();

      emitInstallUpdate(harness, {
        installId: staleRequest.installId,
        modelId: staleRequest.modelId,
        state: 'completed',
      });

      await vi.waitFor(() => {
        expect(harness.sidecarConnection.listInstalledModels).toHaveBeenCalledOnce();
      });
      expect(harness.sidecarConnection.probeModelSelection).not.toHaveBeenCalled();
      expect(harness.getSettings().selectedModel).toBeNull();
      await expect(harness.manager.install(sampleSelection())).rejects.toThrow(
        'Another model is already being installed.',
      );
      expect(harness.sidecarConnection.installModel).toHaveBeenCalledTimes(2);
      expect(currentRequest.installId).not.toBe(staleRequest.installId);
    });

    it('does not auto-select when a newer install starts during the completion refresh', async () => {
      const completedSelection = sampleSelection('whisper_small_en_q5_1');
      harness.sidecarConnection.installModel.mockResolvedValue(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(completedSelection);
      const completedRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (completedRequest === undefined) throw new Error('Expected a completed request');

      let resolveRefresh: (value: { models: InstalledModelRecord[] }) => void = () => {};
      const pendingRefresh = new Promise<{ models: InstalledModelRecord[] }>((resolve) => {
        resolveRefresh = resolve;
      });
      harness.sidecarConnection.listInstalledModels.mockClear();
      harness.sidecarConnection.listInstalledModels.mockReturnValueOnce(pendingRefresh);
      harness.sidecarConnection.probeModelSelection.mockClear();

      emitInstallUpdate(harness, {
        installId: completedRequest.installId,
        modelId: completedSelection.modelId,
        state: 'completed',
      });
      await vi.waitFor(() => {
        expect(harness.sidecarConnection.listInstalledModels).toHaveBeenCalledOnce();
      });

      await harness.manager.install(sampleSelection());
      resolveRefresh({
        models: [sampleInstalledModel(), sampleInstalledModel(completedSelection.modelId)],
      });

      await vi.waitFor(() => {
        expect(harness.manager.getState().installedModels).toHaveLength(2);
      });
      expect(harness.getSettings().selectedModel).toBeNull();
      expect(harness.sidecarConnection.probeModelSelection).not.toHaveBeenCalled();
    });

    it('does not auto-select over an explicit selection started during its probe', async () => {
      const completedSelection = sampleSelection('whisper_small_en_q5_1');
      const explicitSelection = sampleSelection();
      harness.sidecarConnection.installModel.mockResolvedValue(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(completedSelection);
      const completedRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (completedRequest === undefined) throw new Error('Expected a completed request');
      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel(), sampleInstalledModel(completedSelection.modelId)],
      });
      const autoProbe = deferred<ReturnType<typeof sampleReadyProbeResult>>();
      harness.sidecarConnection.probeModelSelection
        .mockReturnValueOnce(autoProbe.promise)
        .mockResolvedValueOnce(sampleReadyProbeResult(explicitSelection));

      emitInstallUpdate(harness, {
        installId: completedRequest.installId,
        modelId: completedSelection.modelId,
        state: 'completed',
      });
      await vi.waitFor(() => {
        expect(harness.sidecarConnection.probeModelSelection).toHaveBeenCalledOnce();
      });

      await harness.manager.select(explicitSelection);
      autoProbe.resolve(sampleReadyProbeResult(completedSelection));
      await Promise.resolve();
      await Promise.resolve();

      await vi.waitFor(() => {
        expect(harness.getSettings().selectedModel).toEqual(explicitSelection);
      });
      expect(harness.getSettings().selectedModel).not.toEqual(completedSelection);
    });

    it('does not auto-select when a newer install starts during its probe', async () => {
      const completedSelection = sampleSelection('whisper_small_en_q5_1');
      harness.sidecarConnection.installModel.mockResolvedValue(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(completedSelection);
      const completedRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (completedRequest === undefined) throw new Error('Expected a completed request');
      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel(), sampleInstalledModel(completedSelection.modelId)],
      });
      const autoProbe = deferred<ReturnType<typeof sampleReadyProbeResult>>();
      harness.sidecarConnection.probeModelSelection.mockReturnValueOnce(autoProbe.promise);

      emitInstallUpdate(harness, {
        installId: completedRequest.installId,
        modelId: completedSelection.modelId,
        state: 'completed',
      });
      await vi.waitFor(() => {
        expect(harness.sidecarConnection.probeModelSelection).toHaveBeenCalledOnce();
      });

      await harness.manager.install(sampleSelection());
      autoProbe.resolve(sampleReadyProbeResult(completedSelection));
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.getSettings().selectedModel).toBeNull();
    });

    it('does not commit a pending completion refresh after disposal', async () => {
      const completedSelection = sampleSelection('whisper_small_en_q5_1');
      harness.sidecarConnection.installModel.mockResolvedValueOnce(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(completedSelection);
      const completedRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (completedRequest === undefined) throw new Error('Expected a completed request');
      const pendingRefresh = deferred<{ models: InstalledModelRecord[] }>();
      harness.sidecarConnection.listInstalledModels.mockClear();
      harness.sidecarConnection.listInstalledModels.mockReturnValueOnce(pendingRefresh.promise);
      harness.sidecarConnection.probeModelSelection.mockClear();

      emitInstallUpdate(harness, {
        installId: completedRequest.installId,
        modelId: completedSelection.modelId,
        state: 'completed',
      });
      await vi.waitFor(() => {
        expect(harness.sidecarConnection.listInstalledModels).toHaveBeenCalledOnce();
      });

      harness.manager.dispose();
      pendingRefresh.resolve({
        models: [sampleInstalledModel(), sampleInstalledModel(completedSelection.modelId)],
      });
      await Promise.resolve();

      expect(harness.manager.getState().installedModels).toEqual([sampleInstalledModel()]);
      expect(harness.getSettings().selectedModel).toBeNull();
      expect(harness.sidecarConnection.probeModelSelection).not.toHaveBeenCalled();
    });

    it('clears a retry failure when the original timed-out install later completes', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(100);
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
      const selection = sampleSelection('whisper_small_en_q5_1');
      harness.sidecarConnection.installModel
        .mockRejectedValueOnce(new Error('Timed out waiting for sidecar event'))
        .mockRejectedValueOnce(new Error('Another install is already active'));

      await expect(harness.manager.install(selection)).rejects.toThrow(
        'Timed out waiting for sidecar event',
      );
      const originalRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (originalRequest === undefined) throw new Error('Expected an original request');

      await expect(harness.manager.retryFailedInstall(originalRequest.installId)).rejects.toThrow(
        'Another install is already active',
      );
      const retryFailure = harness.manager.getState().failedInstall;
      if (retryFailure === null) throw new Error('Expected a retry failure');
      expect(retryFailure.failureId).not.toBe(originalRequest.installId);

      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel(), sampleInstalledModel(selection.modelId)],
      });
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(
        sampleReadyProbeResult(selection),
      );
      emitInstallUpdate(harness, {
        installId: originalRequest.installId,
        modelId: selection.modelId,
        state: 'completed',
      });

      await vi.waitFor(() => {
        expect(harness.manager.getState().failedInstall).toBeNull();
        expect(harness.getSettings().selectedModel).toEqual(selection);
      });
    });

    it.each([
      { expectedCleared: false, installedVoiceIds: [] },
      { expectedCleared: true, installedVoiceIds: ['alba'] },
    ])(
      'clears a timed-out voice retry only when the requested voice is installed',
      async ({ expectedCleared, installedVoiceIds }) => {
        vi.spyOn(Date, 'now').mockReturnValue(100);
        vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
        const selection = sampleTtsVoiceSelection();
        harness.manager.getState().catalog.models.push(sampleTtsVoiceCatalogModel());
        harness.getSettings().selectedTtsModel = selection;
        harness.sidecarConnection.installModel
          .mockRejectedValueOnce(new Error('Timed out waiting for sidecar event'))
          .mockRejectedValueOnce(new Error('Another install is already active'));

        await expect(harness.manager.install(selection, ['voice-alba'])).rejects.toThrow(
          'Timed out waiting for sidecar event',
        );
        const originalRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
        if (originalRequest === undefined) throw new Error('Expected an original request');
        await expect(harness.manager.retryFailedInstall(originalRequest.installId)).rejects.toThrow(
          'Another install is already active',
        );

        harness.sidecarConnection.listInstalledModels.mockClear();
        harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
          models: [
            sampleInstalledModel(),
            sampleInstalledModel(selection.modelId, {
              familyId: selection.familyId,
              installedVoiceIds,
              runtimeId: selection.runtimeId,
            }),
          ],
        });
        emitInstallUpdate(harness, {
          familyId: selection.familyId,
          installId: originalRequest.installId,
          modelId: selection.modelId,
          runtimeId: selection.runtimeId,
          state: 'completed',
        });

        await vi.waitFor(() => {
          expect(harness.sidecarConnection.listInstalledModels).toHaveBeenCalledOnce();
          expect(harness.manager.getState().failedInstall === null).toBe(expectedCleared);
        });
      },
    );

    it.each(['completed', 'cancelled'] as const)(
      'does not create a failure for a manager-initiated %s install',
      async (state) => {
        harness.sidecarConnection.installModel.mockResolvedValueOnce(
          sampleInstallUpdate({ state: 'queued' }),
        );
        await harness.manager.install(sampleSelection());
        const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
        if (request === undefined) throw new Error('Expected an install request');

        emitInstallUpdate(harness, { installId: request.installId, state });

        expect(harness.manager.getState()).toMatchObject({
          activeInstall: null,
          failedInstall: null,
        });
      },
    );

    it('retries the exact request once with a fresh install ID', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(100);
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
      harness.sidecarConnection.installModel.mockResolvedValue(
        sampleInstallUpdate({ state: 'queued' }),
      );

      await harness.manager.install(sampleSelection(), ['voice-alba', 'voice-cosette']);
      const firstRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (firstRequest === undefined) throw new Error('Expected an install request');
      emitInstallUpdate(harness, { installId: firstRequest.installId, state: 'failed' });

      const firstRetry = harness.manager.retryFailedInstall(firstRequest.installId);
      const staleRetry = harness.manager.retryFailedInstall(firstRequest.installId);
      await expect(staleRetry).resolves.toBeNull();
      await firstRetry;

      expect(harness.sidecarConnection.installModel).toHaveBeenCalledTimes(2);
      const retryRequest = harness.sidecarConnection.installModel.mock.calls[1]?.[0];
      expect(retryRequest).toMatchObject({
        artifactIds: ['voice-alba', 'voice-cosette'],
        familyId: firstRequest.familyId,
        modelId: firstRequest.modelId,
        runtimeId: firstRequest.runtimeId,
      });
      expect(retryRequest?.installId).not.toBe(firstRequest.installId);
      expect(harness.manager.getState().failedInstall).toBeNull();
    });

    it('keeps stale dismiss and retry actions from affecting a newer failure', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(100);
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.1)
        .mockReturnValueOnce(0.2)
        .mockReturnValueOnce(0.3);
      harness.sidecarConnection.installModel.mockResolvedValue(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(sampleSelection(), ['voice-alba']);
      const firstRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (firstRequest === undefined) throw new Error('Expected an install request');
      emitInstallUpdate(harness, { installId: firstRequest.installId, state: 'failed' });

      await harness.manager.retryFailedInstall(firstRequest.installId);
      const retryRequest = harness.sidecarConnection.installModel.mock.calls[1]?.[0];
      if (retryRequest === undefined) throw new Error('Expected a retry request');
      emitInstallUpdate(harness, { installId: retryRequest.installId, state: 'failed' });

      harness.manager.dismissFailedInstall(firstRequest.installId);
      await expect(harness.manager.retryFailedInstall(firstRequest.installId)).resolves.toBeNull();

      expect(harness.manager.getState().failedInstall?.failureId).toBe(retryRequest.installId);
      expect(harness.sidecarConnection.installModel).toHaveBeenCalledTimes(2);
    });

    it('preserves a failure across rejected preflight and clears it for an accepted attempt', async () => {
      harness.sidecarConnection.installModel.mockResolvedValue(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(sampleSelection(), ['voice-alba']);
      const failedRequest = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (failedRequest === undefined) throw new Error('Expected an install request');
      emitInstallUpdate(harness, { installId: failedRequest.installId, state: 'failed' });

      harness.getSettings().dictationLanguage = 'ja';
      await expect(harness.manager.install(sampleMoonshineSelection())).rejects.toThrow(
        'does not support 日本語',
      );
      expect(harness.manager.getState().failedInstall?.failureId).toBe(failedRequest.installId);
      expect(harness.sidecarConnection.installModel).toHaveBeenCalledOnce();

      harness.getSettings().dictationLanguage = 'en';
      const acceptedAttempt = harness.manager.install(sampleSelection('whisper_small_en_q5_1'));
      expect(harness.manager.getState().failedInstall).toBeNull();
      await acceptedAttempt;
    });

    it('ignores unmatched terminal failures without fabricating retry intent', async () => {
      harness.sidecarConnection.installModel.mockResolvedValueOnce(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(sampleSelection(), ['voice-alba']);
      const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (request === undefined) throw new Error('Expected an install request');

      emitInstallUpdate(harness, { installId: 'unmatched-install', state: 'failed' });

      expect(harness.manager.getState().failedInstall).toBeNull();
      await expect(harness.manager.install(sampleSelection())).rejects.toThrow(
        'Another model is already being installed.',
      );
    });

    it('dismisses only the matching failure and drops recovery state on dispose', async () => {
      harness.sidecarConnection.installModel.mockResolvedValueOnce(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(sampleSelection());
      const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (request === undefined) throw new Error('Expected an install request');
      emitInstallUpdate(harness, { installId: request.installId, state: 'failed' });

      harness.manager.dismissFailedInstall('stale-failure');
      expect(harness.manager.getState().failedInstall?.failureId).toBe(request.installId);
      expect(harness.manager.getState().failedInstall?.artifactIds).toBeNull();
      harness.manager.dismissFailedInstall(request.installId);
      expect(harness.manager.getState().failedInstall).toBeNull();

      harness.sidecarConnection.installModel.mockResolvedValueOnce(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(sampleSelection());
      const nextRequest = harness.sidecarConnection.installModel.mock.calls[1]?.[0];
      if (nextRequest === undefined) throw new Error('Expected another install request');
      emitInstallUpdate(harness, { installId: nextRequest.installId, state: 'failed' });
      expect(harness.manager.getState().failedInstall).not.toBeNull();

      harness.manager.dispose();
      expect(harness.manager.getState().failedInstall).toBeNull();
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

    it('publishes refreshed same-model voice metadata after an incremental install', async () => {
      harness = createManagerHarness({ selectedModel: sampleSelection() });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      const installedTts = sampleInstalledModel('pocket_tts_english_2026_04_int8', {
        familyId: 'pocket_tts',
        installedVoiceIds: ['alba', 'cosette'],
        runtimeId: 'onnx_runtime',
      });
      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel(), installedTts],
      });

      emitInstallUpdate(harness, {
        familyId: 'pocket_tts',
        installId: 'voice-install',
        modelId: installedTts.modelId,
        runtimeId: 'onnx_runtime',
      });
      emitInstallUpdate(harness, {
        familyId: 'pocket_tts',
        installId: 'voice-install',
        modelId: installedTts.modelId,
        runtimeId: 'onnx_runtime',
        state: 'completed',
      });

      await vi.waitFor(() => {
        expect(
          harness.manager
            .getState()
            .installedModels.find((model) => model.modelId === installedTts.modelId)
            ?.installedVoiceIds,
        ).toEqual(['alba', 'cosette']);
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

    it('dismissCancelStuck releases a manager-initiated request for a future install', async () => {
      harness.sidecarConnection.installModel.mockResolvedValue(
        sampleInstallUpdate({ state: 'queued' }),
      );
      await harness.manager.install(sampleSelection());
      const request = harness.sidecarConnection.installModel.mock.calls[0]?.[0];
      if (request === undefined) throw new Error('Expected an install request');
      emitInstallUpdate(harness, { installId: request.installId });
      await harness.manager.cancel();
      vi.advanceTimersByTime(30_000);
      harness.sidecarConnection.listInstalledModels.mockResolvedValueOnce({
        models: [sampleInstalledModel()],
      });

      await harness.manager.dismissCancelStuck();

      await expect(
        harness.manager.install(sampleSelection('whisper_small_en_q5_1')),
      ).resolves.toBeDefined();
      expect(harness.sidecarConnection.installModel).toHaveBeenCalledTimes(2);
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

    it('refuses to remove a model after install starts but before its first progress event', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      const installResult = deferred<ReturnType<typeof sampleInstallUpdate>>();
      harness.sidecarConnection.installModel.mockReturnValueOnce(installResult.promise);

      const installing = harness.manager.install(sampleSelection());
      await vi.waitFor(() => {
        expect(harness.sidecarConnection.installModel).toHaveBeenCalledOnce();
      });
      expect(harness.manager.getState().activeInstall).toBeNull();

      await expect(harness.manager.remove(sampleSelection())).rejects.toThrow(
        'This model is currently being installed and cannot be removed.',
      );
      expect(harness.sidecarConnection.removeModel).not.toHaveBeenCalled();

      installResult.resolve(sampleInstallUpdate({ state: 'queued' }));
      await installing;
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

    it('refuses to delete model files while Read aloud is synthesizing', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      const speech = harness.sidecarLifecycleGate.acquireSpeech();

      await expect(harness.manager.remove(sampleSelection())).rejects.toBeInstanceOf(
        SidecarLifecycleConflictError,
      );

      expect(harness.sidecarConnection.removeModel).not.toHaveBeenCalled();
      expect(
        harness.manager
          .getState()
          .installedModels.find((m) => m.modelId === 'whisper_large_v3_turbo_q8_0'),
      ).toBeDefined();

      speech.release();
      harness.sidecarConnection.removeModel.mockResolvedValueOnce({ removed: true });
      await harness.manager.remove(sampleSelection());

      expect(harness.sidecarConnection.removeModel).toHaveBeenCalledOnce();
    });

    it('releases the mutation lease when the sidecar removal rejects', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      harness.sidecarConnection.removeModel.mockRejectedValueOnce(new Error('file is locked'));

      await expect(harness.manager.remove(sampleSelection())).rejects.toThrow('file is locked');

      // A stuck mutation lease would block every later dictation session.
      expect(() => harness.sidecarLifecycleGate.acquireSpeech().release()).not.toThrow();
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

    it('rejects an incompatible model without changing the selected language', async () => {
      harness = createManagerHarness({ dictationLanguage: 'ja' });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(sampleReadyProbeResult());

      await expect(harness.manager.select(sampleSelection())).rejects.toThrow(
        'does not support 日本語',
      );

      expect(harness.getSettings().dictationLanguage).toBe('ja');
      expect(harness.getSettings().selectedModel).toBeNull();
    });

    it('preserves the language when the exact model advertises it', async () => {
      harness = createManagerHarness({ dictationLanguage: 'ja' });
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce({
        ...sampleReadyProbeResult(),
        mergedCapabilities: {
          ...sampleMergedCapabilities(),
          family: {
            ...sampleMergedCapabilities().family,
            supportedLanguages: { kind: 'list', tags: ['en', 'ja'] },
            supportsLanguageSelection: true,
          },
        },
      });

      await harness.manager.select(sampleSelection());

      expect(harness.getSettings().dictationLanguage).toBe('ja');
    });

    it('validates and selects Moonshine through the external-file path', async () => {
      const modelDirectory = await mkdtemp(join(tmpdir(), 'manager-external-model-test-'));
      const frontendPath = join(modelDirectory, 'frontend.ort');
      await writeFile(frontendPath, 'fixture', 'utf8');
      const selection = {
        familyId: 'moonshine' as const,
        filePath: frontendPath,
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

      try {
        await harness.manager.validateAndSelectExternalFile(selection.filePath, selection);
      } finally {
        await rm(modelDirectory, { force: true, recursive: true });
      }

      expect(harness.sidecarConnection.probeModelSelection).toHaveBeenCalledWith(
        expect.objectContaining({ modelSelection: selection }),
      );
      expect(harness.getSettings().selectedModel).toEqual(selection);
    });

    it('rejects an invalid external path before contacting the sidecar', async () => {
      await expect(
        harness.manager.validateAndSelectExternalFile('relative/model.bin'),
      ).rejects.toThrow('Model file path must be an absolute path.');

      expect(harness.sidecarConnection.probeModelSelection).not.toHaveBeenCalled();
      expect(harness.getSettings().selectedModel).toBeNull();
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

    it('keeps read-aloud selection and capabilities independent from dictation', async () => {
      configureSidecarForInit(harness.sidecarConnection);
      await harness.manager.init();
      const selection = {
        familyId: 'pocket_tts' as const,
        kind: 'catalog_model' as const,
        modelId: 'pocket_tts_english',
        runtimeId: 'onnx_runtime' as const,
      };
      harness.manager.getState().catalog.models.push({
        artifacts: [],
        collectionId: 'read_aloud',
        defaultVoice: 'alba',
        displayName: 'Pocket TTS English',
        familyId: 'pocket_tts',
        languageTags: ['en'],
        licenseLabel: 'CC-BY-4.0',
        licenseUrl: 'https://example.com/license',
        modelCardUrl: null,
        modelId: selection.modelId,
        notes: [],
        runtimeId: 'onnx_runtime',
        sourceUrl: 'https://example.com',
        summary: 'Read aloud',
        supportsAutomaticLanguageDetection: false,
        task: 'tts',
        uxTags: [],
      });
      const capabilities = {
        ...sampleMergedCapabilities(),
        family: {
          ...sampleMergedCapabilities().family,
          availableVoices: ['alba'],
          outputSampleRate: 24_000,
          supportsSpeedControl: true,
          task: 'tts' as const,
        },
        familyId: 'pocket_tts' as const,
        runtimeId: 'onnx_runtime' as const,
      };
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce({
        ...sampleReadyProbeResult(selection),
        mergedCapabilities: capabilities,
      });

      await harness.manager.select(selection);

      expect(harness.getSettings().selectedModel).toBeNull();
      expect(harness.getSettings().selectedTtsModel).toEqual(selection);
      expect(harness.getSettings().selectedTtsVoice).toBe('alba');
      expect(harness.manager.getState().selectedTtsModelCapabilities).toEqual({
        capabilities,
        selection,
        status: 'ready',
      });
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

    it('commits a newer explicit selection after an older persistence finishes', async () => {
      await harness.manager.init();
      harness.sidecarConnection.probeModelSelection.mockImplementation(async ({ modelSelection }) =>
        sampleReadyProbeResult(modelSelection as CatalogModelSelection),
      );
      const firstSelection = sampleSelection('whisper_small_en_q5_1');
      const newerSelection = sampleSelection();
      const commitBlock = harness.blockNextConditionalCommit();

      const selectingFirst = harness.manager.select(firstSelection);
      await commitBlock.started;
      const selectingNewer = harness.manager.select(newerSelection);

      commitBlock.release();
      await Promise.all([selectingFirst, selectingNewer]);

      expect(harness.getSettings().selectedModel).toEqual(newerSelection);
    });

    it('commits a newer clear after an older selection persistence finishes', async () => {
      await harness.manager.init();
      const selection = sampleSelection('whisper_small_en_q5_1');
      harness.sidecarConnection.probeModelSelection.mockResolvedValueOnce(
        sampleReadyProbeResult(selection),
      );
      const commitBlock = harness.blockNextConditionalCommit();

      const selecting = harness.manager.select(selection);
      await commitBlock.started;
      const clearing = harness.manager.clearSelection();

      commitBlock.release();
      await Promise.all([selecting, clearing]);

      expect(harness.getSettings().selectedModel).toBeNull();
      expect(harness.manager.getState().selectedModelCapabilities).toEqual({ status: 'none' });
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
      expect(harness.manager.getState().selectedModelCapabilities).toMatchObject({
        capabilities: { familyId: 'whisper', runtimeId: 'whisper_cpp' },
        selection: sampleSelection(),
        status: 'ready',
      });
    });

    it('refreshes cached capability metadata from the running sidecar without loading the model', async () => {
      harness = createManagerHarness({
        selectedModel: sampleSelection(),
        selectedModelCapabilitiesSnapshot: {
          capabilities: sampleMergedCapabilities(),
          selection: sampleSelection(),
        },
      });
      configureSidecarForInit(harness.sidecarConnection);
      const systemInfo = sampleSystemInfo();
      const whisper = systemInfo.compiledAdapters.find((adapter) => adapter.familyId === 'whisper');
      if (whisper === undefined) throw new Error('Whisper fixture missing');
      whisper.familyCapabilities.supportsWordTimestamps = true;
      whisper.familyCapabilities.supportedLanguages = { kind: 'list', tags: ['en', 'ja'] };
      whisper.familyCapabilities.supportsLanguageSelection = true;
      harness.sidecarConnection.getSystemInfo.mockResolvedValue(systemInfo);

      await harness.manager.init();

      expect(harness.sidecarConnection.probeModelSelection).not.toHaveBeenCalled();
      const capabilityState = harness.manager.getState().selectedModelCapabilities;
      expect(capabilityState.status).toBe('ready');
      if (capabilityState.status !== 'ready') throw new Error('Expected ready capabilities');
      expect(capabilityState.capabilities.family.supportsWordTimestamps).toBe(true);
      expect(capabilityState.capabilities.family.supportedLanguages).toEqual({
        kind: 'english_only',
      });
      expect(capabilityState.capabilities.family.supportsLanguageSelection).toBe(false);
      expect(capabilityState.capabilities.family.supportsAutomaticLanguageDetection).toBe(false);
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

    it('re-selecting a now-unavailable model clears stale ready capabilities and notifies', async () => {
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
      expect(harness.manager.getState().selectedModelCapabilities.status).toBe('ready');
      const onStateChange = vi.fn();
      harness.manager.subscribe(onStateChange);

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
      expect(harness.manager.getState().selectedModelCapabilities).toEqual({
        details: 'Model is not installed. (file removed)',
        reason: 'missing',
        selection: sampleSelection(),
        status: 'unavailable',
      });
      expect(harness.getSettings().selectedModelCapabilitiesSnapshot).toBeNull();
      expect(onStateChange).toHaveBeenCalledOnce();
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
  blockNextConditionalCommit(): {
    release(): void;
    started: Promise<void>;
  };
  emit(event: SidecarEvent): void;
  getSettings(): PluginSettings;
  logger: {
    debug: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  manager: ModelInstallManager;
  sidecarConnection: ReturnType<typeof createSidecarConnectionStub>;
  sidecarLifecycleGate: SidecarLifecycleGate;
}

function createManagerHarness(settingsOverride?: Partial<PluginSettings>): ManagerHarness {
  const listeners = new Set<(event: SidecarEvent) => void>();
  const sidecarConnection = createSidecarConnectionStub(listeners);
  const sidecarLifecycleGate = new SidecarLifecycleGate();
  let settings: PluginSettings = { ...DEFAULT_PLUGIN_SETTINGS, ...settingsOverride };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
  let settingsOperationTail: Promise<void> = Promise.resolve();
  let nextConditionalCommitBlock: {
    release: Deferred<void>;
    started: Deferred<void>;
  } | null = null;
  const enqueueSettingsOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = settingsOperationTail.then(operation, operation);
    settingsOperationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const manager = new ModelInstallManager({
    commitSettingsIf: (condition, createNextSettings) =>
      enqueueSettingsOperation(async () => {
        if (!condition(settings)) return false;
        settings = createNextSettings(settings);
        const block = nextConditionalCommitBlock;
        nextConditionalCommitBlock = null;
        if (block !== null) {
          block.started.resolve(undefined);
          await block.release.promise;
        }
        return true;
      }),
    getSettings: () => settings,
    logger,
    saveSettings: (next) =>
      enqueueSettingsOperation(async () => {
        settings = next;
      }),
    sidecarConnection,
    sidecarLifecycleGate,
  });

  return {
    blockNextConditionalCommit: () => {
      const release = deferred<void>();
      const started = deferred<void>();
      nextConditionalCommitBlock = { release, started };
      return {
        release: () => release.resolve(undefined),
        started: started.promise,
      };
    },
    emit: (event) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
    getSettings: () => settings,
    logger,
    manager,
    sidecarConnection,
    sidecarLifecycleGate,
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

// ---------------------------------------------------------------------------
// Fixtures (test-local; shared model/install fixtures live in fixtures/models.ts)
// ---------------------------------------------------------------------------

function sampleTtsVoiceSelection(): CatalogModelSelection {
  return {
    familyId: 'pocket_tts',
    kind: 'catalog_model',
    modelId: 'pocket_tts_english',
    runtimeId: 'onnx_runtime',
  };
}

function sampleTtsVoiceCatalogModel(): CatalogModelRecord {
  return {
    artifacts: [
      {
        artifactId: 'synthesis',
        downloadUrl: 'https://example.com/pocket-tts.onnx',
        filename: 'pocket-tts.onnx',
        required: true,
        role: 'synthesis_model',
        sha256: '1'.repeat(64),
        sizeBytes: 100,
      },
      {
        artifactId: 'voice-alba',
        downloadUrl: 'https://example.com/alba.onnx',
        filename: 'alba.onnx',
        required: false,
        role: 'voice',
        sha256: '2'.repeat(64),
        sizeBytes: 10,
        voiceId: 'alba',
      },
    ],
    collectionId: 'read_aloud',
    defaultVoice: 'alba',
    displayName: 'Pocket TTS English',
    familyId: 'pocket_tts',
    languageTags: ['en'],
    licenseLabel: 'MIT',
    licenseUrl: 'https://example.com/license',
    modelCardUrl: null,
    modelId: 'pocket_tts_english',
    notes: [],
    runtimeId: 'onnx_runtime',
    sourceUrl: 'https://example.com/source',
    summary: 'Local TTS',
    supportsAutomaticLanguageDetection: false,
    task: 'tts',
    uxTags: [],
  };
}

function sampleSystemInfo(): SystemInfoEvent {
  return {
    compiledAdapters: [
      {
        displayName: 'Cohere Transcribe',
        familyCapabilities: {
          availableVoices: [],
          maxAudioDurationSecs: null,
          outputSampleRate: null,
          producesPunctuation: true,
          supportsHardwareAcceleration: true,
          supportedLanguages: { kind: 'all' as const },
          supportsInitialPrompt: false,
          supportsSpeedControl: false,
          supportsStreaming: false,
          supportsLanguageSelection: true,
          supportsAutomaticLanguageDetection: false,
          supportsSegmentTimestamps: true,
          supportsWordTimestamps: false,
          task: 'stt',
        },
        familyId: 'cohere_transcribe' as const,
        runtimeId: 'onnx_runtime' as const,
      },
      {
        displayName: 'Moonshine',
        familyCapabilities: {
          availableVoices: [],
          maxAudioDurationSecs: null,
          outputSampleRate: null,
          producesPunctuation: true,
          supportsHardwareAcceleration: false,
          supportedLanguages: { kind: 'english_only' as const },
          supportsInitialPrompt: false,
          supportsSpeedControl: false,
          supportsStreaming: true,
          supportsLanguageSelection: false,
          supportsAutomaticLanguageDetection: false,
          supportsSegmentTimestamps: false,
          supportsWordTimestamps: false,
          task: 'stt',
        },
        familyId: 'moonshine' as const,
        runtimeId: 'onnx_runtime' as const,
      },
      {
        displayName: 'Whisper',
        familyCapabilities: {
          availableVoices: [],
          maxAudioDurationSecs: null,
          outputSampleRate: null,
          producesPunctuation: true,
          supportsHardwareAcceleration: true,
          supportedLanguages: { kind: 'all' as const },
          supportsInitialPrompt: true,
          supportsSpeedControl: false,
          supportsStreaming: false,
          supportsLanguageSelection: true,
          supportsAutomaticLanguageDetection: true,
          supportsSegmentTimestamps: true,
          supportsWordTimestamps: false,
          task: 'stt',
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
      availableVoices: [],
      maxAudioDurationSecs: null,
      outputSampleRate: null,
      producesPunctuation: true,
      supportsHardwareAcceleration: true,
      supportedLanguages: { kind: 'english_only' },
      supportsInitialPrompt: true,
      supportsSpeedControl: false,
      supportsStreaming: false,
      supportsLanguageSelection: false,
      supportsAutomaticLanguageDetection: false,
      supportsSegmentTimestamps: true,
      supportsWordTimestamps: false,
      task: 'stt',
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
    displayName: isMoonshine ? 'Moonshine Small' : 'Whisper Large V3 Turbo',
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
