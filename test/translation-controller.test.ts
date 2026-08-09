import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { TranslationController } from '../src/translation/translation-controller';
import { Modal, Setting, type TestElement } from './__mocks__/obsidian';

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

  it('opens only the blank-line-delimited paragraph at the cursor', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const source = 'First paragraph.\n\nSecond paragraph\ncontinues here.\n\nThird paragraph.';
    const lines = source.split('\n');
    const controller = new TranslationController({
      app: {} as never,
      feedback: { show: vi.fn() },
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      logger: { error: vi.fn() } as never,
      modelManager: {
        getState: () => ({ catalog: { models: [] }, installedModels: [] }),
      } as never,
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
    });
    const editor = {
      getCursor: () => ({ line: 3, ch: 4 }),
      getLine: (line: number) => lines[line] ?? '',
      getRange: (from: { line: number; ch: number }, to: { line: number; ch: number }) =>
        lines
          .slice(from.line, to.line + 1)
          .join('\n')
          .slice(from.ch, undefined),
      lineCount: () => lines.length,
    };

    controller.translateCurrentParagraph(editor as never);

    await vi.waitFor(() => {
      const content = Modal.instances[0]?.contentEl as unknown as TestElement;
      expect(content.findByText('Source paragraph')).toBeDefined();
      expect(content.findByText('Second paragraph\ncontinues here.')).toBeDefined();
    });
  });

  it('explains that the cursor must be inside a paragraph', () => {
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
      getCursor: () => ({ line: 1, ch: 0 }),
      getLine: () => '  ',
    };

    controller.translateCurrentParagraph(editor as never);

    expect(show).toHaveBeenCalledExactlyOnceWith({
      intent: 'warning',
      key: 'translation-no-paragraph',
      message: 'Place the cursor in a paragraph to translate it.',
    });
  });
});
