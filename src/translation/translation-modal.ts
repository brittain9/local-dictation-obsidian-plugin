import { type App, type Editor, type EditorPosition, Modal, Setting } from 'obsidian';
import { t, tPlural } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import { localizeKnownSidecarEventCode } from '../sidecar/sidecar-event-localization';
import { HyMtTranslationError } from './hy-mt-client';
import {
  isTranslationLanguage,
  resolveTranslationTarget,
  TRANSLATION_LANGUAGES,
  type TranslationEngineId,
  type TranslationLanguage,
  translationLanguageLabel,
  translationTargetsFor,
} from './languages';
import { TranslationModelIncompleteError } from './translation-artifacts';
import { TRANSLATION_ENGINES, translationEngineLabel } from './translation-engines';
import type { TranslationJob, TranslationJobState } from './translation-job';

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
  job: TranslationJob;
  onApplied: () => void;
  onClosed: () => void;
  onDismissed: () => void;
  onInstallModel: () => Promise<void>;
  onTranslateCurrent: () => void;
  onRestart: (
    engineId: TranslationEngineId,
    source: TranslationLanguage,
    target: TranslationLanguage,
  ) => void;
  snapshot: TranslationSnapshot;
}

export class TranslationModal extends Modal {
  private actionsEl: HTMLElement | null = null;
  private headingEl: HTMLElement | null = null;
  private selectorsEl: HTMLElement | null = null;
  private outputEl: HTMLTextAreaElement | null = null;
  private outputSurfaceEl: HTMLElement | null = null;
  private releaseJob: (() => void) | null = null;
  private state: TranslationJobState;
  private statusEl: HTMLElement | null = null;
  private elapsedTimer: number | null = null;

  constructor(
    app: App,
    private readonly dependencies: TranslationModalDependencies,
  ) {
    super(app);
    this.state = dependencies.job.state();
  }
  override onOpen(): void {
    this.modalEl.addClass('local-stt-translation-modal');
    this.renderShell();
    this.releaseJob = this.dependencies.job.subscribe((state) => {
      this.state = state;
      this.syncElapsedTimer();
      this.renderState();
    });
    this.dependencies.job.start();
  }
  override onClose(): void {
    this.releaseJob?.();
    this.releaseJob = null;
    this.stopElapsedTimer();
    this.contentEl.empty();
    this.dependencies.onClosed();
  }
  private renderShell(): void {
    this.contentEl.empty();
    this.headingEl = this.contentEl.createEl('h2');
    this.contentEl.createEl('p', {
      cls: 'local-stt-translation-modal__privacy',
      text: t('translation.modal.privacy'),
    });
    this.selectorsEl = this.contentEl.createDiv({ cls: 'local-stt-translation-modal__languages' });
    if (this.dependencies.snapshot.source.length > LARGE_SOURCE_CHARACTERS)
      this.contentEl.createEl('p', {
        cls: 'local-stt-translation-modal__warning',
        text: t('translation.modal.largeNote'),
      });
    const details = this.contentEl.createEl('details', {
      cls: 'local-stt-translation-modal__source',
    });
    details.createEl('summary', {
      text:
        this.dependencies.snapshot.kind === 'selection'
          ? t('translation.modal.sourceSelection')
          : t('translation.modal.sourceNote'),
    });
    details.createEl('pre', {
      cls: 'local-stt-translation-modal__preview',
      text: this.dependencies.snapshot.source,
    });
    this.statusEl = this.contentEl.createDiv({
      attr: { 'aria-live': 'polite', role: 'status' },
      cls: 'local-stt-translation-modal__status',
    });
    this.outputSurfaceEl = this.contentEl.createDiv({
      cls: 'local-stt-translation-modal__output-surface',
    });
    this.outputSurfaceEl.createDiv({
      cls: 'local-stt-translation-modal__output-label',
      text: t('translation.modal.previewAria'),
    });
    this.outputEl = this.outputSurfaceEl.createEl('textarea', {
      attr: { 'aria-label': t('translation.modal.previewAria'), readonly: '' },
      cls: 'local-stt-translation-modal__output',
    });
    this.actionsEl = this.contentEl.createDiv();
    this.renderHeading();
    this.renderSelectors();
    this.renderState();
  }
  private renderHeading(): void {
    if (this.headingEl !== null)
      this.headingEl.textContent = t('translation.modal.titleWithPair', {
        source: translationLanguageLabel(this.dependencies.job.sourceLanguage),
        target: translationLanguageLabel(this.dependencies.job.targetLanguage),
      });
  }
  private renderSelectors(): void {
    if (this.selectorsEl === null) return;
    this.selectorsEl.empty();
    const active = this.state.phase === 'loading' || this.state.phase === 'translating';
    const style = this.selectorsEl.createDiv({
      cls: 'local-stt-translation-modal__translation-style',
    });
    new Setting(style).setName(t('settings.translation.engine.name')).addDropdown((dropdown) => {
      for (const engine of TRANSLATION_ENGINES)
        dropdown.addOption(engine.id, translationEngineLabel(engine.id));
      dropdown
        .setValue(this.dependencies.job.engineId)
        .setDisabled(active)
        .onChange((value) => {
          if (value === 'bergamot' || value === 'tencent_hy_mt')
            this.restart(
              value,
              this.dependencies.job.sourceLanguage,
              this.dependencies.job.targetLanguage,
            );
        });
    });
    const languagePair = this.selectorsEl.createDiv({
      cls: 'local-stt-translation-modal__language-pair',
    });
    const source = languagePair.createDiv({
      cls: 'local-stt-translation-modal__language-control',
    });
    new Setting(source).setName(t('translation.modal.from')).addDropdown((dropdown) => {
      for (const language of TRANSLATION_LANGUAGES)
        dropdown.addOption(language, translationLanguageLabel(language));
      dropdown
        .setValue(this.dependencies.job.sourceLanguage)
        .setDisabled(active)
        .onChange((value) => {
          if (isTranslationLanguage(value))
            this.restart(
              this.dependencies.job.engineId,
              value,
              resolveTranslationTarget(
                value,
                this.dependencies.job.targetLanguage,
                this.dependencies.job.engineId,
              ),
            );
        });
    });
    languagePair.createSpan({
      attr: { 'aria-hidden': 'true' },
      cls: 'local-stt-translation-modal__direction',
      text: '→',
    });
    const target = languagePair.createDiv({
      cls: 'local-stt-translation-modal__language-control',
    });
    new Setting(target).setName(t('translation.modal.to')).addDropdown((dropdown) => {
      for (const language of translationTargetsFor(
        this.dependencies.job.sourceLanguage,
        this.dependencies.job.engineId,
      ))
        dropdown.addOption(language, translationLanguageLabel(language));
      dropdown
        .setValue(this.dependencies.job.targetLanguage)
        .setDisabled(active)
        .onChange((value) => {
          if (isTranslationLanguage(value))
            this.restart(
              this.dependencies.job.engineId,
              this.dependencies.job.sourceLanguage,
              value,
            );
        });
    });
  }
  private renderState(): void {
    if (this.outputEl !== null) {
      if (this.state.phase === 'completed') {
        this.outputEl.value = this.state.text;
      } else {
        this.outputEl.value = '';
      }
    }
    this.outputSurfaceEl?.toggleClass('is-hidden', this.state.phase !== 'completed');
    this.renderStatus(this.statusText());
    this.renderSelectors();
    this.renderActions();
  }
  private statusText(): string {
    switch (this.state.phase) {
      case 'idle':
      case 'loading':
        return t('translation.modal.loading');
      case 'translating':
        return this.state.total > 1
          ? t('translation.modal.translatingProgress', {
              completed: this.state.completed,
              total: this.state.total,
            })
          : t('translation.modal.translating');
      case 'missing_model':
        return t('translation.modal.missingModel');
      case 'cancelled':
        return t('translation.modal.canceled');
      case 'failed':
        return translationFailureMessage(this.state.error);
      case 'completed':
        return this.state.sourceUnitsKept > 0
          ? tPlural(
              this.state.sourceUnitsKept,
              {
                one: 'translation.modal.readyPartial_one',
                other: 'translation.modal.readyPartial_other',
              },
              { count: this.state.sourceUnitsKept },
            )
          : t('translation.modal.ready');
    }
  }
  private renderStatus(status: string): void {
    if (this.statusEl === null) return;
    this.statusEl.empty();
    this.statusEl.removeClass('is-active');
    const startedAt =
      this.state.phase === 'loading' || this.state.phase === 'translating'
        ? this.state.startedAt
        : null;
    if (startedAt !== null) {
      this.statusEl.addClass('is-active');
      this.statusEl.createSpan({
        attr: { 'aria-hidden': 'true' },
        cls: 'local-stt-translation-modal__spinner',
      });
      const copy = this.statusEl.createDiv({ cls: 'local-stt-translation-modal__status-copy' });
      copy.createSpan({ cls: 'local-stt-translation-modal__status-text', text: status });
      copy.createSpan({
        cls: 'local-stt-translation-modal__status-detail',
        text: t('translation.modal.privacy'),
      });
      this.statusEl.createSpan({
        cls: 'local-stt-translation-modal__elapsed',
        text: formatElapsed(Date.now() - startedAt),
      });
      return;
    }
    this.statusEl.createSpan({ cls: 'local-stt-translation-modal__status-text', text: status });
  }
  private syncElapsedTimer(): void {
    if (this.state.phase === 'loading' || this.state.phase === 'translating') {
      if (this.elapsedTimer === null)
        this.elapsedTimer = window.setInterval(() => this.renderStatus(this.statusText()), 1_000);
      return;
    }
    this.stopElapsedTimer();
  }
  private stopElapsedTimer(): void {
    if (this.elapsedTimer === null) return;
    window.clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
  }
  private renderActions(): void {
    if (this.actionsEl === null) return;
    this.actionsEl.empty();
    const actions = new Setting(this.actionsEl).setClass('local-stt-translation-modal__actions');
    if (this.state.phase === 'loading' || this.state.phase === 'translating') {
      actions.addButton((button) =>
        button
          .setButtonText(t('translation.modal.cancel'))
          .onClick(() => this.dependencies.job.cancel()),
      );
      return;
    }
    if (this.state.phase === 'missing_model') {
      actions.addButton((button) =>
        button
          .setButtonText(t('translation.modal.installModel'))
          .setCta()
          .onClick(() => void this.dependencies.onInstallModel()),
      );
      return;
    }
    if (this.state.phase === 'cancelled' || this.state.phase === 'failed') {
      actions.addButton((button) =>
        button
          .setButtonText(t('translation.modal.translateAgain'))
          .setCta()
          .onClick(() =>
            this.restart(
              this.dependencies.job.engineId,
              this.dependencies.job.sourceLanguage,
              this.dependencies.job.targetLanguage,
            ),
          ),
      );
      actions.addButton((button) =>
        button.setButtonText(t('translation.modal.dismiss')).onClick(() => {
          this.dependencies.onDismissed();
          this.close();
        }),
      );
      return;
    }
    if (this.state.phase !== 'completed') return;
    const current = this.sourceIsCurrent();
    if (!current) {
      actions.addButton((button) =>
        button
          .setButtonText(t('translation.modal.translateAgain'))
          .setCta()
          .onClick(() => {
            this.close();
            this.dependencies.onTranslateCurrent();
          }),
      );
      actions.addButton((button) =>
        button.setButtonText(t('translation.modal.copy')).onClick(() => void this.copy()),
      );
      actions.addButton((button) =>
        button.setButtonText(t('translation.modal.dismiss')).onClick(() => {
          this.dependencies.onDismissed();
          this.close();
        }),
      );
      this.renderStatus(t('translation.modal.stale'));
      return;
    }
    const canApply = this.state.sourceUnitsKept === 0;
    actions.addButton((button) =>
      button
        .setButtonText(t('translation.modal.replace'))
        .setCta()
        .setDisabled(!canApply)
        .onClick(() => this.replace()),
    );
    actions.addButton((button) =>
      button
        .setButtonText(t('translation.modal.insertBelow'))
        .setDisabled(!canApply)
        .onClick(() => this.insertBelow()),
    );
    actions.addButton((button) =>
      button.setButtonText(t('translation.modal.copy')).onClick(() => void this.copy()),
    );
    actions.addButton((button) =>
      button.setButtonText(t('translation.modal.dismiss')).onClick(() => {
        this.dependencies.onDismissed();
        this.close();
      }),
    );
  }
  private restart(
    engineId: TranslationEngineId,
    source: TranslationLanguage,
    target: TranslationLanguage,
  ): void {
    if (this.state.phase === 'loading' || this.state.phase === 'translating') return;
    this.close();
    this.dependencies.onRestart(engineId, source, target);
  }
  private sourceIsCurrent(): boolean {
    const { editor, snapshot } = this.dependencies;
    return snapshot.kind === 'note'
      ? editor.getValue() === snapshot.source
      : editor.getRange(snapshot.from, snapshot.to) === snapshot.source;
  }
  private async copy(): Promise<void> {
    if (this.state.phase !== 'completed') return;
    try {
      await navigator.clipboard.writeText(this.state.text);
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
    if (
      this.state.phase !== 'completed' ||
      this.state.sourceUnitsKept > 0 ||
      !this.sourceIsCurrent()
    )
      return;
    this.dependencies.editor.replaceRange(
      this.state.text,
      this.dependencies.snapshot.from,
      this.dependencies.snapshot.to,
    );
    this.dependencies.onApplied();
    this.close();
  }
  private insertBelow(): void {
    if (
      this.state.phase !== 'completed' ||
      this.state.sourceUnitsKept > 0 ||
      !this.sourceIsCurrent()
    )
      return;
    this.dependencies.editor.replaceRange(`\n\n${this.state.text}`, this.dependencies.snapshot.to);
    this.dependencies.onApplied();
    this.close();
  }
}
function translationFailureMessage(error: unknown): string {
  if (error instanceof TranslationModelIncompleteError) {
    return t('translation.modal.incompleteModel');
  }
  if (error instanceof HyMtTranslationError) {
    return localizeKnownSidecarEventCode(error.code) ?? t('translation.modal.failed');
  }
  return t('translation.modal.failed');
}

function formatElapsed(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
