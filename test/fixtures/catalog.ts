import type {
  CatalogModelRecord,
  ModelCatalogRecord,
} from '../../src/models/model-management-types';

export function sampleCatalogModel(input: {
  displayName: string;
  modelId: string;
  sizeBytes: number;
}): CatalogModelRecord {
  return {
    artifacts: [
      {
        artifactId: 'transcription',
        downloadUrl: `https://example.com/${input.modelId}.bin`,
        filename: `${input.modelId}.bin`,
        required: true,
        role: 'transcription_model',
        sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        sizeBytes: input.sizeBytes,
      },
    ],
    collectionId: 'english_cpu_first',
    displayName: input.displayName,
    familyId: 'whisper',
    languageTags: ['en'],
    supportsAutomaticLanguageDetection: false,
    licenseLabel: 'MIT',
    licenseUrl: 'https://example.com/license',
    modelCardUrl: null,
    modelId: input.modelId,
    notes: [],
    runtimeId: 'whisper_cpp',
    sourceUrl: 'https://example.com/source',
    summary: 'Test model',
    task: 'stt',
    uxTags: [],
  };
}

export function sampleMoonshineCatalogModel(): CatalogModelRecord {
  const artifacts = [
    ['frontend', 'frontend.ort', 'transcription_model'],
    ['encoder', 'encoder.ort', 'supporting_file'],
    ['adapter', 'adapter.ort', 'supporting_file'],
    ['cross_kv', 'cross_kv.ort', 'supporting_file'],
    ['decoder_kv', 'decoder_kv.ort', 'supporting_file'],
    ['streaming_config', 'streaming_config.json', 'supporting_file'],
    ['tokenizer', 'tokenizer.bin', 'supporting_file'],
  ] as const;

  return {
    artifacts: artifacts.map(([artifactId, filename, role]) => ({
      artifactId,
      downloadUrl: `https://download.example.com/moonshine/${filename}`,
      filename,
      required: true,
      role,
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      sizeBytes: 100,
    })),
    collectionId: 'moonshine_streaming',
    displayName: 'Moonshine Small',
    familyId: 'moonshine',
    languageTags: ['en'],
    supportsAutomaticLanguageDetection: false,
    licenseLabel: 'MIT',
    licenseUrl: 'https://example.com/moonshine/license',
    modelCardUrl: 'https://example.com/moonshine/model-card',
    modelId: 'moonshine_small_streaming_en',
    notes: ['English-only streaming model using quantized (int8) precision.'],
    runtimeId: 'onnx_runtime',
    sourceUrl: 'https://example.com/moonshine',
    summary: 'Test Moonshine streaming model',
    task: 'stt',
    uxTags: ['balanced'],
  };
}

export function sampleCatalog(): ModelCatalogRecord {
  return {
    catalogVersion: 1,
    collections: [
      {
        collectionId: 'english_cpu_first',
        displayName: 'English CPU First',
        summary: 'summary',
      },
      {
        collectionId: 'moonshine_streaming',
        displayName: 'Moonshine Streaming',
        summary: 'summary',
      },
    ],
    families: [
      {
        displayName: 'Whisper',
        familyId: 'whisper',
        runtimeId: 'whisper_cpp',
        summary: 'summary',
        task: 'stt',
      },
      {
        displayName: 'Cohere Transcribe',
        familyId: 'cohere_transcribe',
        runtimeId: 'onnx_runtime',
        summary: 'summary',
        task: 'stt',
      },
      {
        displayName: 'Moonshine',
        familyId: 'moonshine',
        runtimeId: 'onnx_runtime',
        summary: 'summary',
        task: 'stt',
      },
    ],
    models: [
      sampleCatalogModel({
        displayName: 'Whisper Large V3 Turbo',
        modelId: 'whisper_large_v3_turbo_q8_0',
        sizeBytes: 900,
      }),
      sampleCatalogModel({
        displayName: 'Whisper Small',
        modelId: 'whisper_small_en_q5_1',
        sizeBytes: 100,
      }),
      sampleMoonshineCatalogModel(),
    ],
  };
}
