import { describe, expect, it } from 'vitest';

import type { ModelManagerState } from '../src/models/model-install-manager';
import type {
  CatalogModelRecord,
  InstalledModelRecord,
} from '../src/models/model-management-types';
import { deriveRibbonModelMenuEntries } from '../src/models/ribbon-model-menu';

function model(
  modelId: string,
  task: CatalogModelRecord['task'],
  languageTags: string[],
  supportsAutomaticLanguageDetection = false,
): CatalogModelRecord {
  return {
    artifacts: [],
    collectionId: 'test',
    displayName: modelId,
    familyId: task === 'stt' ? 'whisper' : 'pocket_tts',
    languageTags,
    supportsAutomaticLanguageDetection,
    licenseLabel: 'MIT',
    licenseUrl: 'https://example.com/license',
    modelCardUrl: null,
    modelId,
    notes: [],
    runtimeId: task === 'stt' ? 'whisper_cpp' : 'onnx_runtime',
    sourceUrl: 'https://example.com/source',
    summary: '',
    task,
    uxTags: [],
  };
}

function installed(entry: CatalogModelRecord): InstalledModelRecord {
  return {
    catalogVersion: 1,
    familyId: entry.familyId,
    installPath: `/models/${entry.modelId}`,
    installedAtUnixMs: 1,
    installedVoiceIds: [],
    modelId: entry.modelId,
    runtimeId: entry.runtimeId,
    runtimePath: null,
    totalSizeBytes: 100,
  };
}

function compiled(entry: CatalogModelRecord): ModelManagerState['compiledAdapters'][number] {
  return {
    displayName: entry.displayName,
    familyCapabilities: {
      availableVoices: [],
      maxAudioDurationSecs: null,
      outputSampleRate: null,
      producesPunctuation: true,
      supportedLanguages: { kind: 'all' },
      supportsAutomaticLanguageDetection: false,
      supportsHardwareAcceleration: false,
      supportsInitialPrompt: false,
      supportsLanguageSelection: true,
      supportsSegmentTimestamps: false,
      supportsSpeedControl: false,
      supportsStreaming: true,
      supportsWordTimestamps: false,
      task: 'stt',
    },
    familyId: entry.familyId,
    runtimeId: entry.runtimeId,
  };
}

describe('deriveRibbonModelMenuEntries', () => {
  it('lists only runnable downloaded transcription models in catalog order', () => {
    const english = model('English', 'stt', ['en']);
    const multilingual = model('Multilingual', 'stt', ['en', 'zh'], true);
    const uninstalled = model('Not downloaded', 'stt', ['zh']);
    const unavailable = {
      ...model('Unavailable adapter', 'stt', ['zh']),
      familyId: 'funasr_hybrid' as const,
      runtimeId: 'funasr_llamacpp' as const,
    };
    const tts = model('TTS', 'tts', ['en']);
    const state = {
      catalog: {
        catalogVersion: 1,
        collections: [],
        families: [],
        models: [english, multilingual, uninstalled, unavailable, tts],
      },
      compiledAdapters: [compiled(english)],
      installedModels: [
        installed(english),
        installed(multilingual),
        installed(unavailable),
        installed(tts),
      ],
      selectedModel: {
        familyId: multilingual.familyId,
        kind: 'catalog_model' as const,
        modelId: multilingual.modelId,
        runtimeId: multilingual.runtimeId,
      },
    } satisfies Pick<
      ModelManagerState,
      'catalog' | 'compiledAdapters' | 'installedModels' | 'selectedModel'
    >;

    expect(deriveRibbonModelMenuEntries(state, 'zh')).toEqual([
      { isSelected: false, model: english, supportsCurrentLanguage: false },
      { isSelected: true, model: multilingual, supportsCurrentLanguage: true },
    ]);
  });

  it('uses each model exact automatic-language support claim', () => {
    const manualOnly = model('Manual only', 'stt', ['en', 'zh']);
    const automatic = model('Automatic', 'stt', ['en', 'zh'], true);
    const state = {
      catalog: {
        catalogVersion: 1,
        collections: [],
        families: [],
        models: [manualOnly, automatic],
      },
      compiledAdapters: [compiled(manualOnly)],
      installedModels: [installed(manualOnly), installed(automatic)],
      selectedModel: null,
    } satisfies Pick<
      ModelManagerState,
      'catalog' | 'compiledAdapters' | 'installedModels' | 'selectedModel'
    >;

    expect(
      deriveRibbonModelMenuEntries(state, 'auto').map((entry) => entry.supportsCurrentLanguage),
    ).toEqual([false, true]);
  });
});
