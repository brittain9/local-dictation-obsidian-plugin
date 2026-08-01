import { describe, expect, it, vi } from 'vitest';
import type { ModelInstallManager, ModelManagerState } from '../src/models/model-install-manager';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import {
  configureReadAloudSpeedSlider,
  readAloudControlsFingerprint,
  renderTextToSpeechSettings,
} from '../src/settings/read-aloud-settings-section';
import { Setting, SliderComponent, TestElement } from './__mocks__/obsidian';

function state(
  voices: string[],
  downloadedBytes: number | null = null,
  modelId = 'pocket_tts_english_2026_04_int8',
  includeCatalogModel = false,
): ModelManagerState {
  return {
    activeInstall:
      downloadedBytes === null
        ? null
        : {
            installUpdate: {
              details: null,
              downloadedBytes,
              familyId: 'pocket_tts',
              installId: 'voice-install',
              message: null,
              modelId,
              runtimeId: 'onnx_runtime',
              state: 'downloading',
              totalBytes: 100,
            },
            lastError: null,
            phase: 'installing',
          },
    catalog: {
      catalogVersion: 5,
      collections: [],
      families: [],
      models: includeCatalogModel
        ? [
            {
              artifacts: [],
              collectionId: 'read-aloud',
              defaultVoice: 'alba',
              displayName: `Pocket TTS ${modelId}`,
              familyId: 'pocket_tts',
              languageTags: ['en'],
              supportsAutomaticLanguageDetection: false,
              licenseLabel: 'MIT',
              licenseUrl: 'https://example.com/license',
              modelCardUrl: null,
              modelId,
              notes: [],
              runtimeId: 'onnx_runtime',
              sourceUrl: 'https://example.com/source',
              summary: 'Local synthesis',
              task: 'tts',
              uxTags: [],
            },
          ]
        : [],
    },
    compiledAdapters: [],
    compiledRuntimes: [],
    failedInstall: null,
    installedModels: [
      {
        catalogVersion: 5,
        familyId: 'pocket_tts',
        installPath: '/models/pocket',
        installedAtUnixMs: 1,
        installedVoiceIds: voices,
        modelId,
        runtimeId: 'onnx_runtime',
        runtimePath: '/models/pocket/flow_lm_main_int8.onnx',
        totalSizeBytes: 1,
      },
    ],
    loadError: null,
    loadStatus: 'ready',
    modelStore: { overridePath: null, path: '/models', usingDefaultPath: true },
    selectedModel: null,
    selectedModelCapabilities: { status: 'none' },
    selectedTtsModel: {
      familyId: 'pocket_tts',
      kind: 'catalog_model',
      modelId,
      runtimeId: 'onnx_runtime',
    },
    selectedTtsModelCapabilities: { status: 'none' },
  };
}

describe('Read Aloud settings incremental refresh', () => {
  it('shows the speed value dynamically and persists changes', () => {
    const slider = new SliderComponent();
    const persistSpeed = vi.fn(async () => {});

    configureReadAloudSpeedSlider(
      slider as unknown as import('obsidian').SliderComponent,
      1.25,
      persistSpeed,
    );

    expect(slider.dynamicTooltip).toBe(true);
    expect(slider.value).toBe(1.25);
    expect(slider.sliderEl).toMatchObject({ max: '2', min: '0.75', step: '0.05' });
    slider.change(1.5);
    expect(persistSpeed).toHaveBeenCalledWith(1.5);
  });

  it('ignores progress ticks but changes when same-model voice metadata refreshes', () => {
    const before = readAloudControlsFingerprint(state(['alba'], 10));
    expect(readAloudControlsFingerprint(state(['alba'], 90))).toBe(before);
    expect(readAloudControlsFingerprint(state(['alba', 'cosette'], null))).not.toBe(before);
  });

  it('changes when an unchanged selection becomes resolvable in the current catalog', () => {
    const unresolved = state(['alba']);
    const resolved = state(['alba'], null, 'pocket_tts_english_2026_04_int8', true);

    expect(resolved.catalog.catalogVersion).toBe(unresolved.catalog.catalogVersion);
    expect(resolved.selectedTtsModel).toEqual(unresolved.selectedTtsModel);
    expect(readAloudControlsFingerprint(resolved)).not.toBe(
      readAloudControlsFingerprint(unresolved),
    );
  });

  it('re-renders only its controls after voice metadata refreshes', () => {
    Setting.reset();
    let currentState = state(['alba'], 10);
    let notify = () => {};
    const manager = {
      getState: () => currentState,
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => {};
      },
    } as unknown as ModelInstallManager;
    const parent = new TestElement();
    const modelControls = parent.createDiv();
    const modelBefore = modelControls.createDiv();
    const readAloudControls = parent.createDiv();
    const readAloudBefore = readAloudControls.createDiv();
    const focusedSibling = parent.createDiv({ attr: { 'data-focused': 'true' } });
    const dispose = renderTextToSpeechSettings(
      modelControls as unknown as HTMLDivElement,
      modelBefore as unknown as HTMLElement,
      readAloudControls as unknown as HTMLDivElement,
      readAloudBefore as unknown as HTMLElement,
      {
        getSettings: () => ({
          ...DEFAULT_PLUGIN_SETTINGS,
          selectedTtsModel: currentState.selectedTtsModel,
        }),
        manager,
        openSelectedModelDetails: vi.fn(),
        openModelPicker: vi.fn(async () => {}),
        persistVoice: vi.fn(async () => {}),
      },
    );
    const originalFirstControl = modelControls.children[0];
    expect(modelControls.children).toEqual([originalFirstControl, modelBefore]);
    expect(readAloudControls.children[1]).toBe(readAloudBefore);
    expect(Setting.named('Text-to-speech model').descEl.textContent).toBe('No model selected');
    expect(Setting.named('Voice')).toBeDefined();

    currentState = state(['alba'], 90);
    notify();
    expect(modelControls.children[0]).toBe(originalFirstControl);

    currentState = state(['alba', 'cosette']);
    notify();
    expect(modelControls.children[0]).not.toBe(originalFirstControl);
    expect(parent.children).toContain(focusedSibling);
    dispose();
  });

  it('shows a localized details button only for resolvable selections and delegates clicks to current state', async () => {
    Setting.reset();
    let currentState = state(['alba'], null, 'pocket_tts_english_2026_04_int8', true);
    let notify = () => {};
    let openedModelId: string | null = null;
    const manager = {
      getState: () => currentState,
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => {};
      },
    } as unknown as ModelInstallManager;
    const parent = new TestElement();
    const modelControls = parent.createDiv();
    const modelBefore = modelControls.createDiv();
    const readAloudControls = parent.createDiv();
    const readAloudBefore = readAloudControls.createDiv();
    const details = vi.fn(() => {
      openedModelId =
        currentState.selectedTtsModel?.kind === 'catalog_model'
          ? currentState.selectedTtsModel.modelId
          : null;
    });

    renderTextToSpeechSettings(
      modelControls as unknown as HTMLDivElement,
      modelBefore as unknown as HTMLElement,
      readAloudControls as unknown as HTMLDivElement,
      readAloudBefore as unknown as HTMLElement,
      {
        getSettings: () => ({
          ...DEFAULT_PLUGIN_SETTINGS,
          selectedTtsModel: currentState.selectedTtsModel,
        }),
        manager,
        openSelectedModelDetails: details,
        openModelPicker: vi.fn(async () => {}),
        persistVoice: vi.fn(async () => {}),
      },
    );

    const firstModelSetting = Setting.named('Text-to-speech model');
    expect(firstModelSetting.extraButtonComponents).toHaveLength(1);
    expect(firstModelSetting.extraButtonComponents[0]?.icon).toBe('info');
    expect(firstModelSetting.extraButtonComponents[0]?.tooltip).toBe('Model details');

    currentState = state(['alba'], null, 'pocket_tts_english_new', true);
    notify();
    const currentModelSetting = Setting.instances
      .filter((setting) => setting.name === 'Text-to-speech model')
      .at(-1);
    await currentModelSetting?.extraButtonComponents[0]?.click();
    expect(openedModelId).toBe('pocket_tts_english_new');

    currentState = { ...state([]), catalog: { ...state([]).catalog, models: [] } };
    notify();
    const unresolvedModelSetting = Setting.instances
      .filter((setting) => setting.name === 'Text-to-speech model')
      .at(-1);
    expect(unresolvedModelSetting?.extraButtonComponents).toHaveLength(0);
  });
});
