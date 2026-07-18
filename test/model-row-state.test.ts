import { describe, expect, it } from 'vitest';
import type { ActiveInstallInfo, ModelManagerState } from '../src/models/model-install-manager';
import { getTotalModelSize, type SelectedModel } from '../src/models/model-management-types';
import {
  deriveCurrentModelDisplay,
  deriveModelFamilyTabs,
  deriveModelRowStates,
  type ModelRowState,
} from '../src/models/model-row-state';
import { sampleCatalog } from './fixtures/catalog';
import {
  MOONSHINE_MODEL_ID,
  sampleInstalledModel,
  sampleInstallUpdate,
  sampleMoonshineInstalledModel,
  sampleMoonshineSelection,
} from './fixtures/models';

// ---------------------------------------------------------------------------
// Fixtures (test-local; shared model/install fixtures live in fixtures/models.ts)
// ---------------------------------------------------------------------------

function sampleActiveInstall(phase: ActiveInstallInfo['phase'] = 'installing'): ActiveInstallInfo {
  return {
    installUpdate: sampleInstallUpdate(),
    lastError: null,
    phase,
  };
}

function buildState(overrides?: Partial<ModelManagerState>): ModelManagerState {
  return {
    activeInstall: null,
    catalog: sampleCatalog(),
    compiledAdapters: [],
    compiledRuntimes: [],
    installedModels: [],
    loadError: null,
    loadStatus: 'ready',
    modelStore: { overridePath: null, path: '/models', usingDefaultPath: true },
    selectedModel: null,
    selectedModelCapabilities: { status: 'none' },
    ...overrides,
  };
}

function selectionFor(modelId: string): SelectedModel {
  return {
    familyId: 'whisper',
    kind: 'catalog_model',
    modelId,
    runtimeId: 'whisper_cpp',
  };
}

function getRow(rows: ModelRowState[], modelId: string): ModelRowState {
  const row = rows.find((r) => r.model.modelId === modelId);

  if (row === undefined) {
    throw new Error(`Row not found for modelId: ${modelId}`);
  }

  return row;
}

function compiledAdapter(
  familyId: ModelManagerState['compiledAdapters'][number]['familyId'],
  runtimeId: ModelManagerState['compiledAdapters'][number]['runtimeId'],
): ModelManagerState['compiledAdapters'][number] {
  return {
    displayName: familyId,
    familyCapabilities: {
      maxAudioDurationSecs: null,
      producesPunctuation: true,
      supportedLanguages: { kind: 'english_only' },
      supportsInitialPrompt: false,
      supportsLanguageSelection: false,
      supportsAutomaticLanguageDetection: false,
      supportsSegmentTimestamps: false,
      supportsStreaming: familyId === 'moonshine',
      supportsWordTimestamps: false,
    },
    familyId,
    runtimeId,
  };
}

describe('deriveModelFamilyTabs', () => {
  it('uses catalog family order even when compiled adapters arrive in native wire order', () => {
    const state = buildState({
      compiledAdapters: [
        compiledAdapter('cohere_transcribe', 'onnx_runtime'),
        compiledAdapter('moonshine', 'onnx_runtime'),
        compiledAdapter('whisper', 'whisper_cpp'),
      ],
    });

    expect(deriveModelFamilyTabs(state).map((tab) => tab.familyId)).toEqual([
      'whisper',
      'cohere_transcribe',
      'moonshine',
    ]);
  });
});

// ---------------------------------------------------------------------------
// deriveModelRowStates
// ---------------------------------------------------------------------------

describe('deriveModelRowStates', () => {
  it('sorts rows ascending by total artifact size', () => {
    const rows = deriveModelRowStates(buildState());

    expect(rows.map((r) => r.model.modelId)).toEqual([
      'whisper_small_en_q5_1',
      MOONSHINE_MODEL_ID,
      'whisper_large_v3_turbo_q8_0',
    ]);
  });

  it('derives installed and selected state for a multi-artifact Moonshine catalog model', () => {
    const row = getRow(
      deriveModelRowStates(
        buildState({
          installedModels: [sampleMoonshineInstalledModel()],
          selectedModel: sampleMoonshineSelection(),
        }),
      ),
      MOONSHINE_MODEL_ID,
    );

    expect(row).toMatchObject({ installed: true, isSelected: true });
    expect(row.allowedActions).toEqual(['selected', 'details']);
    expect(row.model).toMatchObject({
      familyId: 'moonshine',
      licenseLabel: 'MIT',
      runtimeId: 'onnx_runtime',
    });
    expect(row.model.artifacts).toHaveLength(7);
    expect(getTotalModelSize(row.model)).toBe(700);
    expect(
      row.model.artifacts.filter((artifact) => artifact.role === 'transcription_model'),
    ).toEqual([expect.objectContaining({ filename: 'frontend.ort', required: true })]);
  });

  describe('per-row allowed actions', () => {
    it('idle, not installed → [install, details]', () => {
      const row = getRow(deriveModelRowStates(buildState()), 'whisper_large_v3_turbo_q8_0');

      expect(row).toMatchObject({ installed: false, isInstalling: false, isCanceling: false });
      expect(row.allowedActions).toEqual(['install', 'details']);
    });

    it('different model installing, this one not installed → [details] (install blocked)', () => {
      const rows = deriveModelRowStates(buildState({ activeInstall: sampleActiveInstall() }));
      const smallRow = getRow(rows, 'whisper_small_en_q5_1');

      expect(smallRow).toMatchObject({ installed: false, isInstalling: false });
      expect(smallRow.allowedActions).toEqual(['details']);
    });

    it('this row currently installing → [cancel, details]', () => {
      const rows = deriveModelRowStates(
        buildState({ activeInstall: sampleActiveInstall('installing') }),
      );
      const row = getRow(rows, 'whisper_large_v3_turbo_q8_0');

      expect(row).toMatchObject({ isInstalling: true, isCanceling: false });
      expect(row.allowedActions).toEqual(['cancel', 'details']);
    });

    it.each([
      'canceling',
      'cancelStuck',
    ] as const)('this row in phase %s → [details] only', (phase) => {
      const rows = deriveModelRowStates(buildState({ activeInstall: sampleActiveInstall(phase) }));
      const row = getRow(rows, 'whisper_large_v3_turbo_q8_0');

      expect(row).toMatchObject({ isInstalling: false, isCanceling: true });
      expect(row.allowedActions).toEqual(['details']);
    });

    it('installed, not selected → [use, remove, details]', () => {
      const rows = deriveModelRowStates(buildState({ installedModels: [sampleInstalledModel()] }));
      const row = getRow(rows, 'whisper_large_v3_turbo_q8_0');

      expect(row).toMatchObject({ installed: true, isSelected: false });
      expect(row.allowedActions).toEqual(['use', 'remove', 'details']);
    });

    it('installed and selected → [selected, details] (selected is disabled)', () => {
      const rows = deriveModelRowStates(
        buildState({
          installedModels: [sampleInstalledModel()],
          selectedModel: selectionFor('whisper_large_v3_turbo_q8_0'),
        }),
      );
      const row = getRow(rows, 'whisper_large_v3_turbo_q8_0');

      expect(row).toMatchObject({ installed: true, isSelected: true });
      expect(row.allowedActions).toEqual(['selected', 'details']);
    });
  });

  describe('cross-row effects of an active install', () => {
    it('other installed rows keep [use, remove] available', () => {
      const rows = deriveModelRowStates(
        buildState({
          activeInstall: sampleActiveInstall('installing'),
          installedModels: [sampleInstalledModel('whisper_small_en_q5_1')],
        }),
      );
      const smallRow = getRow(rows, 'whisper_small_en_q5_1');

      expect(smallRow.allowedActions).toEqual(expect.arrayContaining(['use', 'remove']));
    });

    it('the currently selected row keeps [selected] available even mid-install', () => {
      const rows = deriveModelRowStates(
        buildState({
          activeInstall: sampleActiveInstall('installing'),
          installedModels: [sampleInstalledModel('whisper_small_en_q5_1')],
          selectedModel: selectionFor('whisper_small_en_q5_1'),
        }),
      );
      const smallRow = getRow(rows, 'whisper_small_en_q5_1');

      expect(smallRow).toMatchObject({ isSelected: true });
      expect(smallRow.allowedActions).toContain('selected');
    });

    it('cancel is only available on the actively installing row', () => {
      const rows = deriveModelRowStates(
        buildState({
          activeInstall: sampleActiveInstall('installing'),
          installedModels: [sampleInstalledModel('whisper_small_en_q5_1')],
        }),
      );

      expect(getRow(rows, 'whisper_large_v3_turbo_q8_0').allowedActions).toContain('cancel');
      expect(getRow(rows, 'whisper_small_en_q5_1').allowedActions).not.toContain('cancel');
    });

    it('install is blocked on all rows when any install is active', () => {
      const rows = deriveModelRowStates(
        buildState({ activeInstall: sampleActiveInstall('installing') }),
      );

      for (const row of rows) {
        expect(row.allowedActions).not.toContain('install');
      }
    });

    it('remove is blocked on the actively installing row', () => {
      const rows = deriveModelRowStates(
        buildState({
          activeInstall: sampleActiveInstall('installing'),
          installedModels: [sampleInstalledModel('whisper_large_v3_turbo_q8_0')],
        }),
      );
      const row = getRow(rows, 'whisper_large_v3_turbo_q8_0');

      expect(row.allowedActions).not.toContain('remove');
      expect(row.allowedActions).toContain('cancel');
    });
  });
});

// ---------------------------------------------------------------------------
// deriveCurrentModelDisplay
// ---------------------------------------------------------------------------

describe('deriveCurrentModelDisplay', () => {
  it('returns the empty-state display when no model is selected', () => {
    const display = deriveCurrentModelDisplay(buildState());

    expect(display).toMatchObject({
      detail: 'Choose an installed model or validate an external file.',
      displayName: 'No model selected',
      engineLabel: '',
      installLocation: null,
      status: 'not_selected',
      resolvedPath: null,
      sizeBytes: null,
      sourceLabel: '',
    });
  });

  it('hydrates from installed records when the selected catalog model is installed', () => {
    const installed = sampleInstalledModel('whisper_large_v3_turbo_q8_0');
    const display = deriveCurrentModelDisplay(
      buildState({
        selectedModel: selectionFor('whisper_large_v3_turbo_q8_0'),
        installedModels: [installed],
      }),
    );

    expect(display).toMatchObject({
      detail: '',
      displayName: 'Whisper Large V3 Turbo',
      engineLabel: 'Whisper',
      installLocation: '/models/whisper_cpp/whisper_large_v3_turbo_q8_0',
      status: 'installed',
      resolvedPath: '/models/whisper_cpp/whisper_large_v3_turbo_q8_0/model.bin',
      sizeBytes: 900,
      sourceLabel: 'Managed download',
    });
  });

  it('falls back to catalog size and clears install paths when a catalog model is not installed', () => {
    const display = deriveCurrentModelDisplay(
      buildState({
        selectedModel: selectionFor('whisper_small_en_q5_1'),
      }),
    );

    expect(display).toMatchObject({
      displayName: 'Whisper Small',
      installLocation: null,
      status: 'not_installed',
      resolvedPath: null,
      sizeBytes: 100,
    });
  });

  it('hydrates a managed Moonshine selection from its catalog and installed records', () => {
    const display = deriveCurrentModelDisplay(
      buildState({
        installedModels: [sampleMoonshineInstalledModel()],
        selectedModel: sampleMoonshineSelection(),
      }),
    );

    expect(display).toMatchObject({
      displayName: 'Moonshine Small',
      engineLabel: 'Moonshine',
      status: 'installed',
      resolvedPath: `/models/onnx_runtime/${MOONSHINE_MODEL_ID}/frontend.ort`,
      sizeBytes: 700,
      sourceLabel: 'Managed download',
    });
  });

  it('falls back to modelId for displayName when the catalog entry is missing', () => {
    const display = deriveCurrentModelDisplay(
      buildState({ selectedModel: selectionFor('unknown_model_xyz') }),
    );

    expect(display).toMatchObject({
      displayName: 'unknown_model_xyz',
      sizeBytes: null,
    });
  });

  it('treats an external_file selection as its own source with the file basename', () => {
    const display = deriveCurrentModelDisplay(
      buildState({
        selectedModel: {
          familyId: 'whisper',
          filePath: '/tmp/models/custom-model.bin',
          kind: 'external_file',
          runtimeId: 'whisper_cpp',
        },
      }),
    );

    expect(display).toMatchObject({
      displayName: 'custom-model.bin',
      engineLabel: 'Whisper',
      installLocation: null,
      status: 'external_file',
      resolvedPath: '/tmp/models/custom-model.bin',
      sizeBytes: null,
      sourceLabel: 'External file',
    });
  });

  it('labels an external Moonshine selection without a catalog family entry', () => {
    const state = buildState({
      selectedModel: {
        familyId: 'moonshine',
        filePath: '/models/moonshine/frontend.ort',
        kind: 'external_file',
        runtimeId: 'onnx_runtime',
      },
    });

    expect(deriveCurrentModelDisplay(state)).toMatchObject({
      displayName: 'frontend.ort',
      engineLabel: 'Moonshine',
      sourceLabel: 'External file',
    });
  });

  it('reports a successfully probed external model as ready', () => {
    const selection = {
      familyId: 'whisper' as const,
      filePath: '/tmp/models/custom-model.bin',
      kind: 'external_file' as const,
      runtimeId: 'whisper_cpp' as const,
    };
    const state = buildState({
      selectedModel: selection,
      selectedModelCapabilities: {
        capabilities: {
          family: compiledAdapter('whisper', 'whisper_cpp').familyCapabilities,
          familyId: 'whisper',
          runtime: {
            acceleratorDetails: {},
            availableAccelerators: ['cpu'],
            supportedModelFormats: ['ggml', 'gguf'],
          },
          runtimeId: 'whisper_cpp',
        },
        selection,
        status: 'ready',
      },
    });

    expect(deriveCurrentModelDisplay(state)).toMatchObject({
      detail: '',
      status: 'external_validated',
    });
  });

  it('surfaces the external probe failure details in the current-model status', () => {
    const selection = {
      familyId: 'moonshine' as const,
      filePath: '/models/moonshine/frontend.ort',
      kind: 'external_file' as const,
      runtimeId: 'onnx_runtime' as const,
    };
    const state = buildState({
      selectedModel: selection,
      selectedModelCapabilities: {
        details: 'required Moonshine asset missing: encoder.ort',
        reason: 'invalid',
        selection,
        status: 'unavailable',
      },
    });

    expect(deriveCurrentModelDisplay(state)).toMatchObject({
      detail: 'required Moonshine asset missing: encoder.ort',
      status: 'unavailable',
    });
  });
});
