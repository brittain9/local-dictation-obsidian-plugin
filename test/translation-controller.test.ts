import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
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
          // Cataloged but not installed: the pair is offerable, so the modal
          // opens and routes the user to the download.
          catalog: {
            models: [
              {
                familyId: 'firefox_translations',
                modelId: 'firefox_translations_release_2026_07',
                runtimeId: 'bergamot_wasm',
                task: 'translation',
                translationPairs: [
                  { source: 'en', target: 'es' },
                  { source: 'es', target: 'en' },
                ],
              },
            ],
          },
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
});
