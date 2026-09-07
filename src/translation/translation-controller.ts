import type { App, Editor, EditorPosition } from 'obsidian';
import type { ModelPickerOptions } from '../models/manage-models-modal';
import type { ModelInstallManager } from '../models/model-install-manager';
import { type CatalogModelRecord, matchesModelTriple } from '../models/model-management-types';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { TranslationCancelledError, translateWithBergamot } from './bergamot-client';
import { translateWithHyMt } from './hy-mt-client';
import {
  findInstalledTranslationModel,
  type InstalledTranslationModel,
  inferTranslationLanguage,
  resolveTranslationLanguages,
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
const MAX_REALTIME_TRANSLATION_QUEUE = 16;

interface RealtimeTranslationUpdate {
  isFinal: boolean;
  revision: number;
  utteranceId: string;
}

interface RealtimeTranslationSlot {
  latest: { source: string; update: RealtimeTranslationUpdate };
  processed?: { source: string; update: RealtimeTranslationUpdate };
  scheduled: boolean;
  abortController?: AbortController;
  generation: number;
  key: string;
  targetKey: object;
  target: RealtimeTranslationTarget;
  done: Promise<void>;
  finish: () => void;
}

interface TranslationAdapterContext {
  installed: InstalledTranslationModel;
  model: CatalogModelRecord;
  options: TranslationJobRunOptions;
  settings: PluginSettings;
  sidecarConnection:
    | Pick<SidecarConnection, 'cancelTranslation' | 'startTranslation' | 'subscribe'>
    | undefined;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
  texts: string[];
}

type TranslationAdapter = (context: TranslationAdapterContext) => Promise<string[]>;

const TRANSLATION_ADAPTERS: Readonly<Record<string, TranslationAdapter>> = {
  'bergamot_wasm:firefox_translations': ({
    installed,
    options,
    sourceLanguage,
    targetLanguage,
    texts,
  }) =>
    translateWithBergamot({
      ...installed,
      ...options,
      sourceLanguage,
      targetLanguage,
      texts,
    }),
  'llama_cpp:tencent_hy_mt': ({
    model,
    options,
    settings,
    sidecarConnection,
    sourceLanguage,
    targetLanguage,
    texts,
  }) => {
    if (sidecarConnection === undefined)
      throw new Error('This translation model requires the native sidecar.');
    return translateWithHyMt({
      accelerationPreference: settings.accelerationPreference,
      modelSelection: {
        kind: 'catalog_model',
        runtimeId: model.runtimeId,
        familyId: model.familyId,
        modelId: model.modelId,
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
  },
};

interface TranslationControllerDependencies {
  app: App;
  canReadAloud: (text: string, language: TranslationLanguage) => boolean;
  feedback: Pick<UserFeedback, 'show'>;
  getSettings: () => PluginSettings;
  logger: PluginLogger;
  modelManager: ModelInstallManager;
  onReadAloud: (text: string, language: TranslationLanguage) => Promise<void> | void;
  openModelPicker: (options?: ModelPickerOptions) => Promise<void>;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  sidecarConnection?: Pick<
    SidecarConnection,
    'cancelTranslation' | 'startTranslation' | 'subscribe'
  >;
  setDetachedStatus?: (state: TranslationJobState | null, reopen: () => void) => void;
}
interface ActiveTranslation {
  configuration: TranslationConfiguration;
  editor: Editor;
  job: TranslationJob;
  release: () => void;
  snapshot: TranslationSnapshot;
}
interface TranslationConfiguration {
  model: CatalogModelRecord | null;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
}

export class TranslationController {
  private active: ActiveTranslation | null = null;
  private activeModal: TranslationModal | null = null;
  private disposed = false;
  private realtimeAbortController: AbortController | null = null;
  private realtimeGeneration = 0;
  private realtimePendingCount = 0;
  private realtimeQueue: RealtimeTranslationSlot[] = [];
  private realtimeActive = false;
  private readonly realtimeSlots = new Map<object, Map<string, RealtimeTranslationSlot>>();
  private realtimeLegacyId = 0;
  constructor(private readonly dependencies: TranslationControllerDependencies) {}

  translateSelection(editor: Editor): void {
    if (this.reopenActive() || !editor.somethingSelected()) return;
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    this.begin(editor, {
      from,
      kind: 'selection',
      source: editor.getRange(from, to),
      to,
    });
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
    this.begin(editor, {
      from: { line: 0, ch: 0 },
      kind: 'note',
      source,
      to: endPosition(source),
    });
  }
  dispose(): void {
    this.disposed = true;
    this.realtimeGeneration += 1;
    this.realtimeAbortController?.abort();
    this.realtimeAbortController = null;
    for (const slots of this.realtimeSlots.values()) {
      for (const slot of slots.values()) slot.finish();
    }
    this.realtimeSlots.clear();
    this.realtimeQueue = [];
    this.active?.job.cancel();
    this.activeModal?.close();
    this.clearActive();
  }

  /** Queue a finalized dictation sentence without opening the translation UI. */
  translateRealtime(
    source: string,
    target: RealtimeTranslationTarget,
    update?: RealtimeTranslationUpdate,
  ): void {
    const text = source.trim();
    if (text.length === 0 || this.disposed) return;
    const hasRevisionMetadata = update !== undefined;
    const resolvedUpdate = update ?? {
      isFinal: true,
      revision: 0,
      utteranceId: `legacy-${++this.realtimeLegacyId}`,
    };
    const targetKey = target as object;
    let slots = this.realtimeSlots.get(targetKey);
    if (slots === undefined) {
      slots = new Map();
      this.realtimeSlots.set(targetKey, slots);
    }
    // Keep all revisions for one utterance in one slot. A final revision
    // supersedes partial text, while the worker drains the newest snapshot.
    const isFinalRevision = hasRevisionMetadata && resolvedUpdate.isFinal;
    const key = resolvedUpdate.utteranceId;
    let slot = slots.get(key);
    if (slot === undefined) {
      // Partials are expendable under sustained load; a final is not. Dropping
      // it would leave the last provisional translation permanently visible.
      if (this.realtimePendingCount >= MAX_REALTIME_TRANSLATION_QUEUE && !isFinalRevision) {
        this.dependencies.logger.warn(
          'translation',
          `realtime translation queue is full; skipped a sentence (${MAX_REALTIME_TRANSLATION_QUEUE} pending)`,
        );
        return;
      }
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      slot = {
        done,
        finish,
        latest: { source: text, update: resolvedUpdate },
        scheduled: false,
        generation: this.realtimeGeneration,
        key,
        targetKey,
        target,
      };
      slots.set(key, slot);
      this.realtimePendingCount += 1;
      this.scheduleRealtimeSlot(slot);
      return;
    }
    if (
      resolvedUpdate.isFinal ||
      (!slot.latest.update.isFinal && resolvedUpdate.revision >= slot.latest.update.revision)
    ) {
      slot.latest = { source: text, update: resolvedUpdate };
    }
  }

  async drainRealtime(target: RealtimeTranslationTarget): Promise<void> {
    while (!this.disposed) {
      const slots = this.realtimeSlots.get(target);
      if (slots === undefined || slots.size === 0) return;
      await Promise.all([...slots.values()].map((slot) => slot.done));
    }
  }

  private scheduleRealtimeSlot(slot: RealtimeTranslationSlot): void {
    if (
      slot.scheduled ||
      this.disposed ||
      slot.generation !== this.realtimeGeneration ||
      slot.latest === slot.processed
    )
      return;
    slot.scheduled = true;
    this.realtimeQueue.push(slot);
    this.pumpRealtimeQueue();
  }

  private pumpRealtimeQueue(): void {
    if (this.realtimeActive || this.disposed) return;
    const nextIndex = this.realtimeQueue.findIndex((slot) => slot.latest.update.isFinal);
    const slot = this.realtimeQueue.splice(nextIndex < 0 ? 0 : nextIndex, 1)[0];
    if (slot === undefined) return;
    this.realtimeActive = true;
    void this.processRealtimeSlot(slot)
      .catch((error: unknown) => {
        if (
          !(error instanceof TranslationCancelledError) &&
          !(error instanceof DOMException && error.name === 'AbortError')
        )
          this.dependencies.logger.warn('translation', 'realtime translation failed', error);
      })
      .finally(() => {
        this.realtimeActive = false;
        slot.scheduled = false;
        const slots = this.realtimeSlots.get(slot.targetKey);
        if (
          !this.disposed &&
          slot.generation === this.realtimeGeneration &&
          slot.latest !== slot.processed
        ) {
          this.scheduleRealtimeSlot(slot);
        } else {
          slot.finish();
          this.realtimePendingCount -= 1;
          slots?.delete(slot.key);
          if (slots?.size === 0) this.realtimeSlots.delete(slot.targetKey);
        }
        if (
          slot.generation === this.realtimeGeneration &&
          this.realtimeAbortController === slot.abortController
        )
          this.realtimeAbortController = null;
        this.pumpRealtimeQueue();
      });
  }

  private async processRealtimeSlot(slot: RealtimeTranslationSlot): Promise<void> {
    const request = slot.latest;
    // Configuration failures must also release this snapshot instead of
    // repeatedly scheduling it ahead of other finalized utterances.
    slot.processed = request;
    const settings = this.dependencies.getSettings();
    if (!settings.realtimeTranslationEnabled) {
      slot.processed = request;
      return;
    }
    const model = selectedTranslationModel(this.dependencies.modelManager.getState(), settings);
    const realtimeDictationLanguage =
      settings.dictationLanguage === 'auto' && settings.translationSourceLanguage === null
        ? (inferTranslationLanguage(request.source) ?? settings.dictationLanguage)
        : settings.dictationLanguage;
    const { sourceLanguage, targetLanguage } = resolveTranslationLanguages(
      realtimeDictationLanguage,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      model,
    );
    const abortController = new AbortController();
    slot.abortController = abortController;
    this.realtimeAbortController = abortController;
    let result: TranslationJobResult;
    try {
      result = await this.runTranslation(request.source, model, sourceLanguage, targetLanguage, {
        onProgress: () => {},
        onReady: () => {},
        signal: abortController.signal,
      });
    } catch (error) {
      // A failed revision is terminal for this snapshot. Retrying it from
      // the scheduler would create an unbounded loop and starve newer text.
      slot.processed = request;
      throw error;
    }
    const stillCurrent = slot.latest === request;
    // During speech, show completed work even if a newer partial has arrived.
    // Otherwise continuous revisions can suppress every visible update.
    const canPublish = stillCurrent || (!request.update.isFinal && !slot.latest.update.isFinal);
    slot.processed = request;
    if (this.disposed || slot.generation !== this.realtimeGeneration) return;
    if (canPublish && result.kind === 'translated' && result.text.trim() !== request.source) {
      const inserted =
        request.update.utteranceId.length > 0 &&
        slot.target.replaceUtteranceTranslation !== undefined
          ? slot.target.replaceUtteranceTranslation(request.update.utteranceId, result.text.trim())
          : slot.target.insertAdjacentToSessionRange(`> ${result.text.trim()}`, 'below');
      if (!inserted) {
        this.dependencies.logger.warn('translation', 'realtime translation could not be written', {
          utteranceId: request.update.utteranceId,
          revision: request.update.revision,
          isFinal: request.update.isFinal,
        });
      }
    }
  }

  private reopenActive(): boolean {
    if (this.active === null) return false;
    this.openModal();
    return true;
  }
  private begin(
    editor: Editor,
    snapshot: TranslationSnapshot,
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
    const model = selectedTranslationModel(this.dependencies.modelManager.getState(), settings);
    const resolved = resolveTranslationLanguages(
      settings.dictationLanguage,
      sourceOverride ?? settings.translationSourceLanguage,
      targetOverride ?? settings.translationTargetLanguage,
      model,
    );
    const { sourceLanguage, targetLanguage } = resolved;
    const job = new TranslationJob({
      model,
      sourceLanguage,
      targetLanguage,
      run: (options) =>
        this.runTranslation(snapshot.source, model, sourceLanguage, targetLanguage, options),
    });
    const active: ActiveTranslation = {
      configuration: { model, sourceLanguage, targetLanguage },
      editor,
      job,
      release: () => {},
      snapshot,
    };
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
      canReadAloud: this.dependencies.canReadAloud,
      editor: active.editor,
      feedback: this.dependencies.feedback,
      job: active.job,
      configuration: active.configuration,
      modelOptions: this.installedTranslationModels(),
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
      onManageModels: async () => {
        modal.close();
        try {
          await this.dependencies.openModelPicker({
            initialTask: 'translation',
          });
          if (this.active !== active) return;
          const nextModel = selectedTranslationModel(
            this.dependencies.modelManager.getState(),
            this.dependencies.getSettings(),
          );
          if (!sameTranslationModel(active.configuration.model, nextModel)) {
            const pair = resolveTranslationLanguages(
              this.dependencies.getSettings().dictationLanguage,
              active.configuration.sourceLanguage,
              active.configuration.targetLanguage,
              nextModel,
            );
            active.configuration = { model: nextModel, ...pair };
            await this.persistTranslationLanguages(pair.sourceLanguage, pair.targetLanguage);
          }
        } finally {
          if (this.active === active) this.openModal();
        }
      },
      onLanguageChange: (sourceLanguage, targetLanguage) => {
        active.configuration = {
          ...active.configuration,
          sourceLanguage,
          targetLanguage,
        };
        return this.persistTranslationLanguages(sourceLanguage, targetLanguage);
      },
      onModelChange: async (model, sourceLanguage, targetLanguage) => {
        await this.dependencies.modelManager.select({
          familyId: model.familyId,
          kind: 'catalog_model',
          modelId: model.modelId,
          runtimeId: model.runtimeId,
        });
        active.configuration = { model, sourceLanguage, targetLanguage };
      },
      onReadAloud: this.dependencies.onReadAloud,
      onTranslateCurrent: (sourceLanguage, targetLanguage) => {
        this.begin(
          active.editor,
          this.snapshotFromCurrentEditor(active),
          sourceLanguage,
          targetLanguage,
        );
      },
      onRestart: (source, target) => {
        void this.persistTranslationLanguages(source, target);
        this.begin(active.editor, this.snapshotFromCurrentEditor(active), source, target);
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
  private persistTranslationLanguages(
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
  ): Promise<void> {
    return this.dependencies.saveSettings({
      ...this.dependencies.getSettings(),
      translationSourceLanguage: sourceLanguage,
      translationTargetLanguage: targetLanguage,
    });
  }
  private snapshotFromCurrentEditor(active: ActiveTranslation): TranslationSnapshot {
    const source =
      active.snapshot.kind === 'note'
        ? active.editor.getValue()
        : active.editor.getRange(active.snapshot.from, active.snapshot.to);
    return {
      ...active.snapshot,
      source,
      ...(active.snapshot.kind === 'note' ? { to: endPosition(source) } : {}),
    };
  }
  private installedTranslationModels(): CatalogModelRecord[] {
    const state = this.dependencies.modelManager.getState();
    return state.catalog.models.filter(
      (model) =>
        model.task === 'translation' &&
        state.installedModels.some((installed) =>
          matchesModelTriple(installed, model.runtimeId, model.familyId, model.modelId),
        ),
    );
  }
  private async runTranslation(
    source: string,
    model: CatalogModelRecord | null,
    sourceLanguage: TranslationLanguage,
    targetLanguage: TranslationLanguage,
    options: TranslationJobRunOptions,
  ): Promise<TranslationJobResult> {
    if (model === null) return { kind: 'missing_model' };
    const state = this.dependencies.modelManager.getState();
    const installed = findInstalledTranslationModel(
      { models: state.catalog.models, installedModels: state.installedModels },
      sourceLanguage,
      targetLanguage,
      model,
    );
    if (installed === null) return { kind: 'missing_model' };
    const segments = segmentMarkdownForTranslation(source, {
      protectedMarkerMode: protectedMarkerModeForTranslation(
        model.familyId,
        sourceLanguage,
        targetLanguage,
      ),
    });
    const texts = translatableTexts(segments);
    if (texts.length === 0) return { kind: 'translated', sourceUnitsKept: 0, text: source };
    try {
      const adapter = TRANSLATION_ADAPTERS[`${model.runtimeId}:${model.familyId}`];
      if (adapter === undefined)
        throw new Error(`No translation adapter is available for ${model.modelId}.`);
      const translations = await adapter({
        installed,
        model,
        options,
        settings: this.dependencies.getSettings(),
        sidecarConnection: this.dependencies.sidecarConnection,
        sourceLanguage,
        targetLanguage,
        texts,
      });
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
}

export interface RealtimeTranslationTarget {
  insertAdjacentToSessionRange(blockText: string, placement: 'above' | 'below'): boolean;
  replaceUtteranceTranslation?(utteranceId: string, translationText: string): boolean;
}

function selectedTranslationModel(
  state: ReturnType<ModelInstallManager['getState']>,
  settings: PluginSettings,
): CatalogModelRecord | null {
  const selection = state.selectedTranslationModel ?? settings.selectedTranslationModel;
  if (selection?.kind !== 'catalog_model') return null;
  return (
    state.catalog.models.find(
      (model) =>
        model.task === 'translation' &&
        model.runtimeId === selection.runtimeId &&
        model.familyId === selection.familyId &&
        model.modelId === selection.modelId,
    ) ?? null
  );
}

function sameTranslationModel(
  left: CatalogModelRecord | null,
  right: CatalogModelRecord | null,
): boolean {
  if (left === null || right === null) return left === right;
  return matchesModelTriple(left, right.runtimeId, right.familyId, right.modelId);
}
function createTranslationId(): string {
  return (
    window.crypto?.randomUUID?.() ??
    `translation-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
function endPosition(text: string): EditorPosition {
  const lines = text.split('\n');
  return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 };
}
