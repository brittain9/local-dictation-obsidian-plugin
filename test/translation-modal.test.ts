import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

import { TranslationCancelledError } from '../src/translation/bergamot-client';
import { TranslationModal, type TranslationSnapshot } from '../src/translation/translation-modal';
import { Setting, type TestElement } from './__mocks__/obsidian';

const SNAPSHOT: TranslationSnapshot = {
  from: { line: 0, ch: 0 },
  kind: 'note',
  source: 'Translate this.',
  to: { line: 0, ch: 15 },
};

describe('TranslationModal mutation safety', () => {
  it('does not write partial output when translation is canceled', async () => {
    Setting.reset();
    const replaceRange = vi.fn();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange,
      },
      runTranslation: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new TranslationCancelledError()), {
            once: true,
          });
        }),
    });

    modal.open();
    await Setting.buttonNamed('Cancel').click();
    await vi.waitFor(() => {
      expect(
        (modal.contentEl as unknown as TestElement).findByText('Translation canceled.'),
      ).toBeDefined();
    });
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('disables both note-writing actions when the source changed during translation', async () => {
    Setting.reset();
    const replaceRange = vi.fn();
    const modal = createModal({
      editor: {
        getValue: () => 'The note changed.',
        replaceRange,
      },
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => {
      expect(Setting.buttonNamed('Replace').disabled).toBe(true);
    });
    expect(Setting.buttonNamed('Insert below').disabled).toBe(true);
    expect(Setting.buttonNamed('Create note').disabled).toBe(false);
    await Setting.buttonNamed('Replace').click();
    await Setting.buttonNamed('Insert below').click();
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('creates a sibling note only after preview succeeds, using the final target language', async () => {
    Setting.reset();
    const onCreateNote = vi.fn(async () => true);
    const onClosed = vi.fn();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      onClosed,
      onCreateNote,
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => {
      expect(Setting.buttonNamed('Create note')).toBeDefined();
    });
    await Setting.buttonNamed('Create note').click();

    expect(onCreateNote).toHaveBeenCalledExactlyOnceWith('Traduzca esto.', 'es');
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('keeps the preview available when note creation fails', async () => {
    Setting.reset();
    const show = vi.fn();
    const onClosed = vi.fn();
    const error = new Error('Vault is read-only');
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      feedback: { show },
      onClosed,
      onCreateNote: vi.fn(async () => {
        throw error;
      }),
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => {
      expect(Setting.buttonNamed('Create note')).toBeDefined();
    });
    await Setting.buttonNamed('Create note').click();

    expect(Setting.buttonNamed('Create note').disabled).toBe(false);
    expect(onClosed).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith({
      cause: error,
      intent: 'error',
      key: 'translation-note-created',
      message: 'Could not create the translated note.',
    });
  });

  it('reports how many blocks kept their original language', async () => {
    Setting.reset();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 2,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => {
      expect(
        (modal.contentEl as unknown as TestElement).findByText(
          'Translation ready. 2 blocks kept their original language because their formatting could not be preserved.',
        ),
      ).toBeDefined();
    });
  });

  it('applies edits made in the translation preview', async () => {
    Setting.reset();
    const replaceRange = vi.fn();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange,
      },
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => {
      expect(Setting.buttonNamed('Replace').disabled).toBe(false);
    });
    const output = (modal.contentEl as unknown as TestElement).querySelector('textarea');
    expect(output).not.toBeNull();
    const editableOutput = output as unknown as HTMLTextAreaElement;
    editableOutput.value = 'Traduzca este texto.';
    output?.dispatchEvent({ type: 'input' });

    await Setting.buttonNamed('Replace').click();

    expect(replaceRange).toHaveBeenCalledWith('Traduzca este texto.', SNAPSHOT.from, SNAPSHOT.to);
  });
});

function createModal({
  editor,
  feedback = { show: vi.fn() },
  onClosed = vi.fn(),
  onCreateNote = vi.fn(async () => true),
  runTranslation,
}: {
  editor: {
    getValue: () => string;
    replaceRange: ReturnType<typeof vi.fn>;
  };
  feedback?: ConstructorParameters<typeof TranslationModal>[1]['feedback'];
  onClosed?: () => void;
  onCreateNote?: ConstructorParameters<typeof TranslationModal>[1]['onCreateNote'];
  runTranslation: ConstructorParameters<typeof TranslationModal>[1]['runTranslation'];
}): TranslationModal {
  return new TranslationModal({} as never, {
    editor: editor as never,
    feedback,
    initialSourceLanguage: 'en',
    initialTargetLanguage: 'es',
    onClosed,
    onCreateNote,
    onInstallModel: vi.fn(async () => {}),
    persistLanguages: vi.fn(async () => {}),
    runTranslation,
    snapshot: SNAPSHOT,
  });
}
