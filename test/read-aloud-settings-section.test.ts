import { describe, expect, it, vi } from 'vitest';
import type { ModelInstallManager, ModelManagerState } from '../src/models/model-install-manager';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import {
  readAloudControlsFingerprint,
  renderTextToSpeechSettings,
} from '../src/settings/read-aloud-settings-section';
import { Setting, TestElement } from './__mocks__/obsidian';

function state(voices: string[], downloadedBytes: number | null = null): ModelManagerState {
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
              modelId: 'pocket_tts_english_2026_04_int8',
              runtimeId: 'onnx_runtime',
              state: 'downloading',
              totalBytes: 100,
            },
            lastError: null,
            phase: 'installing',
          },
    catalog: { catalogVersion: 5, collections: [], families: [], models: [] },
    compiledAdapters: [],
    compiledRuntimes: [],
    installedModels: [
      {
        catalogVersion: 5,
        familyId: 'pocket_tts',
        installPath: '/models/pocket',
        installedAtUnixMs: 1,
        installedVoiceIds: voices,
        modelId: 'pocket_tts_english_2026_04_int8',
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
      modelId: 'pocket_tts_english_2026_04_int8',
      runtimeId: 'onnx_runtime',
    },
    selectedTtsModelCapabilities: { status: 'none' },
  };
}

describe('Read Aloud settings incremental refresh', () => {
  it('ignores progress ticks but changes when same-model voice metadata refreshes', () => {
    const before = readAloudControlsFingerprint(state(['alba'], 10));
    expect(readAloudControlsFingerprint(state(['alba'], 90))).toBe(before);
    expect(readAloudControlsFingerprint(state(['alba', 'cosette'], null))).not.toBe(before);
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
});
