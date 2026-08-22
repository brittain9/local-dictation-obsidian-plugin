import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

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
      modelManager: {
        getState: () => ({ catalog: { models: [] }, installedModels: [] }),
        subscribe: () => () => {},
      } as never,
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
        subscribe: () => () => {},
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

  it('uses installed Natural translation when the saved Fast model is not installed', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const startTranslation = vi.fn(async () => {});
    const saveSettings = vi.fn(async () => {});
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
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
                translationSupport: { kind: 'all_to_all', languages: ['en', 'es'] },
              },
            ],
          },
          installedModels: [
            { familyId: 'tencent_hy_mt', modelId: 'hy-mt', runtimeId: 'llama_cpp' },
          ],
        }),
        subscribe: () => () => {},
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings,
      sidecarConnection: {
        cancelTranslation: vi.fn(),
        startTranslation,
        subscribe: () => () => {},
      } as never,
    });
    const editor = { getValue: () => 'Translate this note.', replaceRange: vi.fn() };

    controller.translateNote(editor as never);

    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(1));
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ translationEngineId: 'tencent_hy_mt' }),
    );
    expect(
      Setting.instances
        .flatMap((setting) => setting.buttonComponents)
        .some((button) => button.text === 'Install translation model'),
    ).toBe(false);
  });

  it('re-resolves the default after installing a different translation model', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const startTranslation = vi.fn(async () => {});
    const tencentModel = {
      familyId: 'tencent_hy_mt',
      modelId: 'hy-mt',
      runtimeId: 'llama_cpp',
      task: 'translation',
      translationSupport: { kind: 'all_to_all', languages: ['en', 'es'] },
    };
    const firefoxModel = {
      familyId: 'firefox_translations',
      modelId: 'firefox',
      runtimeId: 'bergamot_wasm',
      task: 'translation',
      translationSupport: { kind: 'pairs', pairs: [{ source: 'en', target: 'es' }] },
    };
    let installedModels: object[] = [];
    const controller = new TranslationController({
      app: {} as never,
      canReadAloud: () => false,
      feedback: { show: vi.fn() },
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [firefoxModel, tencentModel] },
          installedModels,
        }),
        subscribe: () => () => {},
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {
        installedModels = [{ familyId: 'tencent_hy_mt', modelId: 'hy-mt', runtimeId: 'llama_cpp' }];
      }),
      saveSettings: vi.fn(async () => {}),
      sidecarConnection: {
        cancelTranslation: vi.fn(),
        startTranslation,
        subscribe: () => () => {},
      } as never,
    });
    const editor = { getValue: () => 'Translate this note.', replaceRange: vi.fn() };

    controller.translateNote(editor as never);
    await vi.waitFor(() => expect(Setting.buttonNamed('Install translation model')).toBeDefined());
    await Setting.buttonNamed('Install translation model').click();

    await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(1));
  });

  it('persists an installed fallback after the preferred model is removed', async () => {
    let notifyModels = () => {};
    let installedModels: object[] = [
      { familyId: 'tencent_hy_mt', modelId: 'hy-mt', runtimeId: 'llama_cpp' },
      { familyId: 'firefox_translations', modelId: 'firefox', runtimeId: 'bergamot_wasm' },
    ];
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      translationEngineId: 'tencent_hy_mt' as const,
    };
    const saveSettings = vi.fn(async () => {});
    new TranslationController({
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
                familyId: 'firefox_translations',
                modelId: 'firefox',
                runtimeId: 'bergamot_wasm',
                task: 'translation',
                translationSupport: { kind: 'pairs', pairs: [{ source: 'en', target: 'es' }] },
              },
              {
                familyId: 'tencent_hy_mt',
                modelId: 'hy-mt',
                runtimeId: 'llama_cpp',
                task: 'translation',
                translationSupport: { kind: 'all_to_all', languages: ['en', 'es'] },
              },
            ],
          },
          installedModels,
        }),
        subscribe: (listener: () => void) => {
          notifyModels = listener;
          return () => {};
        },
      } as never,
      onReadAloud: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      saveSettings,
    });

    installedModels = [
      { familyId: 'firefox_translations', modelId: 'firefox', runtimeId: 'bergamot_wasm' },
    ];
    notifyModels();

    await vi.waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ translationEngineId: 'bergamot' }),
      );
    });
  });

  it('detaches a long Natural job, reopens it without duplicate inference, and keeps progress current', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const listeners: ((event: SidecarEvent) => void)[] = [];
    let translationId = '';
    const startTranslation = vi.fn(async (payload: { translationId: string }) => {
      translationId = payload.translationId;
    });
    const cancelTranslation = vi.fn();
    const setDetachedStatus = vi.fn();
    const settings = { ...DEFAULT_PLUGIN_SETTINGS, translationEngineId: 'tencent_hy_mt' as const };
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
          installedModels: [
            { familyId: 'tencent_hy_mt', modelId: 'hy-mt', runtimeId: 'llama_cpp' },
          ],
        }),
        subscribe: () => () => {},
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
    const editor = { getValue: () => 'Translate this note.', replaceRange: vi.fn() };

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
    listeners[0]?.({ type: 'translation_progress', translationId, completed: 1, total: 1 });
    listeners[0]?.({
      type: 'translation_complete',
      translationId,
      translations: ['Traduzca esta nota.'],
    });
    await vi.waitFor(() => expect(Setting.buttonNamed('Replace')).toBeDefined());
  });

  it('starts a fresh Natural translation from the current note after it changed', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const listeners: ((event: SidecarEvent) => void)[] = [];
    const startTranslation = vi.fn(
      async (_payload: { texts: string[]; translationId: string }) => {},
    );
    const settings = { ...DEFAULT_PLUGIN_SETTINGS, translationEngineId: 'tencent_hy_mt' as const };
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
                translationSupport: { kind: 'all_to_all', languages: ['en', 'es'] },
              },
            ],
          },
          installedModels: [
            { familyId: 'tencent_hy_mt', modelId: 'hy-mt', runtimeId: 'llama_cpp' },
          ],
        }),
        subscribe: () => () => {},
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
});
