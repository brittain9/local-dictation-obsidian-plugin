import { describe, expect, it } from 'vitest';

import {
  ALL_MODEL_LANGUAGES,
  deriveModelLanguageOptions,
  derivePickerFamilyTabs,
  filterModelRowsForPicker,
  modelMatchesLanguageFilter,
  resolveInitialModelPickerTask,
  resolveTabNavigationIndex,
  searchQueryAfterTaskSwitch,
} from '../src/models/manage-models-modal';
import type {
  CatalogModelRecord,
  ModelFamilyId,
  ModelTask,
} from '../src/models/model-management-types';
import { resolveModelPresentationPolicy } from '../src/models/model-presentation-policy';
import type { ModelRowState } from '../src/models/model-row-state';

function ttsModel(
  modelId: string,
  language: string,
  uxTags: string[] = [],
  sizeBytes = 100,
): CatalogModelRecord {
  return {
    artifacts: [
      {
        artifactId: 'synthesis',
        downloadUrl: 'https://example.com/model.onnx',
        filename: 'model.onnx',
        required: true,
        role: 'synthesis_model',
        sha256: '0'.repeat(64),
        sizeBytes,
      },
    ],
    collectionId: 'pocket_tts_read_aloud',
    defaultVoice: 'alba',
    displayName: `Pocket TTS ${language}`,
    familyId: 'pocket_tts',
    languageTags: [language],
    supportsAutomaticLanguageDetection: false,
    licenseLabel: 'CC-BY-4.0',
    licenseUrl: 'https://example.com/license',
    modelCardUrl: 'https://example.com/model-card',
    modelId,
    notes: [],
    runtimeId: 'onnx_runtime',
    sourceUrl: 'https://example.com/source',
    summary: `Local ${language} synthesis`,
    task: 'tts',
    uxTags,
  };
}

function sttModel(
  modelId: string,
  familyId: ModelFamilyId,
  languageTags: string[],
): CatalogModelRecord {
  return {
    artifacts: [],
    collectionId: familyId,
    displayName: modelId,
    familyId,
    languageTags,
    supportsAutomaticLanguageDetection: languageTags.length > 1,
    licenseLabel: 'MIT',
    licenseUrl: 'https://example.com/license',
    modelCardUrl: null,
    modelId,
    notes: [],
    runtimeId: familyId === 'whisper' ? 'whisper_cpp' : 'onnx_runtime',
    sourceUrl: 'https://example.com/source',
    summary: `${familyId} ${languageTags.join(',')}`,
    task: 'stt',
    uxTags: [],
  };
}

function row(model: CatalogModelRecord): ModelRowState {
  return {
    allowedActions: ['install'],
    installed: false,
    isCanceling: false,
    isInstalling: false,
    isSelected: false,
    model,
  };
}

describe('model browser', () => {
  it('deep-links to the requested task and defaults setup entry points to dictation', () => {
    expect(resolveInitialModelPickerTask({ initialTask: 'tts' })).toBe('tts');
    expect(resolveInitialModelPickerTask({})).toBe('stt');
  });

  it('clears search only when switching tasks', () => {
    expect(searchQueryAfterTaskSwitch('stt', 'tts', 'moonshine')).toBe('');
    expect(searchQueryAfterTaskSwitch('tts', 'tts', 'french')).toBe('french');
  });

  it('derives an All-first language rail from every task in stable native-label order', () => {
    const models = [
      sttModel('english', 'moonshine', ['en']),
      sttModel('multilingual', 'nemotron_asr', ['ja', 'nl', 'es']),
      ttsModel('french', 'fr'),
      ttsModel('german', 'de'),
      ttsModel('portuguese', 'pt'),
      ttsModel('italian', 'it'),
      ttsModel('swedish', 'sv'),
    ];

    expect(deriveModelLanguageOptions(models).map(({ code, label }) => ({ code, label }))).toEqual([
      { code: null, label: 'All languages' },
      { code: 'EN', label: 'English' },
      { code: 'FR', label: 'Français' },
      { code: 'DE', label: 'Deutsch' },
      { code: 'ES', label: 'Español' },
      { code: 'PT', label: 'Português' },
      { code: 'IT', label: 'Italiano' },
      { code: 'NL', label: 'Nederlands' },
      { code: 'JA', label: '日本語' },
      { code: 'SV', label: 'svenska' },
    ]);
  });

  it('scopes rows and search to the active task, family, and language', () => {
    const english = row(sttModel('Whisper Small', 'whisper', ['en']));
    const multilingual = row(
      sttModel('Whisper Large V3 Turbo', 'whisper', ['en', 'es', 'de', 'fr']),
    );
    const cohere = row(sttModel('Cohere Transcribe', 'cohere_transcribe', ['en']));
    expect(
      filterModelRowsForPicker([english, multilingual, cohere], {
        activeFamily: { familyId: 'whisper', runtimeId: 'whisper_cpp' },
        language: { kind: 'language', tag: 'es' },
        query: 'large',
        task: 'stt',
      }),
    ).toEqual([multilingual]);
    expect(
      filterModelRowsForPicker([english, multilingual, cohere], {
        activeFamily: { familyId: 'whisper', runtimeId: 'whisper_cpp' },
        language: ALL_MODEL_LANGUAGES,
        query: '',
        task: 'stt',
      }),
    ).toEqual([english, multilingual]);
  });

  it('filters family tabs before filtering models within the selected family', () => {
    const rows = [
      row(sttModel('Whisper English', 'whisper', ['en'])),
      row(sttModel('Whisper Multilingual', 'whisper', ['en', 'es'])),
      row(sttModel('Cohere', 'cohere_transcribe', ['en'])),
      row(sttModel('Moonshine', 'moonshine', ['en'])),
      row(sttModel('Nemotron', 'nemotron_asr', ['en', 'es'])),
      row(ttsModel('Pocket Spanish', 'es')),
    ];
    const adapter = (familyId: ModelFamilyId, task: ModelTask) => ({
      displayName: familyId,
      familyId,
      runtimeId: familyId === 'whisper' ? ('whisper_cpp' as const) : ('onnx_runtime' as const),
      task,
    });
    const adapters = [
      adapter('whisper', 'stt'),
      adapter('cohere_transcribe', 'stt'),
      adapter('moonshine', 'stt'),
      adapter('nemotron_asr', 'stt'),
      adapter('pocket_tts', 'tts'),
    ];

    expect(
      derivePickerFamilyTabs(adapters, rows, {
        language: { kind: 'language', tag: 'es' },
        task: 'stt',
      }).map((family) => family.familyId),
    ).toEqual(['whisper', 'nemotron_asr']);
    expect(
      derivePickerFamilyTabs(adapters, rows, {
        language: { kind: 'language', tag: 'en' },
        task: 'stt',
      }).map((family) => family.familyId),
    ).toEqual(['whisper', 'cohere_transcribe', 'moonshine', 'nemotron_asr']);
    expect(
      derivePickerFamilyTabs(adapters, rows, {
        language: { kind: 'language', tag: 'es' },
        task: 'tts',
      }).map((family) => family.familyId),
    ).toEqual(['pocket_tts']);
    expect(
      modelMatchesLanguageFilter(sttModel('Any language', 'whisper', ['en']), ALL_MODEL_LANGUAGES),
    ).toBe(true);
  });

  it('wraps keyboard navigation and supports Home and End', () => {
    expect(resolveTabNavigationIndex(0, 'ArrowLeft', 9)).toBe(8);
    expect(resolveTabNavigationIndex(8, 'ArrowRight', 9)).toBe(0);
    expect(resolveTabNavigationIndex(3, 'Home', 9)).toBe(0);
    expect(resolveTabNavigationIndex(2, 'End', 9)).toBe(8);
    expect(resolveTabNavigationIndex(2, 'Enter', 9)).toBeNull();
    expect(resolveTabNavigationIndex(0, 'ArrowRight', 0)).toBeNull();
  });

  it('turns French performance tags into warnings and install confirmation', () => {
    const policy = resolveModelPresentationPolicy(
      ttsModel('pocket_tts_french_24l_int8', 'fr', ['high-cpu', 'may-buffer'], 504_324_300),
    );
    expect(policy.badges.map((badge) => badge.label)).toEqual(['High CPU', 'May buffer']);
    expect(policy.warning).toContain('buffer');
    expect(policy.installConfirmation?.message).toContain('481.0 MiB');
  });
});
