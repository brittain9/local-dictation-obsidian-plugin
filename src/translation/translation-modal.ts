import { type App, type Editor, type EditorPosition, Modal, Setting } from 'obsidian';

import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import { TranslationCancelledError } from './bergamot-client';
import {
  isTranslationLanguage,
  resolveTranslationTarget,
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
  translationLanguageLabel,
  translationTargetsFor,
} from './languages';
import { TranslationModelIncompleteError } from './translation-artifacts';

const LARGE_SOURCE_CHARACTERS = 10_000;

export interface TranslationSnapshot {
  from: EditorPosition;
  kind: 'note' | 'selection';
  source: string;
  to: EditorPosition;
}

interface TranslationModalDependencies {
  editor: Editor;
  feedback: Pick<UserFeedback, 'show'>;
  initialSourceLanguage: TranslationLanguage;
  initialTargetLanguage: TranslationLanguage;
  onClosed: () => void;
  onInstallModel: () => Promise<void>;
  persistLanguages: (
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
  ) => Promise<void>;
  runTranslation: (options: {
    onProgress: (completed: number, total: number) => void;
    onReady: () => void;
    signal: AbortSignal;
    sourceLanguage: TranslationLanguage;
    targetLanguage: TranslationLanguage;
  }) => Promise<
    { kind: 'missing_model' } | { kind: 'translated'; sourceUnitsKept: 0; text: string }
  >;
  snapshot: TranslationSnapshot;
}

export class TranslationModal extends Modal {
  private abortController: AbortController | null = null;
  private actionsEl: HTMLElement | null = null;
  private headingEl: HTMLElement | null = null;
  private languagesEl: HTMLElement | null = null;
  private missingModel = false;
  private output: string | null = null;
  private outputEl: HTMLTextAreaElement | null = null;
  private sourceLanguage: TranslationLanguage;
  private statusEl: HTMLElement | null = null;
  private targetLanguage: TranslationLanguage;

  constructor(
    app: App,
    private readonly dependencies: TranslationModalDependencies,
  ) {
    super(app);
    this.sourceLanguage = dependencies.initialSourceLanguage;
    this.targetLanguage = dependencies.initialTargetLanguage;
  }

  languages(): { sourceLanguage: TranslationLanguage; targetLanguage: TranslationLanguage } {
    return { sourceLanguage: this.sourceLanguage, targetLanguage: this.targetLanguage };
  }

  override onOpen(): void {
    this.modalEl.addClass('local-stt-translation-modal');
    this.renderShell();
    void this.translate();
  }

  override onClose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.contentEl.empty();
    this.dependencies.onClosed();
  }

  // The shell is built once so the source disclosure, the preview's scroll
  // position, and focus survive every status change.
  private renderShell(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.headingEl = contentEl.createEl('h2');
    contentEl.createEl('p', {
      cls: 'local-stt-translation-modal__privacy',
      text: t('translation.modal.privacy'),
    });
    this.languagesEl = contentEl.createDiv({ cls: 'local-stt-translation-modal__languages' });

    if (this.dependencies.snapshot.source.length > LARGE_SOURCE_CHARACTERS) {
      contentEl.createEl('p', {
        cls: 'local-stt-translation-modal__warning',
        text: t('translation.modal.largeNote'),
      });
    }

    const sourceDetails = contentEl.createEl('details');
    sourceDetails.createEl('summary', {
      text:
        this.dependencies.snapshot.kind === 'selection'
          ? t('translation.modal.sourceSelection')
          : t('translation.modal.sourceNote'),
    });
    sourceDetails.createEl('pre', {
      cls: 'local-stt-translation-modal__preview',
      text: this.dependencies.snapshot.source,
    });

    this.statusEl = contentEl.createDiv({
      attr: { 'aria-live': 'polite', role: 'status' },
      cls: 'local-stt-translation-modal__status',
      text: t('translation.modal.preparing'),
    });
    this.outputEl = contentEl.createEl('textarea', {
      attr: {
        'aria-label': t('translation.modal.previewAria'),
        readonly: '',
      },
      cls: 'local-stt-translation-modal__output',
    });
    this.actionsEl = contentEl.createDiv();

    this.renderHeading();
    this.renderLanguages();
  }

  private renderHeading(): void {
    if (this.headingEl === null) return;
    this.headingEl.textContent = t('translation.modal.titleWithPair', {
      source: translationLanguageLabel(this.sourceLanguage),
      target: translationLanguageLabel(this.targetLanguage),
    });
  }

  private renderLanguages(): void {
    const container = this.languagesEl;
    if (container === null) return;
    container.empty();

    new Setting(container).setName(t('translation.modal.from')).addDropdown((dropdown) => {
      for (const language of TRANSLATION_LANGUAGES) {
        dropdown.addOption(language, translationLanguageLabel(language));
      }
      dropdown.setValue(this.sourceLanguage);
      dropdown.onChange((value) => {
        if (!isTranslationLanguage(value)) return;
        this.changeLanguages(value, resolveTranslationTarget(value, this.targetLanguage));
      });
    });
    new Setting(container).setName(t('translation.modal.to')).addDropdown((dropdown) => {
      for (const language of translationTargetsFor(this.sourceLanguage)) {
        dropdown.addOption(language, translationLanguageLabel(language));
      }
      dropdown.setValue(this.targetLanguage);
      dropdown.onChange((value) => {
        if (!isTranslationLanguage(value)) return;
        if (!translationTargetsFor(this.sourceLanguage).includes(value)) return;
        this.changeLanguages(this.sourceLanguage, value);
      });
    });
    new Setting(container).addButton((button) => {
      button
        .setButtonText(t('translation.modal.swap'))
        .setIcon('arrow-left-right')
        .onClick(() => {
          this.changeLanguages(this.targetLanguage, this.sourceLanguage);
        });
    });
  }

  private renderActions(): void {
    const container = this.actionsEl;
    if (container === null) return;
    container.empty();

    const actions = new Setting(container).setClass('local-stt-translation-modal__actions');
    if (this.abortController !== null) {
      actions.addButton((button) => {
        button.setButtonText(t('translation.modal.cancel')).onClick(() => {
          this.cancelTranslation();
        });
      });
    } else {
      actions.addButton((button) => {
        button
          .setButtonText(t('translation.modal.translateAgain'))
          .setCta()
          .onClick(() => {
            void this.translate();
          });
      });
    }

    if (this.missingModel) {
      actions.addButton((button) => {
        button
          .setButtonText(t('translation.modal.installModel'))
          .setCta()
          .onClick(() => {
            void this.dependencies.onInstallModel();
          });
      });
      return;
    }

    if (this.output === null) return;

    // Both write into the note at the captured range, so both need that range
    // to still hold the text we translated.
    const sourceIsCurrent = this.sourceIsCurrent();
    actions.addButton((button) => {
      button
        .setButtonText(t('translation.modal.replace'))
        .setCta()
        .setDisabled(!sourceIsCurrent)
        .onClick(() => {
          this.replace();
        });
    });
    actions.addButton((button) => {
      button
        .setButtonText(t('translation.modal.insertBelow'))
        .setDisabled(!sourceIsCurrent)
        .onClick(() => {
          this.insertBelow();
        });
    });
    actions.addButton((button) => {
      button.setButtonText(t('translation.modal.copy')).onClick(() => {
        void this.copy();
      });
    });
    if (!sourceIsCurrent) this.setStatus(t('translation.modal.stale'));
  }

  private setStatus(status: string): void {
    if (this.statusEl !== null) this.statusEl.textContent = status;
  }

  private setOutput(output: string | null): void {
    this.output = output;
    if (this.outputEl !== null) this.outputEl.value = output ?? '';
  }

  private changeLanguages(
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
  ): void {
    if (sourceLanguage === this.sourceLanguage && targetLanguage === this.targetLanguage) return;
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
    void this.dependencies.persistLanguages(sourceLanguage, targetLanguage);
    this.renderHeading();
    this.renderLanguages();
    this.restart();
  }

  private restart(): void {
    this.abortController?.abort();
    this.abortController = null;
    void this.translate();
  }

  private cancelTranslation(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.setStatus(t('translation.modal.canceled'));
    this.renderActions();
  }

  private async translate(): Promise<void> {
    if (this.abortController !== null) return;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.missingModel = false;
    this.setOutput(null);
    this.setStatus(t('translation.modal.loading'));
    this.renderActions();
    try {
      const result = await this.dependencies.runTranslation({
        onProgress: (completed, total) => {
          if (this.isCurrent(abortController) && total > 1) {
            this.setStatus(t('translation.modal.translatingProgress', { completed, total }));
          }
        },
        onReady: () => {
          if (this.isCurrent(abortController)) this.setStatus(t('translation.modal.translating'));
        },
        signal: abortController.signal,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
      });
      if (!this.isCurrent(abortController)) return;
      this.abortController = null;
      if (result.kind === 'missing_model') {
        this.missingModel = true;
        this.setStatus(t('translation.modal.missingModel'));
        this.renderActions();
        return;
      }
      this.setOutput(result.text);
      this.setStatus(t('translation.modal.ready'));
      this.renderActions();
    } catch (error) {
      if (this.abortController !== abortController) return;
      this.abortController = null;
      this.setStatus(translationFailureMessage(error));
      this.renderActions();
    }
  }

  private isCurrent(abortController: AbortController): boolean {
    return this.abortController === abortController && !abortController.signal.aborted;
  }

  private sourceIsCurrent(): boolean {
    const { editor, snapshot } = this.dependencies;
    return snapshot.kind === 'note'
      ? editor.getValue() === snapshot.source
      : editor.getRange(snapshot.from, snapshot.to) === snapshot.source;
  }

  private async copy(): Promise<void> {
    if (this.output === null) return;
    try {
      await navigator.clipboard.writeText(this.output);
      this.dependencies.feedback.show({
        intent: 'success',
        key: 'translation-copied',
        message: t('translation.notice.copied'),
      });
    } catch (error) {
      this.dependencies.feedback.show({
        cause: error,
        intent: 'error',
        key: 'translation-copied',
        message: t('translation.notice.copyFailed'),
      });
    }
  }

  private replace(): void {
    if (this.output === null || !this.sourceIsCurrent()) {
      this.renderActions();
      return;
    }
    const { editor, snapshot } = this.dependencies;
    editor.replaceRange(this.output, snapshot.from, snapshot.to);
    this.close();
  }

  private insertBelow(): void {
    if (this.output === null || !this.sourceIsCurrent()) {
      this.renderActions();
      return;
    }
    const { editor, snapshot } = this.dependencies;
    editor.replaceRange(`\n\n${this.output}`, snapshot.to);
    this.close();
  }
}

function translationFailureMessage(error: unknown): string {
  if (error instanceof TranslationCancelledError) return t('translation.modal.canceled');
  if (error instanceof TranslationModelIncompleteError) {
    return t('translation.modal.incompleteModel');
  }
  return t('translation.modal.failed');
}
