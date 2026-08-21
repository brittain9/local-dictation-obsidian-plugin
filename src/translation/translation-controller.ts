import type { App, Editor, EditorPosition } from 'obsidian';
import type { ModelInstallManager } from '../models/model-install-manager';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { TranslationCancelledError, translateWithBergamot } from './bergamot-client';
import { translateWithHyMt } from './hy-mt-client';
import {
  findInstalledTranslationModel,
  resolveTranslationEngine,
  resolveTranslationLanguages,
  type TranslationEngineId,
  type TranslationLanguage,
} from './languages';
import {
  protectedMarkerModeForTranslation,
  rebuildTranslatedMarkdown,
  segmentMarkdownForTranslation,
  translatableTexts,
} from './markdown-segmentation';
import {
  TranslationJob,
  type TranslationJobResult,
  type TranslationJobRunOptions,
  type TranslationJobState,
} from './translation-job';
import { TranslationModal, type TranslationSnapshot } from './translation-modal';

const MAX_TRANSLATION_CHARACTERS = 50_000;
interface TranslationControllerDependencies {
  app: App;
  feedback: Pick<UserFeedback, 'show'>;
  getSettings: () => PluginSettings;
  logger: PluginLogger;
  modelManager: ModelInstallManager;
  openModelPicker: () => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  sidecarConnection?: Pick<
    SidecarConnection,
    'cancelTranslation' | 'startTranslation' | 'subscribe'
  >;
  setDetachedStatus?: (state: TranslationJobState | null, reopen: () => void) => void;
}
interface ActiveTranslation {
  editor: Editor;
  job: TranslationJob;
  release: () => void;
  snapshot: TranslationSnapshot;
}

export class TranslationController {
  private active: ActiveTranslation | null = null;
  private activeModal: TranslationModal | null = null;
  constructor(private readonly dependencies: TranslationControllerDependencies) {}

  translateSelection(editor: Editor): void {
    if (this.reopenActive() || !editor.somethingSelected()) return;
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    this.begin(editor, { from, kind: 'selection', source: editor.getRange(from, to), to });
  }
  translateNote(editor: Editor): void {
    if (this.reopenActive()) return;
    const source = editor.getValue();
    if (source.trim().length === 0) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'translation-no-text',
        message: t('translation.notice.noText'),
      });
      return;
    }
    this.begin(editor, { from: { line: 0, ch: 0 }, kind: 'note', source, to: endPosition(source) });
  }
  dispose(): void {
    this.active?.job.cancel();
    this.activeModal?.close();
    this.clearActive();
  }

  private reopenActive(): boolean {
    if (this.active === null) return false;
    this.openModal();
    return true;
  }
  private begin(
    editor: Editor,
    snapshot: TranslationSnapshot,
    engineOverride?: TranslationEngineId,
    sourceOverride?: TranslationLanguage,
    targetOverride?: TranslationLanguage,
  ): void {
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
    this.clearActive();
    const settings = this.dependencies.getSettings();
    const preferredEngine = engineOverride ?? settings.translationEngineId;
    let { sourceLanguage, targetLanguage } =
      sourceOverride !== undefined && targetOverride !== undefined
        ? { sourceLanguage: sourceOverride, targetLanguage: targetOverride }
        : resolveTranslationLanguages(
            settings.dictationLanguage,
            settings.translationSourceLanguage,
            settings.translationTargetLanguage,
            'tencent_hy_mt',
          );
    const engineId = resolveTranslationEngine(preferredEngine, sourceLanguage, targetLanguage);
    ({ sourceLanguage, targetLanguage } = resolveTranslationLanguages(
      settings.dictationLanguage,
      sourceLanguage,
      targetLanguage,
      engineId,
    ));
    const job = new TranslationJob({
      engineId,
      sourceLanguage,
      targetLanguage,
      run: (options) =>
        this.runTranslation(snapshot.source, engineId, sourceLanguage, targetLanguage, options),
    });
    const active: ActiveTranslation = { editor, job, release: () => {}, snapshot };
    active.release = job.subscribe((state) => {
      if (this.active !== active) return;
      if (this.activeModal === null)
        this.dependencies.setDetachedStatus?.(state, () => this.openModal());
    });
    this.active = active;
    this.openModal();
    job.start();
  }
  private openModal(): void {
    const active = this.active;
    if (active === null || this.activeModal !== null) return;
    this.dependencies.setDetachedStatus?.(null, () => {});
    const modal = new TranslationModal(this.dependencies.app, {
      editor: active.editor,
      feedback: this.dependencies.feedback,
      job: active.job,
      snapshot: active.snapshot,
      onApplied: () => this.clearActive(),
      onDismissed: () => this.clearActive(),
      onClosed: () => {
        if (this.activeModal === modal) {
          this.activeModal = null;
          if (this.active === active)
            this.dependencies.setDetachedStatus?.(active.job.state(), () => this.openModal());
        }
      },
      onInstallModel: async () => {
        modal.close();
        await this.dependencies.openModelPicker();
        if (this.active === active)
          this.begin(
            active.editor,
            active.snapshot,
            active.job.engineId,
            active.job.sourceLanguage,
            active.job.targetLanguage,
          );
      },
      onTranslateCurrent: () => {
        const source =
          active.snapshot.kind === 'note'
            ? active.editor.getValue()
            : active.editor.getRange(active.snapshot.from, active.snapshot.to);
        this.begin(
          active.editor,
          {
            ...active.snapshot,
            source,
            ...(active.snapshot.kind === 'note' ? { to: endPosition(source) } : {}),
          },
          active.job.engineId,
          active.job.sourceLanguage,
          active.job.targetLanguage,
        );
      },
      onRestart: (engineId, source, target) => {
        const current = this.dependencies.getSettings();
        void this.dependencies.saveSettings({
          ...current,
          translationEngineId: engineId,
          translationSourceLanguage: source,
          translationTargetLanguage: target,
        });
        this.begin(active.editor, active.snapshot, engineId, source, target);
      },
    });
    this.activeModal = modal;
    modal.open();
  }
  private clearActive(): void {
    const active = this.active;
    this.active = null;
    active?.release();
    this.dependencies.setDetachedStatus?.(null, () => {});
  }
  private async runTranslation(
    source: string,
    engineId: TranslationEngineId,
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
    options: TranslationJobRunOptions,
  ): Promise<TranslationJobResult> {
    const state = this.dependencies.modelManager.getState();
    const installed = findInstalledTranslationModel(
      { models: state.catalog.models, installedModels: state.installedModels },
      sourceLanguage,
      targetLanguage,
      engineId,
    );
    if (installed === null) return { kind: 'missing_model' };
    const segments = segmentMarkdownForTranslation(source, {
      protectedMarkerMode: protectedMarkerModeForTranslation(
        engineId,
        sourceLanguage,
        targetLanguage,
      ),
    });
    const texts = translatableTexts(segments);
    if (texts.length === 0) return { kind: 'translated', sourceUnitsKept: 0, text: source };
    try {
      const translations =
        engineId === 'bergamot'
          ? await translateWithBergamot({
              ...installed,
              ...options,
              sourceLanguage,
              targetLanguage,
              texts,
            })
          : await this.runHyMt(
              installed.catalogModel.modelId,
              sourceLanguage,
              targetLanguage,
              texts,
              options,
            );
      const rebuilt = rebuildTranslatedMarkdown(segments, translations);
      if (rebuilt.sourceUnitsKept > 0)
        this.dependencies.logger.warn(
          'translation',
          `kept ${rebuilt.sourceUnitsKept} unit(s) in the source language after structure validation`,
        );
      return { kind: 'translated', ...rebuilt };
    } catch (error) {
      if (
        !(error instanceof TranslationCancelledError) &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        this.dependencies.logger.error('translation', 'local translation failed', error);
      throw error;
    }
  }
  private runHyMt(
    modelId: string,
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
    texts: string[],
    options: TranslationJobRunOptions,
  ): Promise<string[]> {
    const sidecarConnection = this.dependencies.sidecarConnection;
    if (sidecarConnection === undefined)
      throw new Error('Natural translation requires the native sidecar.');
    const settings = this.dependencies.getSettings();
    return translateWithHyMt({
      accelerationPreference: settings.accelerationPreference,
      modelSelection: {
        kind: 'catalog_model',
        runtimeId: 'llama_cpp',
        familyId: 'tencent_hy_mt',
        modelId,
      },
      ...(settings.modelStorePathOverride === ''
        ? {}
        : { modelStorePathOverride: settings.modelStorePathOverride }),
      ...options,
      sidecarConnection,
      sourceLanguage,
      targetLanguage,
      texts,
      translationId: createTranslationId(),
    });
  }
}
function createTranslationId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `translation-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
function endPosition(text: string): EditorPosition {
  const lines = text.split('\n');
  return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 };
}
