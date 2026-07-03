import type {
  CatalogModelSelection,
  InstalledModelRecord,
  ModelInstallUpdateRecord,
  ModelStoreRecord,
} from '../../src/models/model-management-types';

export const DEFAULT_MODEL_ID = 'whisper_large_v3_turbo_q8_0';
export const ALTERNATE_MODEL_ID = 'whisper_small_en_q5_1';
export const MOONSHINE_MODEL_ID = 'moonshine_small_streaming_en';

export function sampleInstalledModel(
  modelId: string = DEFAULT_MODEL_ID,
  overrides: Partial<InstalledModelRecord> = {},
): InstalledModelRecord {
  return {
    catalogVersion: 1,
    familyId: 'whisper',
    installPath: `/models/whisper_cpp/${modelId}`,
    installedAtUnixMs: 1_700_000_000_000,
    modelId,
    runtimeId: 'whisper_cpp',
    runtimePath: `/models/whisper_cpp/${modelId}/model.bin`,
    totalSizeBytes: modelId === DEFAULT_MODEL_ID ? 900 : 100,
    ...overrides,
  };
}

export function sampleInstallUpdate(
  overrides: Partial<ModelInstallUpdateRecord> = {},
): ModelInstallUpdateRecord {
  return {
    details: null,
    downloadedBytes: 50,
    familyId: 'whisper',
    installId: 'install-1',
    message: 'Downloading',
    modelId: DEFAULT_MODEL_ID,
    runtimeId: 'whisper_cpp',
    state: 'downloading',
    totalBytes: 900,
    ...overrides,
  };
}

export function sampleSelection(modelId: string = DEFAULT_MODEL_ID): CatalogModelSelection {
  return {
    familyId: 'whisper',
    kind: 'catalog_model',
    modelId,
    runtimeId: 'whisper_cpp',
  };
}

export function sampleMoonshineSelection(): CatalogModelSelection {
  return {
    familyId: 'moonshine',
    kind: 'catalog_model',
    modelId: MOONSHINE_MODEL_ID,
    runtimeId: 'onnx_runtime',
  };
}

export function sampleMoonshineInstalledModel(): InstalledModelRecord {
  return {
    catalogVersion: 1,
    familyId: 'moonshine',
    installPath: `/models/onnx_runtime/${MOONSHINE_MODEL_ID}`,
    installedAtUnixMs: 1_700_000_000_000,
    modelId: MOONSHINE_MODEL_ID,
    runtimeId: 'onnx_runtime',
    runtimePath: `/models/onnx_runtime/${MOONSHINE_MODEL_ID}/frontend.ort`,
    totalSizeBytes: 700,
  };
}

export function sampleMoonshineInstallUpdate(
  overrides: Partial<ModelInstallUpdateRecord> = {},
): ModelInstallUpdateRecord {
  return sampleInstallUpdate({
    familyId: 'moonshine',
    modelId: MOONSHINE_MODEL_ID,
    runtimeId: 'onnx_runtime',
    totalBytes: 700,
    ...overrides,
  });
}

export function managedModelCases(): Array<{
  installedModel: InstalledModelRecord;
  installUpdate: ModelInstallUpdateRecord;
  label: string;
  selection: CatalogModelSelection;
}> {
  return [
    {
      installedModel: sampleInstalledModel(ALTERNATE_MODEL_ID),
      installUpdate: sampleInstallUpdate({
        modelId: ALTERNATE_MODEL_ID,
        totalBytes: 100,
      }),
      label: 'Whisper',
      selection: sampleSelection(ALTERNATE_MODEL_ID),
    },
    {
      installedModel: sampleMoonshineInstalledModel(),
      installUpdate: sampleMoonshineInstallUpdate(),
      label: 'Moonshine',
      selection: sampleMoonshineSelection(),
    },
  ];
}

export function sampleModelStore(): ModelStoreRecord {
  return {
    overridePath: null,
    path: '/models',
    usingDefaultPath: true,
  };
}
