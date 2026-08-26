import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:bergamot-worker-source', () => ({
  BERGAMOT_WORKER_SOURCE: '',
}));

import type { CatalogModelRecord } from '../src/models/model-management-types';
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
  it('keeps the read-aloud action hidden while translation is in progress', () => {
    Setting.reset();
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      runTranslation: () => new Promise(() => {}),
    });

    modal.open();

    expect(
      (modal.contentEl as unknown as TestElement).querySelector(
        '.local-stt-translation-modal__read-aloud',
      ),
    ).toBeNull();
    modal.close();
  });

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

  it('offers read aloud for a completed compatible translation', async () => {
    Setting.reset();
    const canReadAloud = vi.fn(() => true);
    const onReadAloud = vi.fn();
    const modal = createModal({
      canReadAloud,
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      onReadAloud,
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => {
      expect(
        (modal.contentEl as unknown as TestElement).querySelector(
          '.local-stt-translation-modal__read-aloud',
        ),
      ).not.toBeNull();
    });

    const button = (modal.contentEl as unknown as TestElement).querySelector(
      '.local-stt-translation-modal__read-aloud',
    );
    expect(button?.getAttribute('aria-label')).toBe('Read translation aloud in Español');
    expect(button?.innerHTML).toContain('data-icon="volume-2"');
    expect(canReadAloud).toHaveBeenLastCalledWith('Traduzca esto.', 'es');

    await button?.click();
    expect(onReadAloud).toHaveBeenCalledExactlyOnceWith('Traduzca esto.', 'es');
  });

  it('reads the edited preview and hides the action when it becomes empty', async () => {
    Setting.reset();
    const canReadAloud = vi.fn((text: string) => text.trim().length > 0);
    const onReadAloud = vi.fn();
    const modal = createModal({
      canReadAloud,
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      onReadAloud,
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => {
      expect(
        (modal.contentEl as unknown as TestElement).querySelector(
          '.local-stt-translation-modal__read-aloud',
        ),
      ).not.toBeNull();
    });
    const output = (modal.contentEl as unknown as TestElement).querySelector('textarea');
    if (output === null) throw new Error('Expected editable translation output.');

    (output as unknown as HTMLTextAreaElement).value = 'Texto editado.';
    output.dispatchEvent({ type: 'input' });
    expect(canReadAloud).toHaveBeenLastCalledWith('Texto editado.', 'es');
    await (
      (modal.contentEl as unknown as TestElement).querySelector(
        '.local-stt-translation-modal__read-aloud',
      ) as TestElement
    ).click();
    expect(onReadAloud).toHaveBeenLastCalledWith('Texto editado.', 'es');

    (output as unknown as HTMLTextAreaElement).value = '   ';
    output.dispatchEvent({ type: 'input' });
    expect(
      (modal.contentEl as unknown as TestElement).querySelector(
        '.local-stt-translation-modal__read-aloud',
      ),
    ).toBeNull();
  });

  it('hides read aloud for partial translations but keeps it for stale sources', async () => {
    Setting.reset();
    const canReadAloud = vi.fn(() => true);
    const partial = createModal({
      canReadAloud,
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 1,
        text: 'Traduzca esto.',
      })),
    });
    partial.open();
    await vi.waitFor(() => expect(Setting.buttonNamed('Replace')).toBeDefined());
    expect(
      (partial.contentEl as unknown as TestElement).querySelector(
        '.local-stt-translation-modal__read-aloud',
      ),
    ).toBeNull();
    partial.close();

    Setting.reset();
    const stale = createModal({
      canReadAloud,
      editor: {
        getValue: () => 'The note changed.',
        replaceRange: vi.fn(),
      },
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });
    stale.open();
    await vi.waitFor(() => {
      expect(
        (stale.contentEl as unknown as TestElement).querySelector(
          '.local-stt-translation-modal__read-aloud',
        ),
      ).not.toBeNull();
    });
  });

  it('shows an actionable translation failure', async () => {
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
          'Another translation is already running.',
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
    expect(onRestart).toHaveBeenCalledExactlyOnceWith('en', 'es');
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

  it('does not translate automatically when the language pair changes', async () => {
    Setting.reset();
    const runTranslation = vi.fn(async () => ({
      kind: 'translated' as const,
      sourceUnitsKept: 0,
      text: 'Traduzca esto.',
    }));
    const onRestart = vi.fn();
    const onLanguageChange = vi.fn(async () => {});
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      runTranslation,
      onRestart,
      onLanguageChange,
    });

    modal.open();
    await vi.waitFor(() => expect(Setting.buttonNamed('Replace').disabled).toBe(false));

    const sourceSetting = Setting.instances.filter((setting) => setting.name === 'From').at(-1);
    sourceSetting?.dropdownComponents[0]?.change('es');
    await vi.waitFor(() => expect(onLanguageChange).toHaveBeenCalledWith('es', 'en'));

    expect(runTranslation).toHaveBeenCalledOnce();
    expect(onRestart).not.toHaveBeenCalled();
    expect(Setting.buttonNamed('Translate again')).toBeDefined();
    const latestActions = Setting.instances
      .filter((setting) => setting.buttonComponents.length > 0)
      .at(-1);
    expect(latestActions?.buttonComponents.some((button) => button.text === 'Replace')).toBe(false);
  });

  it('switches models through the shared selection callback without starting inference', async () => {
    Setting.reset();
    const secondModel = {
      ...createModalModel(),
      displayName: 'HY-MT 2',
      familyId: 'tencent_hy_mt' as const,
      modelId: 'hy-mt-2',
      runtimeId: 'llama_cpp' as const,
    } as CatalogModelRecord;
    const runTranslation = vi.fn(async () => ({
      kind: 'translated' as const,
      sourceUnitsKept: 0,
      text: 'Traduzca esto.',
    }));
    const onModelChange = vi.fn(async () => {});
    const modal = createModal({
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      modelOptions: [secondModel],
      onModelChange,
      runTranslation,
    });

    modal.open();
    await vi.waitFor(() => expect(Setting.buttonNamed('Replace').disabled).toBe(false));

    const modelSetting = Setting.instances
      .filter((setting) => setting.name === 'Translation model')
      .at(-1);
    const secondModelOption = modelSetting?.dropdownComponents[0]?.selectEl.options.find(
      (option) => option.label === 'HY-MT 2',
    );
    if (secondModelOption === undefined) throw new Error('Expected HY-MT 2 model option.');
    modelSetting?.dropdownComponents[0]?.change(secondModelOption.value);
    await vi.waitFor(() => expect(onModelChange).toHaveBeenCalledWith(secondModel, 'en', 'es'));

    expect(runTranslation).toHaveBeenCalledOnce();
    expect(Setting.buttonNamed('Translate again')).toBeDefined();
  });

  it('offers an explicit retry after selecting an installed model for a missing-model job', async () => {
    Setting.reset();
    const installedModel = createModalModel();
    const runTranslation = vi.fn(async () => ({ kind: 'missing_model' as const }));
    const onModelChange = vi.fn(async () => {});
    const onTranslateCurrent = vi.fn();
    const modal = createModal({
      configuration: { model: null, sourceLanguage: 'en', targetLanguage: 'es' },
      editor: {
        getValue: () => SNAPSHOT.source,
        replaceRange: vi.fn(),
      },
      jobModel: null,
      modelOptions: [installedModel],
      onModelChange,
      onTranslateCurrent,
      runTranslation,
    });

    modal.open();
    await vi.waitFor(() => expect(Setting.buttonNamed('Install translation model')).toBeDefined());

    const modelSetting = Setting.instances
      .filter((setting) => setting.name === 'Translation model')
      .at(-1);
    const installedOption = modelSetting?.dropdownComponents[0]?.selectEl.options[0];
    if (installedOption === undefined) throw new Error('Expected installed translation model.');
    modelSetting?.dropdownComponents[0]?.change(installedOption.value);

    await vi.waitFor(() => expect(onModelChange).toHaveBeenCalledOnce());
    expect(runTranslation).toHaveBeenCalledOnce();
    expect(Setting.buttonNamed('Translate again')).toBeDefined();
    expect(
      (modal.contentEl as unknown as TestElement).findByText(
        'Translation setup changed. Select Translate again to update the preview.',
      ),
    ).toBeDefined();

    await Setting.buttonNamed('Translate again').click();
    expect(onTranslateCurrent).toHaveBeenCalledWith('en', 'es');
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

  it('surfaces a stale result if the note changes after actions render', async () => {
    Setting.reset();
    let source = SNAPSHOT.source;
    const replaceRange = vi.fn();
    const modal = createModal({
      editor: {
        getValue: () => source,
        replaceRange,
      },
      runTranslation: vi.fn(async () => ({
        kind: 'translated' as const,
        sourceUnitsKept: 0,
        text: 'Traduzca esto.',
      })),
    });

    modal.open();
    await vi.waitFor(() => expect(Setting.buttonNamed('Replace').disabled).toBe(false));
    source = 'The note changed after completion.';
    await Setting.buttonNamed('Replace').click();

    expect(replaceRange).not.toHaveBeenCalled();
    expect(
      (modal.contentEl as unknown as TestElement).findByText(
        'The note changed since this translation started. Start a new translation or copy this one.',
      ),
    ).toBeDefined();
  });
});

function createModal({
  canReadAloud = () => false,
  configuration,
  editor,
  jobModel = createModalModel(),
  modelOptions = [],
  onManageModels = vi.fn(async () => {}),
  onModelChange = vi.fn(async () => {}),
  onLanguageChange = vi.fn(async () => {}),
  onReadAloud = vi.fn(),
  onRestart = vi.fn(),
  onTranslateCurrent = vi.fn(),
  runTranslation,
}: {
  canReadAloud?: ConstructorParameters<typeof TranslationModal>[1]['canReadAloud'];
  configuration?: ConstructorParameters<typeof TranslationModal>[1]['configuration'];
  editor: {
    getValue: () => string;
    replaceRange: ReturnType<typeof vi.fn>;
  };
  jobModel?: CatalogModelRecord | null;
  modelOptions?: ConstructorParameters<typeof TranslationModal>[1]['modelOptions'];
  onManageModels?: ConstructorParameters<typeof TranslationModal>[1]['onManageModels'];
  onLanguageChange?: ConstructorParameters<typeof TranslationModal>[1]['onLanguageChange'];
  onModelChange?: ConstructorParameters<typeof TranslationModal>[1]['onModelChange'];
  onReadAloud?: ConstructorParameters<typeof TranslationModal>[1]['onReadAloud'];
  onRestart?: ConstructorParameters<typeof TranslationModal>[1]['onRestart'];
  onTranslateCurrent?: ConstructorParameters<typeof TranslationModal>[1]['onTranslateCurrent'];
  runTranslation: (options: TranslationJobRunOptions) => Promise<TranslationJobResult>;
}): TranslationModal {
  const job = new TranslationJob({
    model: jobModel,
    run: runTranslation,
    sourceLanguage: 'en',
    targetLanguage: 'es',
  });
  return new TranslationModal({} as never, {
    canReadAloud,
    configuration: configuration ?? {
      model: jobModel,
      sourceLanguage: 'en',
      targetLanguage: 'es',
    },
    editor: editor as never,
    feedback: { show: vi.fn() },
    job,
    modelOptions,
    onApplied: vi.fn(),
    onClosed: vi.fn(),
    onDismissed: vi.fn(),
    onLanguageChange,
    onManageModels,
    onModelChange,
    onReadAloud,
    onTranslateCurrent,
    onRestart,
    snapshot: SNAPSHOT,
  });
}

function createModalModel(): CatalogModelRecord {
  return {
    artifacts: [],
    collectionId: 'translation',
    displayName: 'Firefox Translations',
    familyId: 'firefox_translations',
    languageTags: ['en', 'es'],
    licenseLabel: 'MPL-2.0',
    licenseUrl: 'https://www.mozilla.org/MPL/2.0/',
    modelCardUrl: null,
    modelId: 'firefox',
    notes: [],
    runtimeId: 'bergamot_wasm',
    sourceUrl: 'https://example.com',
    summary: 'Local translation',
    supportsAutomaticLanguageDetection: false,
    task: 'translation',
    translationSupport: { kind: 'all_to_all', languages: ['en', 'es'] },
    uxTags: [],
  };
}
