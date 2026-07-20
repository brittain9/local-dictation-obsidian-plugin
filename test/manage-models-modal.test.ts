import { describe, expect, it } from 'vitest';

import {
  filterModelRowsForPicker,
  resolveInitialModelPickerTask,
  resolveInitialTtsLanguage,
  resolveLanguageNavigationIndex,
  searchQueryAfterTaskSwitch,
  TTS_LANGUAGE_OPTIONS,
} from '../src/models/manage-models-modal';
import type { CatalogModelRecord } from '../src/models/model-management-types';
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

describe('read-aloud model browser', () => {
  it('deep-links to the requested task and defaults setup entry points to dictation', () => {
    expect(resolveInitialModelPickerTask({ initialTask: 'tts' })).toBe('tts');
    expect(resolveInitialModelPickerTask({})).toBe('stt');
  });

  it('clears search only when switching tasks', () => {
    expect(searchQueryAfterTaskSwitch('stt', 'tts', 'moonshine')).toBe('');
    expect(searchQueryAfterTaskSwitch('tts', 'tts', 'french')).toBe('french');
  });

  it('keeps all six languages in the requested native-label order', () => {
    expect(TTS_LANGUAGE_OPTIONS).toEqual([
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'Français' },
      { code: 'de', label: 'Deutsch' },
      { code: 'es', label: 'Español' },
      { code: 'pt', label: 'Português' },
      { code: 'it', label: 'Italiano' },
    ]);
  });

  it('uses the selected TTS model language and otherwise defaults to English', () => {
    const french = ttsModel('pocket_tts_french_24l_int8', 'fr');
    const catalog = { catalogVersion: 1, collections: [], families: [], models: [french] };
    expect(resolveInitialTtsLanguage({ catalog, selectedTtsModel: null })).toBe('en');
    expect(
      resolveInitialTtsLanguage({
        catalog,
        selectedTtsModel: {
          familyId: 'pocket_tts',
          kind: 'catalog_model',
          modelId: french.modelId,
          runtimeId: 'onnx_runtime',
        },
      }),
    ).toBe('fr');
  });

  it('scopes rows and search to the active task and language', () => {
    const french = row(ttsModel('pocket_tts_french_24l_int8', 'fr', ['may-buffer']));
    const german = row(ttsModel('pocket_tts_german_int8', 'de'));
    expect(
      filterModelRowsForPicker([french, german], {
        activeFamily: null,
        language: 'fr',
        query: 'buffer',
        task: 'tts',
      }),
    ).toEqual([french]);
  });

  it('wraps keyboard navigation and supports Home and End', () => {
    expect(resolveLanguageNavigationIndex(0, 'ArrowLeft')).toBe(5);
    expect(resolveLanguageNavigationIndex(5, 'ArrowRight')).toBe(0);
    expect(resolveLanguageNavigationIndex(3, 'Home')).toBe(0);
    expect(resolveLanguageNavigationIndex(2, 'End')).toBe(5);
    expect(resolveLanguageNavigationIndex(2, 'Enter')).toBeNull();
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
