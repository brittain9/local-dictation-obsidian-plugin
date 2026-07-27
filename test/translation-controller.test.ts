import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { TranslationController } from '../src/translation/translation-controller';

describe('TranslationController', () => {
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
});
