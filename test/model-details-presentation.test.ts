import { describe, expect, it, vi } from 'vitest';
import { buildModelDetailsPresentation } from '../src/models/model-details-presentation';
import type { ModelManagerState } from '../src/models/model-install-manager';
import {
  ModelDetailsModal,
  openSelectedModelDetailsModal,
} from '../src/models/model-management-modals';
import type {
  CatalogModelRecord,
  EngineCapabilitiesRecord,
  InstalledModelRecord,
} from '../src/models/model-management-types';
import type { TestElement } from './__mocks__/obsidian';

function ttsModel(overrides: Partial<CatalogModelRecord> = {}): CatalogModelRecord {
  return {
    artifacts: [
      {
        artifactId: 'voice-alba',
        downloadUrl: 'https://example.com/alba.onnx',
        filename: 'alba.onnx',
        required: true,
        role: 'voice',
        sha256: '0'.repeat(64),
        sizeBytes: 100,
        voiceId: 'alba',
      },
      {
        artifactId: 'voice-cosette',
        downloadUrl: 'https://example.com/cosette.onnx',
        filename: 'cosette.onnx',
        required: false,
        role: 'voice',
        sha256: '1'.repeat(64),
        sizeBytes: 100,
        voiceId: 'cosette',
      },
    ],
    collectionId: 'read-aloud',
    defaultVoice: 'alba',
    displayName: 'Test TTS',
    familyId: 'supertonic',
    languageTags: ['en', 'ja'],
    supportsAutomaticLanguageDetection: false,
    licenseLabel: 'MIT',
    licenseUrl: 'https://example.com/license',
    modelCardUrl: 'https://example.com/card',
    modelId: 'test-tts',
    notes: [],
    runtimeId: 'onnx_runtime',
    sourceUrl: 'https://example.com/source',
    summary: 'Local synthesis',
    task: 'tts',
    uxTags: [],
    ...overrides,
  };
}

function capabilities(overrides: Partial<EngineCapabilitiesRecord['family']> = {}) {
  return {
    family: {
      availableVoices: ['not-from-catalog'],
      maxAudioDurationSecs: null,
      outputSampleRate: 44_100,
      producesPunctuation: false,
      supportedLanguages: { kind: 'list' as const, tags: ['en', 'es', 'de', 'fr'] },
      supportsAutomaticLanguageDetection: false,
      supportsInitialPrompt: false,
      supportsLanguageSelection: true,
      supportsSegmentTimestamps: false,
      supportsSpeedControl: true,
      supportsStreaming: false,
      supportsWordTimestamps: false,
      task: 'tts' as const,
      ...overrides,
    },
    familyId: 'supertonic' as const,
    runtime: {
      acceleratorDetails: { cpu: { available: true, unavailableReason: null } },
      availableAccelerators: ['cpu' as const],
      supportedModelFormats: ['onnx' as const],
    },
    runtimeId: 'onnx_runtime' as const,
  } satisfies EngineCapabilitiesRecord;
}

const installed: InstalledModelRecord = {
  catalogVersion: 1,
  familyId: 'supertonic',
  installPath: '/models/test-tts',
  installedAtUnixMs: 1,
  installedVoiceIds: ['alba'],
  modelId: 'test-tts',
  runtimeId: 'onnx_runtime',
  runtimePath: null,
  totalSizeBytes: 200,
};

describe('buildModelDetailsPresentation', () => {
  it('uses exact catalog languages and catalog voice artifacts, separate from installed voices', () => {
    const presentation = buildModelDetailsPresentation(ttsModel(), installed, capabilities());

    expect(presentation.tts).toEqual({
      availableVoices: [
        { id: 'alba', isDefault: true, label: 'Alba' },
        { id: 'cosette', isDefault: false, label: 'Cosette' },
      ],
      installedVoices: [{ id: 'alba', label: 'Alba' }],
      languages: ['English', '日本語'],
      outputSampleRate: '44.1 kHz',
      supportsSpeedControl: true,
    });
    expect(presentation.capabilityLabels).not.toContain('4 languages');
  });

  it('omits unavailable optional TTS facts without inferring them from family capabilities', () => {
    const model = ttsModel({ artifacts: [], modelCardUrl: null });
    delete model.defaultVoice;
    const presentation = buildModelDetailsPresentation(model, null, null);

    expect(presentation.modelCardUrl).toBeNull();
    expect(presentation.capabilityLabels).toBeNull();
    expect(presentation.tts).toEqual({
      availableVoices: [],
      installedVoices: [],
      languages: ['English', '日本語'],
      outputSampleRate: null,
      supportsSpeedControl: false,
    });
  });

  it('preserves the established STT facts and capability language labels', () => {
    const presentation = buildModelDetailsPresentation(
      ttsModel({
        familyId: 'whisper',
        languageTags: ['en'],
        modelId: 'test-stt',
        runtimeId: 'whisper_cpp',
        task: 'stt',
      }),
      null,
      {
        ...capabilities(),
        family: { ...capabilities().family, task: 'stt' },
        familyId: 'whisper',
        runtimeId: 'whisper_cpp',
      },
    );

    expect(presentation.tts).toBeNull();
    expect(presentation.capabilityLabels).toContain('4 languages');
    expect(presentation.totalSizeBytes).toBe(100);
    expect(presentation.sourceUrl).toBe('https://example.com/source');
  });

  it('renders TTS facts as scan-friendly lists and keeps external links safe', () => {
    const modal = new ModelDetailsModal({} as never, ttsModel(), installed, capabilities());
    modal.open();

    expect(modal.titleEl.textContent).toBe('Test TTS');
    const content = modal.contentEl as unknown as TestElement;
    expect(elementTexts(content)).toEqual(
      expect.arrayContaining([
        'Languages',
        'English',
        '日本語',
        'Available voices',
        'Alba (default)',
        'Installed voices',
        'Speed control',
        '44.1 kHz',
        'Model card',
      ]),
    );
    for (const link of elementsWithAttribute(content, 'href')) {
      expect(link.attributes.get('target')).toBe('_blank');
      expect(link.attributes.get('rel')).toBe('noopener noreferrer');
    }
  });

  it('opens details from the latest selected TTS state at click time', () => {
    let currentState = detailsState(ttsModel({ displayName: 'Stale TTS' }), capabilities());
    const manager = { getState: () => currentState };
    currentState = detailsState(
      ttsModel({ displayName: 'Current TTS' }),
      capabilities({ outputSampleRate: 48_000 }),
    );
    const capture: { opened: ModelDetailsModal | null } = { opened: null };
    const open = vi.spyOn(ModelDetailsModal.prototype, 'open').mockImplementation(function (
      this: ModelDetailsModal,
    ) {
      capture.opened = this;
    });

    openSelectedModelDetailsModal({} as never, manager, 'tts');
    open.mockRestore();
    if (capture.opened === null) {
      throw new Error('Expected the current model details modal to open');
    }
    const opened = capture.opened;
    opened?.onOpen();

    expect(opened?.titleEl.textContent).toBe('Current TTS');
    expect(elementTexts(opened?.contentEl as unknown as TestElement)).toContain('48 kHz');
  });
});

function detailsState(
  model: CatalogModelRecord,
  modelCapabilities: EngineCapabilitiesRecord,
): ModelManagerState {
  return {
    activeInstall: null,
    catalog: { catalogVersion: 1, collections: [], families: [], models: [model] },
    compiledAdapters: [
      {
        displayName: 'Test TTS',
        familyCapabilities: modelCapabilities.family,
        familyId: modelCapabilities.familyId,
        runtimeId: modelCapabilities.runtimeId,
      },
    ],
    compiledRuntimes: [
      {
        displayName: 'ONNX Runtime',
        runtimeCapabilities: modelCapabilities.runtime,
        runtimeId: modelCapabilities.runtimeId,
      },
    ],
    failedInstall: null,
    installedModels: [installed],
    loadError: null,
    loadStatus: 'ready',
    modelStore: { overridePath: null, path: '/models', usingDefaultPath: true },
    selectedModel: null,
    selectedModelCapabilities: { status: 'none' },
    selectedTtsModel: {
      familyId: model.familyId,
      kind: 'catalog_model',
      modelId: model.modelId,
      runtimeId: model.runtimeId,
    },
    selectedTtsModelCapabilities: { status: 'none' },
  };
}

function elementTexts(element: TestElement): string[] {
  return [element.textContent, ...element.children.flatMap(elementTexts)];
}

function elementsWithAttribute(element: TestElement, attribute: string): TestElement[] {
  return [
    ...(element.attributes.has(attribute) ? [element] : []),
    ...element.children.flatMap((child) => elementsWithAttribute(child, attribute)),
  ];
}
