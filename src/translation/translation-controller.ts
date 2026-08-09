import type { App, Editor, EditorPosition, TFile } from 'obsidian';

import type { ModelInstallManager } from '../models/model-install-manager';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import { TranslationCancelledError, translateWithBergamot } from './bergamot-client';
import {
  findInstalledTranslationModel,
  type InstalledTranslationModel,
  resolveTranslationLanguages,
  type TranslationLanguage,
  translationLanguageLabel,
} from './languages';
import {
  protectedMarkerModeForLanguages,
  rebuildTranslatedMarkdown,
  segmentMarkdownForTranslation,
  translatableTexts,
} from './markdown-segmentation';
import { TranslationModal, type TranslationSnapshot } from './translation-modal';
import { createTranslationSiblingNote, type TranslationSourceNote } from './translation-note';

const MAX_TRANSLATION_CHARACTERS = 50_000;

export interface TranslationRunOptions {
  onProgress: (completed: number, total: number) => void;
  onReady: () => void;
  signal: AbortSignal;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
}

export type TranslationRunResult =
  | { kind: 'missing_model' }
  | { kind: 'translated'; sourceUnitsKept: number; text: string };

interface TranslationControllerDependencies {
  app: App;
  feedback: Pick<UserFeedback, 'show'>;
  getSettings: () => PluginSettings;
  logger: PluginLogger;
  modelManager: ModelInstallManager;
  openModelPicker: () => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

export class TranslationController {
  private activeModal: TranslationModal | null = null;

  constructor(private readonly dependencies: TranslationControllerDependencies) {}

  translateSelection(editor: Editor): void {
    if (!editor.somethingSelected()) return;
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    this.open(
      editor,
      {
        from,
        kind: 'selection',
        source: editor.getRange(from, to),
        to,
      },
      sourceFileForEditor(this.dependencies.app, editor),
    );
  }

  translateNote(editor: Editor): void {
    const source = editor.getValue();
    if (source.trim().length === 0) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'translation-no-text',
        message: t('translation.notice.noText'),
      });
      return;
    }
    this.open(
      editor,
      {
        from: { line: 0, ch: 0 },
        kind: 'note',
        source,
        to: endPosition(source),
      },
      sourceFileForEditor(this.dependencies.app, editor),
    );
  }

  translateCurrentParagraph(editor: Editor): void {
    const cursor = editor.getCursor('head');
    if (editor.getLine(cursor.line).trim().length === 0) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'translation-no-paragraph',
        message: t('translation.notice.noParagraph'),
      });
      return;
    }

    let startLine = cursor.line;
    while (startLine > 0 && editor.getLine(startLine - 1).trim().length > 0) {
      startLine -= 1;
    }
    let endLine = cursor.line;
    while (endLine + 1 < editor.lineCount() && editor.getLine(endLine + 1).trim().length > 0) {
      endLine += 1;
    }

    const from = { line: startLine, ch: 0 };
    const to = { line: endLine, ch: editor.getLine(endLine).length };
    this.open(
      editor,
      {
        from,
        kind: 'paragraph',
        source: editor.getRange(from, to),
        to,
      },
      sourceFileForEditor(this.dependencies.app, editor),
    );
  }

  dispose(): void {
    this.activeModal?.close();
    this.activeModal = null;
  }

  private open(editor: Editor, snapshot: TranslationSnapshot, sourceFile: TFile | null): void {
    if (snapshot.source.length > MAX_TRANSLATION_CHARACTERS) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'translation-too-long',
        message: t('translation.notice.tooLong', {
          count: MAX_TRANSLATION_CHARACTERS.toLocaleString(),
        }),
      });
      return;
    }

    this.activeModal?.close();
    const settings = this.dependencies.getSettings();
    const { sourceLanguage, targetLanguage } = resolveTranslationLanguages(
      settings.dictationLanguage,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
    );

    const modal = new TranslationModal(this.dependencies.app, {
      editor,
      feedback: this.dependencies.feedback,
      initialSourceLanguage: sourceLanguage,
      initialTargetLanguage: targetLanguage,
      onClosed: () => {
        if (this.activeModal === modal) this.activeModal = null;
      },
      onCreateNote:
        sourceFile === null
          ? null
          : (text, targetLanguage) => this.createNote(sourceFile, text, targetLanguage),
      // Closing the loop: once the pack is installed, come straight back to the
      // preview instead of making the user re-run the command.
      onInstallModel: async () => {
        const languages = modal.languages();
        modal.close();
        await this.dependencies.openModelPicker();
        if (this.findInstalledModel(languages.sourceLanguage, languages.targetLanguage) !== null) {
          this.open(editor, snapshot, sourceFile);
        }
      },
      persistLanguages: async (nextSource, nextTarget) => {
        const current = this.dependencies.getSettings();
        await this.dependencies.saveSettings({
          ...current,
          translationSourceLanguage: nextSource,
          translationTargetLanguage: nextTarget,
        });
      },
      runTranslation: (options) => this.runTranslation(snapshot.source, options),
      snapshot,
    });
    this.activeModal = modal;
    modal.open();
  }

  private async runTranslation(
    source: string,
    options: TranslationRunOptions,
  ): Promise<TranslationRunResult> {
    const installed = this.findInstalledModel(options.sourceLanguage, options.targetLanguage);
    if (installed === null) return { kind: 'missing_model' };

    const segments = segmentMarkdownForTranslation(source, {
      protectedMarkerMode: protectedMarkerModeForLanguages(
        options.sourceLanguage,
        options.targetLanguage,
      ),
    });
    const texts = translatableTexts(segments);
    if (texts.length === 0) return { kind: 'translated', sourceUnitsKept: 0, text: source };

    try {
      const translations = await translateWithBergamot({
        ...installed,
        onProgress: options.onProgress,
        onReady: options.onReady,
        signal: options.signal,
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
        texts,
      });
      const rebuilt = rebuildTranslatedMarkdown(segments, translations);
      if (rebuilt.sourceUnitsKept > 0) {
        this.dependencies.logger.warn(
          'translation',
          `kept ${rebuilt.sourceUnitsKept} unit(s) in the source language after marker loss`,
        );
      }
      return { kind: 'translated', ...rebuilt };
    } catch (error) {
      if (!(error instanceof TranslationCancelledError)) {
        this.dependencies.logger.error('translation', 'local translation failed', error);
      }
      throw error;
    }
  }

  private async createNote(
    sourceFile: TFile,
    text: string,
    targetLanguage: TranslationLanguage,
  ): Promise<boolean> {
    try {
      const sourceNote = currentSourceNote(this.dependencies.app, sourceFile);
      if (sourceNote === null) throw new Error('Translation source note is no longer in the vault');
      const result = await createTranslationSiblingNote(
        this.dependencies.app,
        sourceNote,
        translationLanguageLabel(targetLanguage),
        text,
      );
      if (result.openError !== undefined) {
        this.dependencies.feedback.show({
          cause: result.openError,
          intent: 'warning',
          key: 'translation-note-created',
          message: t('translation.notice.noteCreatedOpenFailed', {
            note: result.file.basename,
          }),
        });
      } else {
        this.dependencies.feedback.show({
          intent: 'success',
          key: 'translation-note-created',
          message: t('translation.notice.noteCreated', { note: result.file.basename }),
        });
      }
      return true;
    } catch (error) {
      this.dependencies.feedback.show({
        cause: error,
        intent: 'error',
        key: 'translation-note-created',
        message: t('translation.notice.noteCreateFailed'),
      });
      return false;
    }
  }

  private findInstalledModel(
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
  ): InstalledTranslationModel | null {
    const state = this.dependencies.modelManager.getState();
    return findInstalledTranslationModel(
      { models: state.catalog.models, installedModels: state.installedModels },
      sourceLanguage,
      targetLanguage,
    );
  }
}

function endPosition(text: string): EditorPosition {
  const lines = text.split('\n');
  return {
    line: lines.length - 1,
    ch: lines.at(-1)?.length ?? 0,
  };
}

function sourceFileForEditor(app: Pick<App, 'workspace'>, editor: Editor): TFile | null {
  const activeEditor = app.workspace.activeEditor;
  return activeEditor?.editor === editor ? activeEditor.file : null;
}

function currentSourceNote(
  app: Pick<App, 'vault'>,
  sourceFile: TFile,
): TranslationSourceNote | null {
  if (app.vault.getAbstractFileByPath(sourceFile.path) !== sourceFile) return null;
  return {
    basename: sourceFile.basename,
    parentPath:
      sourceFile.parent === null || sourceFile.parent.isRoot() ? '' : sourceFile.parent.path,
  };
}
