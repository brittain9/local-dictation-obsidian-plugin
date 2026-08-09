import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

vi.mock('../src/translation/bergamot-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/translation/bergamot-client')>()),
  translateWithBergamot: vi.fn(async () => ['Traduzca esta nota.']),
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
      app: { workspace: { activeEditor: null } } as never,
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
      app: { workspace: { activeEditor: null } } as never,
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
      app: { workspace: { activeEditor: null } } as never,
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
      app: { workspace: { activeEditor: null } } as never,
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

  it('creates and opens a sibling at the source file location at click time', async () => {
    Modal.instances.length = 0;
    Setting.reset();
    const show = vi.fn();
    const editor = {
      getValue: () => 'Translate this note.',
      replaceRange: vi.fn(),
    };
    const sourceFile = {
      basename: 'Meeting notes',
      parent: { isRoot: () => false, path: 'Work' },
      path: 'Work/Meeting notes.md',
    };
    const createdFile = {
      basename: 'Meeting notes final (Español)',
      path: 'Work/Archive/Meeting notes final (Español).md',
    };
    const create = vi.fn(async () => createdFile);
    const openFile = vi.fn(async () => {});
    const controller = new TranslationController({
      app: {
        vault: {
          create,
          getAbstractFileByPath: (path: string) => (path === sourceFile.path ? sourceFile : null),
          getAllLoadedFiles: () => [],
        },
        workspace: {
          activeEditor: { editor, file: sourceFile },
          getLeaf: () => ({ openFile }),
        },
      } as never,
      feedback: { show },
      getSettings: () => DEFAULT_PLUGIN_SETTINGS,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      modelManager: {
        getState: () => ({
          catalog: {
            models: [
              {
                familyId: 'firefox-translations',
                modelId: 'en-es',
                runtimeId: 'bergamot',
                task: 'translation',
                translationPairs: [{ source: 'en', target: 'es' }],
              },
            ],
          },
          installedModels: [
            {
              familyId: 'firefox-translations',
              modelId: 'en-es',
              runtimeId: 'bergamot',
            },
          ],
        }),
      } as never,
      openModelPicker: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
    });
    controller.translateNote(editor as never);
    await vi.waitFor(() => {
      expect(Setting.buttonNamed('Create note')).toBeDefined();
    });
    const activeModal = Modal.instances[0];
    if (activeModal === undefined) throw new Error('Expected an open translation modal');
    const output = (activeModal.contentEl as unknown as TestElement).querySelector('textarea');
    const editableOutput = output as unknown as HTMLTextAreaElement;
    editableOutput.value = 'Traduzca esta nota revisada.';
    output?.dispatchEvent({ type: 'input' });
    sourceFile.basename = 'Meeting notes final';
    sourceFile.parent = { isRoot: () => false, path: 'Work/Archive' };
    sourceFile.path = 'Work/Archive/Meeting notes final.md';
    await Setting.buttonNamed('Create note').click();

    expect(create).toHaveBeenCalledExactlyOnceWith(
      'Work/Archive/Meeting notes final (Español).md',
      'Traduzca esta nota revisada.',
    );
    expect(openFile).toHaveBeenCalledExactlyOnceWith(createdFile);
    expect(show).toHaveBeenCalledWith({
      intent: 'success',
      key: 'translation-note-created',
      message: 'Created and opened Meeting notes final (Español).',
    });
  });
});
