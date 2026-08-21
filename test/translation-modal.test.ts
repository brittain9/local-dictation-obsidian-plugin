import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

import { TranslationCancelledError } from '../src/translation/bergamot-client';
import { HyMtTranslationError } from '../src/translation/hy-mt-client';
import {
  TranslationJob,
  type TranslationJobResult,
  type TranslationJobRunOptions,
} from '../src/translation/translation-job';
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

  it('shows an actionable Natural translation failure', async () => {
    Setting.reset();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      runTranslation: vi.fn(async () => {
        throw new HyMtTranslationError('translation_busy', 'raw sidecar message');
      }),
    });

    modal.open();

    await vi.waitFor(() => {
      expect(
        (modal.contentEl as unknown as TestElement).findByText(
          'Another Natural translation is already running.',
        ),
      ).toBeDefined();
    });
  });

  it('shows a dedicated in-progress panel instead of an empty preview while translating', () => {
    Setting.reset();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      runTranslation: () => new Promise(() => {}),
    });

    modal.open();

    const content = modal.contentEl as unknown as TestElement;
    expect(
      content
        .querySelector('.local-stt-translation-modal__status')
        ?.classList.contains('is-active'),
    ).toBe(true);
    expect(content.querySelector('.local-stt-translation-modal__spinner')).not.toBeNull();
    expect(
      content
        .querySelector('.local-stt-translation-modal__output-surface')
        ?.classList.contains('is-hidden'),
    ).toBe(true);
    modal.close();
  });

  it('does not write partial output when translation is canceled', async () => {
    Setting.reset();
    const replaceRange = vi.fn();
    const onRestart = vi.fn();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange,
      },
      onRestart,
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
    await Setting.buttonNamed('Translate again').click();
    expect(onRestart).toHaveBeenCalledExactlyOnceWith('bergamot', 'en', 'es');
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('offers a new translation when the source changed during translation', async () => {
    Setting.reset();
    const replaceRange = vi.fn();
    const onTranslateCurrent = vi.fn();
    const modal = createModal({
      editor: {
        getValue: () => 'The note changed.',
        replaceRange,
      },
      onTranslateCurrent,
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => {
      expect(Setting.buttonNamed('Translate again')).toBeDefined();
    });
    await Setting.buttonNamed('Translate again').click();
    expect(onTranslateCurrent).toHaveBeenCalledOnce();
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('reports partial results but never writes them into the note', async () => {
    Setting.reset();
    const replaceRange = vi.fn();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange,
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
    expect(Setting.buttonNamed('Replace').disabled).toBe(true);
    expect(Setting.buttonNamed('Insert below').disabled).toBe(true);
    await Setting.buttonNamed('Replace').click();
    await Setting.buttonNamed('Insert below').click();
    expect(replaceRange).not.toHaveBeenCalled();
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
  onRestart = vi.fn(),
  onTranslateCurrent = vi.fn(),
  runTranslation,
}: {
  editor: {
    getValue: () => string;
    replaceRange: ReturnType<typeof vi.fn>;
  };
  onRestart?: ConstructorParameters<typeof TranslationModal>[1]['onRestart'];
  onTranslateCurrent?: () => void;
  runTranslation: (options: TranslationJobRunOptions) => Promise<TranslationJobResult>;
}): TranslationModal {
  const job = new TranslationJob({
    engineId: 'bergamot',
    run: runTranslation,
    sourceLanguage: 'en',
    targetLanguage: 'es',
  });
  return new TranslationModal({} as never, {
    editor: editor as never,
    feedback: { show: vi.fn() },
    job,
    onApplied: vi.fn(),
    onClosed: vi.fn(),
    onDismissed: vi.fn(),
    onInstallModel: vi.fn(async () => {}),
    onTranslateCurrent,
    onRestart,
    snapshot: SNAPSHOT,
  });
}
