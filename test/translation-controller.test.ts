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
      feedback: { show },
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      logger: { error: vi.fn() } as never,
      modelManager: {} as never,
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
      feedback: { show: vi.fn() },
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      logger: { error: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: { models: [] },
          installedModels: [],
        }),
      } as never,
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
      } as never,
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
});
