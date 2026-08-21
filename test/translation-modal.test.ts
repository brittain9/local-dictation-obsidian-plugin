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
  it('keeps the preview read-only until a translation succeeds', async () => {
    Setting.reset();
    let resolveTranslation:
      | ((result: { kind: 'translated'; sourceUnitsKept: number; text: string }) => void)
      | undefined;
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      runTranslation: () =>
        new Promise((resolve) => {
          resolveTranslation = resolve;
        }),
    });

    modal.open();
    const output = (modal.contentEl as unknown as TestElement).querySelector('textarea');
    expect(output?.attributes.has('readonly')).toBe(true);

    resolveTranslation?.({
      kind: 'translated',
      sourceUnitsKept: 0,
      text: 'Traduzca esto.',
    });
    await vi.waitFor(() => {
      expect(output?.attributes.has('readonly')).toBe(false);
    });
  });

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
    const output = (modal.contentEl as unknown as TestElement).querySelector('textarea');
    expect(output?.attributes.has('readonly')).toBe(true);
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('relocks and clears the preview while translating again', async () => {
    Setting.reset();
    let attempt = 0;
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      runTranslation: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.resolve({
              kind: 'translated' as const,
              sourceUnitsKept: 0,
              text: 'Traduzca esto.',
            })
          : new Promise(() => {});
      },
    });

    modal.open();
    await vi.waitFor(() => {
      expect(Setting.buttonNamed('Replace').disabled).toBe(false);
    });
    const output = (modal.contentEl as unknown as TestElement).querySelector('textarea');
    expect(output?.attributes.has('readonly')).toBe(false);

    await Setting.buttonNamed('Translate again').click();

    expect(output?.attributes.has('readonly')).toBe(true);
    expect((output as unknown as HTMLTextAreaElement).value).toBe('');
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
    await Setting.buttonNamed('Replace').click();
    await Setting.buttonNamed('Insert below').click();
    expect(replaceRange).not.toHaveBeenCalled();
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
  runTranslation,
}: {
  editor: {
    getValue: () => string;
    replaceRange: ReturnType<typeof vi.fn>;
  };
  runTranslation: ConstructorParameters<typeof TranslationModal>[1]['runTranslation'];
}): TranslationModal {
  return new TranslationModal({} as never, {
    editor: editor as never,
    feedback: { show: vi.fn() },
    initialSourceLanguage: 'en',
    initialTargetLanguage: 'es',
    onClosed: vi.fn(),
    onInstallModel: vi.fn(async () => {}),
    persistLanguages: vi.fn(async () => {}),
    runTranslation,
    snapshot: SNAPSHOT,
  });
}
