import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

import type { PluginSettings } from '../src/settings/plugin-settings';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import type { SidecarEvent } from '../src/sidecar/protocol';
import { TranslationController } from '../src/translation/translation-controller';
import { Modal, Setting } from './__mocks__/obsidian';

describe('TranslationController', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explains why an empty note cannot be translated', () => {
    const show = vi.fn();
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show },
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      logger: { error: vi.fn() } as never,
      modelManager: {} as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
    });
    const editor = {
      getValue: () => ' \n ',
    };

    controller.translateNote(editor as never);

    expect(show).toHaveBeenCalledExactlyOnceWith({
      intent: 'warning',
      key: 'translation-no-text',
      message: 'There is no text to translate in this note.',
    });
  });

  it('stays inert and offers model installation when no translation model is installed', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const worker = vi.fn();
    vi.stubGlobal('Worker', worker);
    const replaceRange = vi.fn();
    const openModelPicker = vi.fn(async () => {});
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      logger: { error: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [] },
          installedModels: [],
        }),
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker,
      saveSettings: vi.fn(async () => {}),
    });
    const editor = {
      getValue: () => 'Translate this note.',
      replaceRange,
    };

    controller.translateNote(editor as never);

    await vi.waitFor(() => {
      expect(Modal.instances).toHaveLength(1);
      expect(Setting.buttonNamed('Install translation model')).toBeDefined();
    });
    expect(worker).not.toHaveBeenCalled();
    expect(replaceRange).not.toHaveBeenCalled();
    expect(openModelPicker).not.toHaveBeenCalled();
  });

  it('detaches a long translation job, reopens it without duplicate inference, and keeps progress current', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const listeners: ((event: SidecarEvent) => void)[] = [];
    let translationId = '';
    const startTranslation = vi.fn(async (payload: { translationId: string }) => {
      translationId = payload.translationId;
    });
    const cancelTranslation = vi.fn();
    const setDetachedStatus = vi.fn();
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      selectedTranslationModel: {
        familyId: 'tencent_hy_mt' as const,
        kind: 'catalog_model' as const,
        modelId: 'hy-mt',
        runtimeId: 'llama_cpp' as const,
      },
    };
    const model = {
      familyId: 'tencent_hy_mt',
      modelId: 'hy-mt',
      runtimeId: 'llama_cpp',
      task: 'translation',
      translationSupport: { kind: 'all_to_all', languages: ['en', 'es'] },
    };
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => settings,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [model] },
          selectedTranslationModel: settings.selectedTranslationModel,
          installedModels: [
            {
              familyId: 'tencent_hy_mt',
              modelId: 'hy-mt',
              runtimeId: 'llama_cpp',
            },
          ],
        }),
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      setDetachedStatus,
      sidecarConnection: {
        cancelTranslation,
        startTranslation,
        subscribe: (next: (event: SidecarEvent) => void) => {
          listeners.push(next);
          return () => {};
        },
      } as never,
    });
    const editor = {
      getValue: () => 'Translate this note.',
      replaceRange: vi.fn(),
    };

    controller.translateNote(editor as never);
    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(1));
    Modal.instances.at(-1)?.close();
    expect(cancelTranslation).not.toHaveBeenCalled();
    expect(setDetachedStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'loading' }),
      expect.any(Function),
    );

    controller.translateNote(editor as never);
    expect(startTranslation).toHaveBeenCalledTimes(1);
    expect(Modal.instances).toHaveLength(2);
    listeners[1]?.({
      type: 'translation_progress',
      translationId,
      completed: 1,
      total: 1,
    });
    listeners[0]?.({
      type: 'translation_complete',
      translationId,
      translations: ['Traduzca esta nota.'],
    });
    await vi.waitFor(() => expect(Setting.buttonNamed('Replace')).toBeDefined());
  });

  it('starts a fresh translation from the current note after it changed', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const listeners: ((event: SidecarEvent) => void)[] = [];
    const startTranslation = vi.fn(
      async (_payload: { texts: string[]; translationId: string }) => {},
    );
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      selectedTranslationModel: {
        familyId: 'tencent_hy_mt' as const,
        kind: 'catalog_model' as const,
        modelId: 'hy-mt',
        runtimeId: 'llama_cpp' as const,
      },
    };
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => settings,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: {
            models: [
              {
                familyId: 'tencent_hy_mt',
                modelId: 'hy-mt',
                runtimeId: 'llama_cpp',
                task: 'translation',
                translationSupport: {
                  kind: 'all_to_all',
                  languages: ['en', 'es'],
                },
              },
            ],
          },
          selectedTranslationModel: settings.selectedTranslationModel,
          installedModels: [
            {
              familyId: 'tencent_hy_mt',
              modelId: 'hy-mt',
              runtimeId: 'llama_cpp',
            },
          ],
        }),
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      sidecarConnection: {
        cancelTranslation: vi.fn(),
        startTranslation,
        subscribe: (next: (event: SidecarEvent) => void) => {
          listeners.push(next);
          return () => {};
        },
      } as never,
    });
    let note = 'First version.';
    const editor = { getValue: () => note, replaceRange: vi.fn() };

    controller.translateNote(editor as never);
    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(1));
    const firstTranslationId = startTranslation.mock.calls[0]?.[0].translationId;
    if (firstTranslationId === undefined)
      throw new Error('Expected the first translation to start.');
    note = 'Updated version.';
    listeners[0]?.({
      type: 'translation_complete',
      translationId: firstTranslationId,
      translations: ['Versión inicial.'],
    });
    await vi.waitFor(() => expect(Setting.buttonNamed('Translate again')).toBeDefined());

    await Setting.buttonNamed('Translate again').click();

    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(2));
    expect(startTranslation.mock.calls[1]?.[0].texts).toEqual(['Updated version.']);
  });

  it('preserves draft languages across model management and modal reopen without auto-translating', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const listeners: ((event: SidecarEvent) => void)[] = [];
    let translationId = '';
    const startTranslation = vi.fn(async (payload: { translationId: string }) => {
      translationId = payload.translationId;
    });
    const firstModel = translationModel('hy-mt-1.8b', 'HY-MT 2 1.8B');
    const secondModel = translationModel('hy-mt-7b', 'HY-MT 2 7B');
    let settings: PluginSettings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      selectedTranslationModel: selectionFor(firstModel),
    };
    const saveSettings = vi.fn(async (next: PluginSettings) => {
      settings = next;
    });
    const openModelPicker = vi.fn(async () => {
      settings = {
        ...settings,
        selectedTranslationModel: selectionFor(secondModel),
      };
    });
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => settings,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [firstModel, secondModel] },
          installedModels: [installedRecord(firstModel), installedRecord(secondModel)],
          selectedTranslationModel: settings.selectedTranslationModel,
        }),
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker,
      saveSettings,
      sidecarConnection: {
        cancelTranslation: vi.fn(),
        startTranslation,
        subscribe: (next: (event: SidecarEvent) => void) => {
          listeners.push(next);
          return () => {};
        },
      } as never,
    });
    const editor = {
      getValue: () => 'Translate this note.',
      replaceRange: vi.fn(),
    };

    controller.translateNote(editor as never);
    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledOnce());
    listeners[0]?.({
      type: 'translation_complete',
      translationId,
      translations: ['Traduzca esta nota.'],
    });
    await vi.waitFor(() => expect(Setting.buttonNamed('Replace')).toBeDefined());

    const sourceSetting = Setting.instances.filter((setting) => setting.name === 'From').at(-1);
    sourceSetting?.dropdownComponents[0]?.change('es');
    await vi.waitFor(() =>
      expect(settings).toMatchObject({
        translationSourceLanguage: 'es',
        translationTargetLanguage: 'en',
      }),
    );

    const modelSetting = Setting.instances
      .filter((setting) => setting.name === 'Translation model')
      .at(-1);
    await modelSetting?.buttonComponents
      .find((button) => button.text === 'Manage translation models')
      ?.click();

    await vi.waitFor(() => expect(Modal.instances).toHaveLength(2));
    expect(startTranslation).toHaveBeenCalledOnce();
    expect(openModelPicker).toHaveBeenCalledOnce();
    expect(latestDropdownValue('From')).toBe('es');
    expect(latestDropdownValue('To')).toBe('en');
    expect(latestDropdownLabel('Translation model')).toBe('HY-MT 2 7B');

    Modal.instances.at(-1)?.close();
    controller.translateNote(editor as never);

    expect(Modal.instances).toHaveLength(3);
    expect(startTranslation).toHaveBeenCalledOnce();
    expect(latestDropdownValue('From')).toBe('es');
    expect(latestDropdownValue('To')).toBe('en');
    expect(latestDropdownLabel('Translation model')).toBe('HY-MT 2 7B');
  });

  it('bounds realtime translation work and cancels the active request when disposed', async () => {
    const listeners: ((event: SidecarEvent) => void)[] = [];
    const startTranslation = vi.fn(
      async (_payload: { texts: string[]; translationId: string }) => {},
    );
    const cancelTranslation = vi.fn();
    const warn = vi.fn();
    const insertAdjacentToSessionRange = vi.fn(() => true);
    const model = translationModel('hy-mt-1.8b', 'HY-MT 2 1.8B');
    const settings: PluginSettings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      dictationLanguage: 'en',
      realtimeTranslationEnabled: true,
      selectedTranslationModel: selectionFor(model),
      translationSourceLanguage: 'en',
      translationTargetLanguage: 'es',
    };
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => settings,
      logger: { error: vi.fn(), warn } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [model] },
          installedModels: [installedRecord(model)],
          selectedTranslationModel: settings.selectedTranslationModel,
        }),
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      sidecarConnection: {
        cancelTranslation,
        startTranslation,
        subscribe: (next: (event: SidecarEvent) => void) => {
          listeners.push(next);
          return () => {};
        },
      } as never,
    });
    const target = { insertAdjacentToSessionRange };

    for (let index = 0; index < 17; index += 1)
      controller.translateRealtime(`Sentence ${index}.`, target);

    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledOnce());
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'translation',
      'realtime translation queue is full; skipped a sentence (16 pending)',
    );
    const translationId = startTranslation.mock.calls[0]?.[0].translationId;
    if (translationId === undefined) throw new Error('Expected realtime translation to start.');

    controller.dispose();

    expect(cancelTranslation).toHaveBeenCalledExactlyOnceWith(translationId);
    listeners[0]?.({
      type: 'translation_complete',
      translationId,
      translations: ['Frase traducida.'],
    });
    await Promise.resolve();
    expect(insertAdjacentToSessionRange).not.toHaveBeenCalled();
  });

  it('uses resolved language defaults when realtime languages have not been persisted', async () => {
    const listeners: ((event: SidecarEvent) => void)[] = [];
    const startTranslation = vi.fn(
      async (_payload: {
        sourceLanguage: string;
        targetLanguage: string;
        translationId: string;
      }) => {},
    );
    const insertAdjacentToSessionRange = vi.fn(() => true);
    const model = translationModel('hy-mt-1.8b', 'HY-MT 2 1.8B');
    model.languageTags = ['zh', 'en'];
    model.translationSupport.languages = ['zh', 'en'];
    const settings: PluginSettings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      dictationLanguage: 'zh',
      realtimeTranslationEnabled: true,
      selectedTranslationModel: selectionFor(model),
      translationSourceLanguage: null,
      translationTargetLanguage: null,
    };
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => settings,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [model] },
          installedModels: [installedRecord(model)],
          selectedTranslationModel: settings.selectedTranslationModel,
        }),
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      sidecarConnection: {
        cancelTranslation: vi.fn(),
        startTranslation,
        subscribe: (next: (event: SidecarEvent) => void) => {
          listeners.push(next);
          return () => {};
        },
      } as never,
    });

    controller.translateRealtime('你好。', { insertAdjacentToSessionRange });

    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledOnce());
    expect(startTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: 'zh', targetLanguage: 'en' }),
    );
    const translationId = startTranslation.mock.calls[0]?.[0].translationId;
    if (translationId === undefined) throw new Error('Expected realtime translation to start.');
    listeners[0]?.({
      type: 'translation_complete',
      translationId,
      translations: ['Hello.'],
    });
    await vi.waitFor(() =>
      expect(insertAdjacentToSessionRange).toHaveBeenCalledWith('> Hello.', 'below'),
    );
  });

  it('infers Chinese for realtime translation when dictation language is auto', async () => {
    const listeners: ((event: SidecarEvent) => void)[] = [];
    const startTranslation = vi.fn(
      async (_payload: {
        sourceLanguage: string;
        targetLanguage: string;
        translationId: string;
      }) => {},
    );
    const model = translationModel('hy-mt-1.8b', 'HY-MT 2 1.8B');
    model.languageTags = ['zh', 'en'];
    model.translationSupport.languages = ['zh', 'en'];
    const settings: PluginSettings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      dictationLanguage: 'auto',
      realtimeTranslationEnabled: true,
      selectedTranslationModel: selectionFor(model),
      translationSourceLanguage: null,
      translationTargetLanguage: null,
    };
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => settings,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [model] },
          installedModels: [installedRecord(model)],
          selectedTranslationModel: settings.selectedTranslationModel,
        }),
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      sidecarConnection: {
        cancelTranslation: vi.fn(),
        startTranslation,
        subscribe: (next: (event: SidecarEvent) => void) => {
          listeners.push(next);
          return () => {};
        },
      } as never,
    });
    const target = { insertAdjacentToSessionRange: vi.fn(() => true) };
    controller.translateRealtime('这是中文句子。', target);
    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledOnce());
    expect(startTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: 'zh', targetLanguage: 'en' }),
    );
  });

  it('coalesces partial realtime translations and lets the final revision win', async () => {
    const listeners: ((event: SidecarEvent) => void)[] = [];
    const startTranslation = vi.fn(
      async (_payload: { texts: string[]; translationId: string }) => {},
    );
    const cancelTranslation = vi.fn();
    const replaceUtteranceTranslation = vi.fn(() => true);
    const model = translationModel('hy-mt-1.8b', 'HY-MT 2 1.8B');
    const settings: PluginSettings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      dictationLanguage: 'en',
      realtimeTranslationEnabled: true,
      selectedTranslationModel: selectionFor(model),
      translationSourceLanguage: 'en',
      translationTargetLanguage: 'es',
    };
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => settings,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [model] },
          installedModels: [installedRecord(model)],
          selectedTranslationModel: settings.selectedTranslationModel,
        }),
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      sidecarConnection: {
        cancelTranslation,
        startTranslation,
        subscribe: (next: (event: SidecarEvent) => void) => {
          listeners.push(next);
          return () => {};
        },
      } as never,
    });
    const target = {
      insertAdjacentToSessionRange: vi.fn(() => true),
      replaceUtteranceTranslation,
    };
    const firstUpdate = { isFinal: false, revision: 0, utteranceId: 'u1' };
    const secondUpdate = { isFinal: false, revision: 1, utteranceId: 'u1' };
    const finalUpdate = { isFinal: true, revision: 2, utteranceId: 'u1' };
    controller.translateRealtime('ok', target, {
      isFinal: false,
      revision: 0,
      utteranceId: 'short-partial',
    });
    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledOnce());
    const shortId = startTranslation.mock.calls[0]?.[0].translationId;
    if (shortId === undefined) throw new Error('Expected short partial translation.');
    listeners[0]?.({
      type: 'translation_complete',
      translationId: shortId,
      translations: ['Vale'],
    });
    await vi.waitFor(() => expect(replaceUtteranceTranslation).toHaveBeenCalledOnce());
    controller.translateRealtime('partial words', target, firstUpdate);
    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(2));
    controller.translateRealtime('newer partial words', target, secondUpdate);
    const firstId = startTranslation.mock.calls[1]?.[0].translationId;
    if (firstId === undefined) throw new Error('Expected first translation.');
    listeners[1]?.({
      type: 'translation_complete',
      translationId: firstId,
      translations: ['Parcial'],
    });
    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(3));
    expect(startTranslation.mock.calls[2]?.[0].texts).toEqual(['newer partial words']);
    const secondId = startTranslation.mock.calls[2]?.[0].translationId;
    if (secondId === undefined) throw new Error('Expected second translation.');
    controller.translateRealtime('final.', target, finalUpdate);
    listeners[2]?.({
      type: 'translation_complete',
      translationId: secondId,
      translations: ['Nuevo parcial.'],
    });
    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(4));
    expect(startTranslation.mock.calls[3]?.[0].texts).toEqual(['final.']);
    const finalId = startTranslation.mock.calls[3]?.[0].translationId;
    if (finalId === undefined) throw new Error('Expected final translation.');
    listeners[3]?.({
      type: 'translation_complete',
      translationId: finalId,
      translations: ['Final.'],
    });
    await vi.waitFor(() => expect(replaceUtteranceTranslation).toHaveBeenCalledTimes(2));
    expect(replaceUtteranceTranslation).toHaveBeenLastCalledWith('u1', 'Final.');
  });
});

function translationModel(modelId: string, displayName: string) {
  return {
    artifacts: [],
    collectionId: 'translation',
    displayName,
    familyId: 'tencent_hy_mt' as const,
    languageTags: ['en', 'es'],
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://example.com/license',
    modelCardUrl: null,
    modelId,
    notes: [],
    runtimeId: 'llama_cpp' as const,
    sourceUrl: 'https://example.com/model',
    summary: 'Local translation',
    supportsAutomaticLanguageDetection: false,
    task: 'translation' as const,
    translationSupport: {
      kind: 'all_to_all' as const,
      languages: ['en', 'es'],
    },
    uxTags: [],
  };
}

function selectionFor(model: ReturnType<typeof translationModel>) {
  return {
    familyId: model.familyId,
    kind: 'catalog_model' as const,
    modelId: model.modelId,
    runtimeId: model.runtimeId,
  };
}

function installedRecord(model: ReturnType<typeof translationModel>) {
  return {
    familyId: model.familyId,
    modelId: model.modelId,
    runtimeId: model.runtimeId,
  };
}

function latestDropdownValue(settingName: string): string | undefined {
  return Setting.instances.filter((setting) => setting.name === settingName).at(-1)
    ?.dropdownComponents[0]?.selectEl.value;
}

function latestDropdownLabel(settingName: string): string | undefined {
  return Setting.instances.filter((setting) => setting.name === settingName).at(-1)
    ?.dropdownComponents[0]?.fittedLabel;
}
