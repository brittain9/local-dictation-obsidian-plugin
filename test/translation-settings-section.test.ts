import { describe, expect, it, vi } from 'vitest';

import type { ModelInstallManager, ModelManagerState } from '../src/models/model-install-manager';
import type { CatalogModelRecord } from '../src/models/model-management-types';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { renderTranslationSettings } from '../src/settings/translation-settings-section';
import { Setting, TestElement } from './__mocks__/obsidian';

function state(installed: boolean, tencentInstalled = false): ModelManagerState {
  const model: CatalogModelRecord = {
    artifacts: [
      {
        artifactId: 'runtime',
        downloadUrl: 'https://example.com/runtime',
        filename: 'bergamot-translator.wasm',
        required: true,
        role: 'supporting_file',
        sha256: 'a'.repeat(64),
        sizeBytes: 551_598_146,
      },
    ],
    collectionId: 'translation',
    displayName: 'Firefox Translations',
    familyId: 'firefox_translations',
    languageTags: ['en', 'es', 'de', 'fr', 'pt', 'it', 'nl', 'ja'],
    licenseLabel: 'MPL-2.0',
    licenseUrl: 'https://www.mozilla.org/MPL/2.0/',
    modelCardUrl: null,
    modelId: 'firefox_translations_release_2026_07',
    notes: [],
    runtimeId: 'bergamot_wasm',
    sourceUrl: 'https://github.com/mozilla/firefox-translations-models',
    summary: 'Fast local translation',
    supportsAutomaticLanguageDetection: false,
    task: 'translation',
    translationSupport: { kind: 'pairs', pairs: [{ source: 'en', target: 'es' }] },
    uxTags: [],
  };
  const tencentModel: CatalogModelRecord = {
    ...model,
    artifacts: [
      {
        artifactId: 'model',
        downloadUrl: 'https://example.com/hy-mt',
        filename: 'hy-mt.gguf',
        required: true,
        role: 'translation_model',
        sha256: 'b'.repeat(64),
        sizeBytes: 1_000_000_000,
      },
    ],
    displayName: 'Tencent HY-MT',
    familyId: 'tencent_hy_mt',
    languageTags: ['en', 'es'],
    modelId: 'hy-mt',
    runtimeId: 'llama_cpp',
    translationSupport: { kind: 'all_to_all', languages: ['en', 'es'] },
  };
  return {
    activeInstall: null,
    catalog: {
      catalogVersion: 6,
      collections: [],
      families: [],
      models: [model, tencentModel],
    },
    compiledAdapters: [],
    compiledRuntimes: [],
    failedInstall: null,
    installedModels: [
      ...(installed
        ? [
            {
              catalogVersion: 6,
              familyId: model.familyId,
              installPath: '/models/firefox',
              installedAtUnixMs: 1,
              installedVoiceIds: [],
              modelId: model.modelId,
              runtimeId: model.runtimeId,
              runtimePath: '/models/firefox/bergamot-translator.wasm',
              totalSizeBytes: 551_598_146,
            },
          ]
        : []),
      ...(tencentInstalled
        ? [
            {
              catalogVersion: 6,
              familyId: tencentModel.familyId,
              installPath: '/models/hy-mt',
              installedAtUnixMs: 1,
              installedVoiceIds: [],
              modelId: tencentModel.modelId,
              runtimeId: tencentModel.runtimeId,
              runtimePath: '/models/hy-mt/hy-mt.gguf',
              totalSizeBytes: 1_000_000_000,
            },
          ]
        : []),
    ],
    loadError: null,
    loadStatus: 'ready',
    modelStore: { overridePath: null, path: '/models', usingDefaultPath: true },
    selectedModel: null,
    selectedModelCapabilities: { status: 'none' },
    selectedTtsModel: null,
    selectedTtsModelCapabilities: { status: 'none' },
  };
}

describe('Translation settings', () => {
  it('shows the installed model and deep-links model management to Translation', async () => {
    Setting.reset();
    const openModelPicker = vi.fn(async () => {});
    const container = new TestElement();
    const persistEngine = vi.fn(async () => {});
    const manager = {
      getState: () => state(true),
      subscribe: () => () => {},
    } as unknown as ModelInstallManager;

    renderTranslationSettings(container as unknown as HTMLDivElement, {
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      manager,
      openModelPicker,
      persistEngine,
      persistLanguages: vi.fn(async () => {}),
    });

    const modelSetting = Setting.named('Translation model');
    expect(modelSetting.descEl.textContent).toContain('Firefox Translations');
    expect(modelSetting.descEl.textContent).toContain('Installed');
    await modelSetting.buttonComponents[0]?.click();
    expect(openModelPicker).toHaveBeenCalledExactlyOnceWith({
      initialTask: 'translation',
    });
  });

  it('shows the effective language pair and keeps it valid when source changes', async () => {
    Setting.reset();
    const persistEngine = vi.fn(async () => {});
    let settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      dictationLanguage: 'en' as const,
    };
    const persistLanguages = vi.fn(async (sourceLanguage, targetLanguage) => {
      settings = {
        ...settings,
        translationSourceLanguage: sourceLanguage,
        translationTargetLanguage: targetLanguage,
      };
    });
    const container = new TestElement();
    const manager = {
      getState: () => state(false),
      subscribe: () => () => {},
    } as unknown as ModelInstallManager;

    renderTranslationSettings(container as unknown as HTMLDivElement, {
      getSettings: () => settings,
      manager,
      openModelPicker: vi.fn(async () => {}),
      persistEngine,
      persistLanguages,
    });

    expect(Setting.named('Default source language').dropdownComponents[0]?.selectEl.value).toBe(
      'en',
    );
    expect(Setting.named('Default target language').dropdownComponents[0]?.selectEl.value).toBe(
      'es',
    );

    Setting.named('Default source language').dropdownComponents[0]?.change('fr');
    await vi.waitFor(() => {
      expect(persistLanguages).toHaveBeenCalledExactlyOnceWith('fr', 'es');
      expect(persistEngine).toHaveBeenCalledExactlyOnceWith('tencent_hy_mt');
    });
  });

  it('shows the installed style as default and disables styles whose model is missing', () => {
    Setting.reset();
    const persistEngine = vi.fn(async () => {});
    const container = new TestElement();
    const manager = {
      getState: () => state(false, true),
      subscribe: () => () => {},
    } as unknown as ModelInstallManager;

    renderTranslationSettings(container as unknown as HTMLDivElement, {
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      manager,
      openModelPicker: vi.fn(async () => {}),
      persistEngine,
      persistLanguages: vi.fn(async () => {}),
    });

    const engine = Setting.named('Default translation style').dropdownComponents[0];
    expect(engine?.selectEl.value).toBe('tencent_hy_mt');
    expect(engine?.selectEl.options.find((option) => option.value === 'bergamot')).toEqual(
      expect.objectContaining({
        disabled: true,
        label: expect.stringContaining('(not installed)'),
      }),
    );
    engine?.change('tencent_hy_mt');
    expect(persistEngine).toHaveBeenCalledExactlyOnceWith('tencent_hy_mt');
  });

  it('summarizes all installed translation models', () => {
    Setting.reset();
    const manager = {
      getState: () => state(true, true),
      subscribe: () => () => {},
    } as unknown as ModelInstallManager;

    renderTranslationSettings(new TestElement() as unknown as HTMLDivElement, {
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      manager,
      openModelPicker: vi.fn(async () => {}),
      persistEngine: vi.fn(async () => {}),
      persistLanguages: vi.fn(async () => {}),
    });

    expect(Setting.named('Translation model').descEl.textContent).toContain(
      '2 translation models installed',
    );
  });
});
