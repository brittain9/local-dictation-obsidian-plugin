import { type App, type Editor, type EditorPosition, Modal, Setting } from 'obsidian';

import { t } from '../shared/i18n';
import { TranslationCancelledError } from './bergamot-client';
import {
  isSupportedTranslationPair,
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
  translationLanguageLabel,
} from './languages';

export interface TranslationSnapshot {
  from: EditorPosition;
  kind: 'note' | 'selection';
  source: string;
  to: EditorPosition;
}

interface TranslationModalDependencies {
  editor: Editor;
  initialSourceLanguage: TranslationLanguage;
  initialTargetLanguage: TranslationLanguage;
  onClosed: () => void;
  onInstallModel: () => Promise<void>;
  persistLanguages: (
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
  ) => Promise<void>;
  runTranslation: (options: {
    onReady: () => void;
    signal: AbortSignal;
    sourceLanguage: TranslationLanguage;
    targetLanguage: TranslationLanguage;
  }) => Promise<{ kind: 'missing_model' } | { kind: 'translated'; text: string }>;
  snapshot: TranslationSnapshot;
}

export class TranslationModal extends Modal {
  private abortController: AbortController | null = null;
  private output: string | null = null;
  private sourceLanguage: TranslationLanguage;
  private targetLanguage: TranslationLanguage;

  constructor(
    app: App,
    private readonly dependencies: TranslationModalDependencies,
  ) {
    super(app);
    this.sourceLanguage = dependencies.initialSourceLanguage;
    this.targetLanguage = dependencies.initialTargetLanguage;
  }

  override onOpen(): void {
    this.modalEl.addClass('local-stt-translation-modal');
    this.render();
    void this.translate();
  }

  override onClose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.contentEl.empty();
    this.dependencies.onClosed();
  }

  private render(status = t('translation.modal.preparing')): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: t('translation.modal.title') });
    contentEl.createEl('p', {
      cls: 'local-stt-translation-modal__privacy',
      text: t('translation.modal.privacy'),
    });

    const languageRow = contentEl.createDiv({ cls: 'local-stt-translation-modal__languages' });
    new Setting(languageRow).setName(t('translation.modal.from')).addDropdown((dropdown) => {
      for (const language of TRANSLATION_LANGUAGES) {
        dropdown.addOption(language, translationLanguageLabel(language));
      }
      dropdown.setValue(this.sourceLanguage);
      dropdown.onChange((value) => {
        if (!isLanguage(value)) return;
        this.sourceLanguage = value;
        if (!isSupportedTranslationPair(this.sourceLanguage, this.targetLanguage)) {
          this.targetLanguage = this.sourceLanguage === 'en' ? 'es' : 'en';
        }
        this.restart();
      });
    });
    new Setting(languageRow).setName(t('translation.modal.to')).addDropdown((dropdown) => {
      for (const language of TRANSLATION_LANGUAGES) {
        if (isSupportedTranslationPair(this.sourceLanguage, language)) {
          dropdown.addOption(language, translationLanguageLabel(language));
        }
      }
      dropdown.setValue(this.targetLanguage);
      dropdown.onChange((value) => {
        if (!isLanguage(value)) return;
        this.targetLanguage = value;
        this.restart();
      });
    });
    new Setting(languageRow).addButton((button) => {
      button
        .setButtonText(t('translation.modal.swap'))
        .setIcon('arrow-left-right')
        .onClick(() => {
          const source = this.sourceLanguage;
          this.sourceLanguage = this.targetLanguage;
          this.targetLanguage = source;
          this.restart();
        });
    });

    if (this.dependencies.snapshot.source.length > 10_000) {
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

    contentEl.createDiv({
      cls: 'local-stt-translation-modal__status',
      text: status,
    });
    const outputEl = contentEl.createEl('textarea', {
      cls: 'local-stt-translation-modal__output',
      attr: {
        'aria-label': t('translation.modal.previewAria'),
        readonly: '',
      },
    });
    outputEl.value = this.output ?? '';

    const actions = new Setting(contentEl).setClass('local-stt-translation-modal__actions');
    if (this.abortController !== null) {
      actions.addButton((button) => {
        button.setButtonText(t('translation.modal.cancel')).onClick(() => {
          this.abortController?.abort();
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

    if (this.output !== null) {
      actions.addButton((button) => {
        button
          .setButtonText(t('translation.modal.replace'))
          .setCta()
          .setDisabled(!this.sourceIsCurrent())
          .onClick(() => this.replace());
      });
      actions.addButton((button) => {
        button.setButtonText(t('translation.modal.insertBelow')).onClick(() => this.insertBelow());
      });
      actions.addButton((button) => {
        button.setButtonText(t('translation.modal.copy')).onClick(() => {
          void navigator.clipboard.writeText(this.output ?? '');
        });
      });
    }
  }

  private restart(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.output = null;
    this.render();
    void this.translate();
  }

  private async translate(): Promise<void> {
    if (this.abortController !== null) return;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.output = null;
    this.render(t('translation.modal.loading'));
    try {
      await this.dependencies.persistLanguages(this.sourceLanguage, this.targetLanguage);
      if (this.abortController !== abortController || abortController.signal.aborted) return;
      const result = await this.dependencies.runTranslation({
        onReady: () => {
          if (this.abortController === abortController && !abortController.signal.aborted) {
            this.render(t('translation.modal.translating'));
          }
        },
        signal: abortController.signal,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
      });
      if (this.abortController !== abortController || abortController.signal.aborted) return;
      if (result.kind === 'missing_model') {
        this.abortController = null;
        this.renderMissingModel();
        return;
      }
      this.output = result.text;
      this.abortController = null;
      this.render(t('translation.modal.ready'));
    } catch (error) {
      if (this.abortController !== abortController) return;
      this.abortController = null;
      if (error instanceof TranslationCancelledError) {
        this.render(t('translation.modal.canceled'));
      } else {
        this.render(error instanceof Error ? error.message : t('translation.modal.failed'));
      }
    }
  }

  private renderMissingModel(): void {
    this.render(t('translation.modal.missingModel'));
    new Setting(this.contentEl).addButton((button) => {
      button
        .setButtonText(t('translation.modal.installModel'))
        .setCta()
        .onClick(() => {
          void this.dependencies.onInstallModel();
        });
    });
  }

  private sourceIsCurrent(): boolean {
    const { editor, snapshot } = this.dependencies;
    return snapshot.kind === 'note'
      ? editor.getValue() === snapshot.source
      : editor.getRange(snapshot.from, snapshot.to) === snapshot.source;
  }

  private replace(): void {
    if (this.output === null || !this.sourceIsCurrent()) {
      this.render(t('translation.modal.stale'));
      return;
    }
    const { editor, snapshot } = this.dependencies;
    editor.replaceRange(this.output, snapshot.from, snapshot.to);
    this.close();
  }

  private insertBelow(): void {
    if (this.output === null) return;
    const { editor, snapshot } = this.dependencies;
    const insertionPoint = this.sourceIsCurrent() ? snapshot.to : editor.getCursor('to');
    editor.replaceRange(`\n\n${this.output}`, insertionPoint);
    this.close();
  }
}

function isLanguage(value: string): value is TranslationLanguage {
  return (TRANSLATION_LANGUAGES as readonly string[]).includes(value);
}
