import { randomUUID } from 'node:crypto';

import type { AudioCaptureStream } from '../audio/audio-capture-stream';
import type { NotePlacementOptions } from '../editor/note-surface';
import { OLLAMA_KEEP_ALIVE, type OllamaClient } from '../llm/ollama-client';
import { formatBatchUserMessage } from '../llm/templates';
import type { Session } from '../session/session';
import type { StageId } from '../session/session-journal';
import type { LlmPostprocessMode, PluginSettings } from '../settings/plugin-settings';
import { formatErrorMessage } from '../shared/format-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import { truncateLeadingText } from '../shared/text-truncation';
import type {
  ContextRequestEvent,
  ContextWindow,
  ContextWindowSource,
  LlmPostprocessConfig,
  QueueBackpressureTier,
  SessionState,
  SidecarEvent,
  TranscriptReadyEvent,
} from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { SidecarNotInstalledError } from '../sidecar/sidecar-paths';
import type { TranscriptRenderOptions } from '../transcript/renderer';

export type DictationControllerState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'speech_detected'
  | 'speech_ending'
  | 'transcribing'
  | 'error';

type ControllerSession = Pick<
  Session,
  | 'acceptTranscript'
  | 'clearSessionProcessingMark'
  | 'dispose'
  | 'markSessionRangeAsProcessing'
  | 'readCurrentSessionText'
  | 'readNoteGlossary'
  | 'readNoteText'
  | 'readPriorUtterances'
  | 'replaceSessionRangeWithCleaned'
  | 'setAnchorMode'
>;

interface ActiveSessionSnapshot {
  accelerationPreference: PluginSettings['accelerationPreference'];
  dictationAnchor: PluginSettings['dictationAnchor'];
  listeningMode: PluginSettings['listeningMode'];
  llmFeaturesEnabled: PluginSettings['llmFeaturesEnabled'];
  llmPostprocess: LlmPostprocessConfig | null;
  llmPostprocessMode: LlmPostprocessMode;
  llmPostprocessModel: PluginSettings['llmPostprocessModel'];
  llmPostprocessNoteContextChars: PluginSettings['llmPostprocessNoteContextChars'];
  llmPostprocessPrompt: PluginSettings['llmPostprocessPrompt'];
  llmPostprocessShowRawBelow: PluginSettings['llmPostprocessShowRawBelow'];
  llmPostprocessTemperature: PluginSettings['llmPostprocessTemperature'];
  modelSelection: NonNullable<PluginSettings['selectedModel']>;
  modelStorePathOverride: string;
  sessionStartUnixMs: number;
  showTimestamps: PluginSettings['showTimestamps'];
  speakingStyle: PluginSettings['speakingStyle'];
  transcriptFormatting: PluginSettings['transcriptFormatting'];
  useNoteAsContext: PluginSettings['useNoteAsContext'];
}

interface DictationSessionControllerDependencies {
  captureStream: Pick<AudioCaptureStream, 'isCapturing' | 'start' | 'stop'>;
  createSession: (options: {
    callbacks: {
      onLockedNoteClosed: () => void;
      onLockedNoteDeleted: () => void;
    };
    placement: NotePlacementOptions;
    rendererOptions: TranscriptRenderOptions;
    sessionId: string;
  }) => ControllerSession;
  getSettings: () => PluginSettings;
  logger?: PluginLogger;
  notice: (message: string) => void;
  ollamaClient: Pick<OllamaClient, 'cleanup'>;
  onSidecarMissing?: () => void;
  setRibbonQueueTier: (tier: QueueBackpressureTier) => void;
  setRibbonState: (state: DictationControllerState) => void;
  sidecarConnection: Pick<
    SidecarConnection,
    | 'cancelSession'
    | 'ensureStarted'
    | 'sendAudioFrame'
    | 'sendContextResponse'
    | 'startSession'
    | 'stopSession'
    | 'subscribe'
  >;
}

const ANCHOR_VISIBLE_DELAY_MS = 2500;

export class DictationSessionController {
  private abortingSessionId: string | null = null;
  private anchorTimerId: ReturnType<typeof setTimeout> | null = null;
  private batchCleanupAbortController: AbortController | null = null;
  private llmFailureNotifiedForSessionId: string | null = null;
  private pendingStartSessionId: string | null = null;
  private queueTier: QueueBackpressureTier = 'normal';
  private readonly releaseSidecarSubscription: () => void;
  private session: ControllerSession | null = null;
  private sessionId: string | null = null;
  private sessionSnapshot: ActiveSessionSnapshot | null = null;
  private state: DictationControllerState = 'idle';

  constructor(private readonly dependencies: DictationSessionControllerDependencies) {
    this.releaseSidecarSubscription = this.dependencies.sidecarConnection.subscribe((event) => {
      void this.handleSidecarEvent(event);
    });
    this.applyUiState('idle');
  }

  getState(): DictationControllerState {
    return this.state;
  }

  isBusy(): boolean {
    return this.sessionId !== null || this.state === 'starting' || this.abortingSessionId !== null;
  }

  async cancelDictation(): Promise<void> {
    if (this.sessionId === null) {
      if (this.batchCleanupAbortController !== null) {
        this.abortBatchCleanup();
        return;
      }

      this.dependencies.notice('Dictation is not currently active.');
      return;
    }

    try {
      await this.dependencies.sidecarConnection.cancelSession(this.sessionId);
    } catch (error) {
      await this.cleanupLocalSession();
      this.handleError('Failed to cancel the dictation session', error);
    }
  }

  async dispose(): Promise<void> {
    this.abortBatchCleanup();
    const activeSessionId = this.sessionId;
    if (activeSessionId !== null) {
      try {
        await this.dependencies.sidecarConnection.stopSession(activeSessionId, 500);
      } catch (error) {
        this.dependencies.logger?.warn(
          'session',
          'timed out stopping dictation during unload',
          error,
        );
      }
    }
    this.releaseSidecarSubscription();
    await this.cleanupLocalSession();
    this.applyUiState('idle');
  }

  handleRibbonClick(): void {
    void this.toggleDictation();
  }

  async startDictation(): Promise<void> {
    if (this.sessionId !== null) {
      this.dependencies.notice('Dictation is already active.');
      return;
    }

    this.abortBatchCleanup();

    try {
      await this.dependencies.sidecarConnection.ensureStarted();
    } catch (error) {
      if (error instanceof SidecarNotInstalledError) {
        this.dependencies.logger?.debug('sidecar', 'sidecar not installed — prompting install');
        this.dependencies.onSidecarMissing?.();
        return;
      }
      this.handleError('Failed to start the dictation session', error);
      return;
    }

    const settings = this.dependencies.getSettings();
    const selectedModel = this.requireSelectedModel(settings);
    const snapshot: ActiveSessionSnapshot = {
      accelerationPreference: settings.accelerationPreference,
      dictationAnchor: settings.dictationAnchor,
      listeningMode: settings.listeningMode,
      llmFeaturesEnabled: settings.llmFeaturesEnabled,
      llmPostprocess: resolveLlmPostprocessSnapshot(settings),
      llmPostprocessMode: settings.llmPostprocessMode,
      llmPostprocessModel: settings.llmPostprocessModel,
      llmPostprocessNoteContextChars: settings.llmPostprocessNoteContextChars,
      llmPostprocessPrompt: settings.llmPostprocessPrompt,
      llmPostprocessShowRawBelow: settings.llmPostprocessShowRawBelow,
      llmPostprocessTemperature: settings.llmPostprocessTemperature,
      modelSelection: selectedModel,
      modelStorePathOverride: settings.modelStorePathOverride,
      sessionStartUnixMs: Date.now(),
      showTimestamps: settings.showTimestamps,
      speakingStyle: settings.speakingStyle,
      transcriptFormatting: settings.transcriptFormatting,
      useNoteAsContext: settings.useNoteAsContext,
    };
    const sessionId = createSessionId();
    let session: ControllerSession;

    try {
      session = this.dependencies.createSession({
        callbacks: {
          onLockedNoteClosed: () => {
            this.handleLockedNoteClosed(sessionId);
          },
          onLockedNoteDeleted: () => {
            this.handleLockedNoteDeleted(sessionId);
          },
        },
        placement: {
          anchor: snapshot.dictationAnchor,
        },
        rendererOptions: {
          showTimestamps: snapshot.showTimestamps,
          transcriptFormatting: snapshot.transcriptFormatting,
        },
        sessionId,
      });
    } catch (error) {
      this.handleError('Failed to start the dictation session', error);
      return;
    }

    this.sessionId = sessionId;
    this.session = session;
    this.sessionSnapshot = snapshot;
    this.applyUiState('starting');
    this.dependencies.logger?.debug('session', `starting dictation session ${sessionId}`);

    let frameForwardAborted = false;

    try {
      await this.dependencies.captureStream.start((frameBytes) => {
        if (frameForwardAborted || this.sessionId !== sessionId) {
          return;
        }

        try {
          this.dependencies.sidecarConnection.sendAudioFrame(frameBytes);
        } catch (error) {
          frameForwardAborted = true;
          this.dependencies.logger?.warn(
            'session',
            'stopping audio capture: sidecar rejected an audio frame',
            error,
          );
          void this.dependencies.captureStream.stop();
        }
      });
      this.pendingStartSessionId = sessionId;
      try {
        await this.dependencies.sidecarConnection.startSession({
          accelerationPreference: snapshot.accelerationPreference,
          language: 'en',
          ...(snapshot.llmPostprocess !== null ? { llmPostprocess: snapshot.llmPostprocess } : {}),
          mode: snapshot.listeningMode,
          modelSelection: snapshot.modelSelection,
          sessionStartUnixMs: snapshot.sessionStartUnixMs,
          sessionId,
          speakingStyle: snapshot.speakingStyle,
          ...(snapshot.modelStorePathOverride.length > 0
            ? { modelStorePathOverride: snapshot.modelStorePathOverride }
            : {}),
        });
      } finally {
        if (this.pendingStartSessionId === sessionId) {
          this.pendingStartSessionId = null;
        }
      }
    } catch (error) {
      await this.cleanupLocalSession();
      if (error instanceof SidecarNotInstalledError) {
        this.dependencies.logger?.debug('sidecar', 'sidecar not installed — prompting install');
        this.applyUiState('idle');
        this.dependencies.onSidecarMissing?.();
        return;
      }
      this.handleError('Failed to start the dictation session', error);
    }
  }

  async stopDictation(): Promise<void> {
    if (this.sessionId === null) {
      this.dependencies.notice('Dictation is not currently active.');
      return;
    }

    // Stop capture immediately so the mic turns off, but keep sessionId alive
    // so transcript_ready events are still accepted while the sidecar drains.
    if (this.dependencies.captureStream.isCapturing()) {
      await this.dependencies.captureStream.stop();
    }

    try {
      await this.dependencies.sidecarConnection.stopSession(this.sessionId);
    } catch (error) {
      await this.cleanupLocalSession();
      this.handleError('Failed to stop the dictation session', error);
    }
  }

  private async toggleDictation(): Promise<void> {
    if (this.state === 'error' && this.sessionId === null) {
      this.applyUiState('idle');
      return;
    }

    if (this.sessionId !== null) {
      await this.stopDictation();
      return;
    }

    await this.startDictation();
  }

  private applyUiState(state: DictationControllerState): void {
    this.state = state;
    this.dependencies.setRibbonState(state);
  }

  private async detachSession(): Promise<ControllerSession | null> {
    this.abortingSessionId = null;
    this.pendingStartSessionId = null;
    this.sessionId = null;
    this.sessionSnapshot = null;
    this.llmFailureNotifiedForSessionId = null;
    const session = this.session;
    this.session = null;
    this.clearAnchorTimer();
    this.resetQueueTier();

    if (this.dependencies.captureStream.isCapturing()) {
      await this.dependencies.captureStream.stop();
    }

    return session;
  }

  private async cleanupLocalSession(): Promise<void> {
    const session = await this.detachSession();
    session?.dispose();
  }

  private applySessionStateToAnchor(state: SessionState): void {
    if (!isAnchorVisibleSessionState(state)) {
      this.clearAnchorTimer();
      this.session?.setAnchorMode('hidden');
      return;
    }

    if (this.anchorTimerId !== null) {
      return;
    }

    const timerId = setTimeout(() => {
      if (this.anchorTimerId !== timerId) {
        return;
      }

      this.session?.setAnchorMode('visible');
    }, ANCHOR_VISIBLE_DELAY_MS);

    this.anchorTimerId = timerId;
  }

  private clearAnchorTimer(): void {
    if (this.anchorTimerId !== null) {
      clearTimeout(this.anchorTimerId);
      this.anchorTimerId = null;
    }
  }

  private async handleErrorEvent(event: Extract<SidecarEvent, { type: 'error' }>): Promise<void> {
    if (
      this.pendingStartSessionId !== null &&
      (event.sessionId === undefined || event.sessionId === this.pendingStartSessionId)
    ) {
      return;
    }

    if (
      event.sessionId !== undefined &&
      event.sessionId !== this.sessionId &&
      event.sessionId !== this.abortingSessionId
    ) {
      return;
    }

    const detail = event.details ? `${event.message} (${event.details})` : event.message;
    this.applyUiState('error');
    this.dependencies.notice(`Local Dictation: ${detail}`);

    if (event.sessionId !== undefined && event.sessionId === this.sessionId) {
      void this.abortSessionAfterError(event.sessionId);
    }
  }

  private async handleSessionStopped(
    event: Extract<SidecarEvent, { type: 'session_stopped' }>,
  ): Promise<void> {
    if (event.sessionId !== this.sessionId && event.sessionId !== this.abortingSessionId) {
      return;
    }

    this.dependencies.logger?.debug(
      'session',
      `session ${event.sessionId} stopped (reason: ${event.reason})`,
    );
    const snapshot = this.sessionSnapshot;
    const session = await this.detachSession();
    this.applyUiState('idle');

    if (snapshot !== null && session !== null && shouldRunBatchCleanup(snapshot, event.reason)) {
      await this.runBatchCleanup(snapshot, session);
    }

    session?.dispose();

    if (event.reason === 'timeout') {
      this.dependencies.notice(
        'Local Dictation: one-sentence mode timed out before speech started.',
      );
    }
  }

  private async runBatchCleanup(
    snapshot: ActiveSessionSnapshot,
    session: ControllerSession,
  ): Promise<void> {
    const model = snapshot.llmPostprocessModel.trim();
    const sessionTranscript = session.readCurrentSessionText();

    if (model.length === 0) {
      this.dependencies.logger?.debug('llm', 'batch cleanup skipped: no Ollama model selected');
      return;
    }

    if (sessionTranscript.length === 0) {
      this.dependencies.logger?.debug('llm', 'batch cleanup skipped: no transcript text');
      return;
    }

    const abortController = new AbortController();
    this.batchCleanupAbortController = abortController;

    const noteContext =
      snapshot.llmPostprocessNoteContextChars > 0
        ? (session.readNoteText(snapshot.llmPostprocessNoteContextChars)?.text ?? '')
        : '';
    const userMessage = formatBatchUserMessage(noteContext, sessionTranscript);

    try {
      this.dependencies.logger?.debug('llm', 'batch cleanup started', {
        chars: sessionTranscript.length,
        model,
      });
      this.dependencies.notice('Local Dictation: cleaning session transcript…');
      session.markSessionRangeAsProcessing();
      const cleanText = await this.dependencies.ollamaClient.cleanup({
        abortSignal: abortController.signal,
        model,
        prompt: snapshot.llmPostprocessPrompt,
        temperature: snapshot.llmPostprocessTemperature,
        userMessage,
      });
      if (cleanText.trim().length === 0) {
        this.dependencies.logger?.debug('llm', 'batch cleanup returned empty text');
        return;
      }

      const replaced = session.replaceSessionRangeWithCleaned(cleanText, {
        rawTextForCallout: sessionTranscript,
        showRawBelow: snapshot.llmPostprocessShowRawBelow,
      });
      if (!replaced) {
        this.dependencies.logger?.warn(
          'llm',
          'batch cleanup replacement skipped — transcript was edited during cleanup',
        );
        this.dependencies.notice(
          'Local Dictation: LLM transform skipped — you edited the transcript during cleanup. Raw text kept.',
        );
        return;
      }

      this.dependencies.logger?.debug('llm', 'batch cleanup complete', {
        chars: cleanText.trim().length,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      this.dependencies.logger?.warn(
        'llm',
        `batch cleanup failed; raw transcript kept: ${formatErrorMessage(error)}`,
        error,
      );
      this.dependencies.notice(
        `Local Dictation: LLM transform failed — raw transcript kept. (${formatErrorMessage(error)})`,
      );
    } finally {
      session.clearSessionProcessingMark();
      if (this.batchCleanupAbortController === abortController) {
        this.batchCleanupAbortController = null;
      }
    }
  }

  private abortBatchCleanup(): void {
    this.batchCleanupAbortController?.abort();
    this.batchCleanupAbortController = null;
  }

  private async handleSidecarEvent(event: SidecarEvent): Promise<void> {
    switch (event.type) {
      case 'health_ok':
      case 'system_info':
        return;

      case 'session_started':
        return;

      case 'session_state_changed':
        if (event.sessionId === this.sessionId) {
          this.applyUiState(event.state);
          this.applySessionStateToAnchor(event.state);
        }
        return;

      case 'transcript_ready':
        await this.handleTranscriptReady(event);
        return;

      case 'transcription_queue_changed':
        this.handleQueueTierChange(event);
        return;

      case 'context_request':
        this.handleContextRequest(event);
        return;

      case 'warning':
        if (event.sessionId === undefined || event.sessionId === this.sessionId) {
          const detail = event.details ? `${event.message} (${event.details})` : event.message;
          this.dependencies.notice(`Local Dictation: ${detail}`);
        }
        return;

      case 'session_stopped':
        await this.handleSessionStopped(event);
        return;

      case 'error':
        await this.handleErrorEvent(event);
        return;
    }
  }

  private handleQueueTierChange(
    event: Extract<SidecarEvent, { type: 'transcription_queue_changed' }>,
  ): void {
    if (event.sessionId !== this.sessionId) {
      return;
    }

    const previousTier = this.queueTier;
    if (previousTier === event.tier) {
      return;
    }
    this.queueTier = event.tier;
    this.dependencies.setRibbonQueueTier(event.tier);

    // Only notify on upward entry into falling_behind. Recovering from
    // `saturated` also passes through this tier, but the session is already
    // shutting down and the "pause to let it catch up" guidance would be
    // misleading on top of the saturation error.
    const recoveringFromSaturation = previousTier === 'saturated';
    if (
      event.tier === 'falling_behind' &&
      previousTier !== 'falling_behind' &&
      !recoveringFromSaturation
    ) {
      this.dependencies.notice(
        'Local Dictation: transcription is falling behind — pause to let it catch up.',
      );
    }
  }

  private resetQueueTier(): void {
    this.queueTier = 'normal';
    this.dependencies.setRibbonQueueTier('normal');
  }

  private handleContextRequest(event: ContextRequestEvent): void {
    if (event.sessionId !== this.sessionId) {
      return;
    }

    const snapshot = this.sessionSnapshot;
    const context = snapshot === null ? null : this.buildContextWindow(snapshot, event.budgetChars);

    this.dependencies.logger?.debug(
      'session',
      `context_request: ${context?.sources.length ?? 0} source(s), budget=${event.budgetChars}, truncated=${context?.truncated ?? false}`,
    );

    try {
      this.dependencies.sidecarConnection.sendContextResponse(event.correlationId, context);
    } catch (error) {
      this.dependencies.logger?.warn('session', 'failed to send context response', error);
    }
  }

  private buildContextWindow(
    snapshot: ActiveSessionSnapshot,
    budgetChars: number,
  ): ContextWindow | null {
    const sources: ContextWindowSource[] = [];
    let promptText = '';

    if (snapshot.useNoteAsContext) {
      const glossary = this.session?.readNoteGlossary(Math.min(384, budgetChars)) ?? null;
      if (glossary !== null) {
        sources.push({
          kind: 'note_glossary',
          text: glossary.text,
          truncated: glossary.truncated,
        });
        promptText = glossary.text;
      }
    }

    if (snapshot.llmPostprocess !== null) {
      sources.push(...this.buildLlmContextSources(snapshot.llmPostprocess));
    }

    if (sources.length === 0) {
      return null;
    }

    const truncated = sources.some((source) => source.truncated);

    return {
      budgetChars,
      sources,
      text: promptText,
      truncated,
    };
  }

  private buildLlmContextSources(config: LlmPostprocessConfig): ContextWindowSource[] {
    const sources: ContextWindowSource[] = [];
    const noteText =
      config.noteContextChars > 0
        ? (this.session?.readNoteText(config.noteContextChars) ?? null)
        : null;

    if (noteText !== null) {
      sources.push({ kind: 'note_text', text: noteText.text, truncated: noteText.truncated });
    }

    const priorUtteranceBudget =
      config.priorUtterancesN > 0
        ? Math.max(1, Math.ceil(config.totalContextCap / config.priorUtterancesN))
        : 0;
    for (const utterance of this.session?.readPriorUtterances(
      config.priorUtterancesN,
      priorUtteranceBudget,
    ) ?? []) {
      sources.push({
        kind: 'prior_utterance',
        text: utterance.text,
        truncated: utterance.truncated,
      });
    }

    return enforceLlmContextCap(sources, config.totalContextCap);
  }

  private async handleTranscriptReady(event: TranscriptReadyEvent): Promise<void> {
    if (event.sessionId !== this.sessionId) {
      return;
    }

    this.dependencies.logger?.debug(
      'session',
      `transcript received (${event.text.length} chars, ${event.processingDurationMs}ms processing)`,
    );

    // Capability-gate warnings are intentionally dev-console only — users
    // don't need to know the worker soft-dropped an unsupported field. Do not
    // surface these via Notice.
    for (const warning of event.warnings) {
      this.dependencies.logger?.debug(
        'session',
        `capability gate dropped "${warning.field}": ${warning.reason}`,
      );
    }
    this.logDroppedHallucinations(event);
    this.maybeNotifyLlmStageFailure(event);

    const text = event.text.trim();

    const session = this.session;
    if (session === null) {
      return;
    }

    const result = session.acceptTranscript({
      isFinal: event.isFinal,
      llmPostprocessRawText: shouldAppendRawLlmPostprocessCallout(event, this.sessionSnapshot)
        ? event.llmPostprocessRawText
        : null,
      pauseMsBeforeUtterance: event.pauseMsBeforeUtterance,
      revision: event.revision,
      segments: event.segments,
      sessionId: event.sessionId,
      stageResults: event.stageResults,
      text,
      utteranceEndMsInSession: event.utteranceEndMsInSession,
      utteranceId: event.utteranceId,
      utteranceIndex: event.utteranceIndex,
      utteranceStartMsInSession: event.utteranceStartMsInSession,
    });
    if (result.kind === 'rejected') {
      this.handleError('Failed to record the local transcript', new Error(result.reason));
      void this.abortSessionAfterError(event.sessionId);
    }
  }

  private maybeNotifyLlmStageFailure(event: TranscriptReadyEvent): void {
    if (this.llmFailureNotifiedForSessionId === event.sessionId) {
      return;
    }
    const failed = event.stageResults.find(
      (stage) => stage.stageId === 'llm_postprocess' && stage.status.kind === 'failed',
    );
    if (failed === undefined || failed.status.kind !== 'failed') {
      return;
    }
    this.llmFailureNotifiedForSessionId = event.sessionId;
    this.dependencies.logger?.warn(
      'llm',
      `per-utterance LLM transform failed: ${failed.status.error}`,
    );
    this.dependencies.notice(
      'Local Dictation: LLM transform failed — raw transcript kept. Check Ollama and the selected model.',
    );
  }

  private logDroppedHallucinations(event: TranscriptReadyEvent): void {
    const targetStageId: StageId = 'hallucination_filter';
    for (const stage of event.stageResults) {
      if (stage.stageId !== targetStageId || stage.status.kind !== 'ok') {
        continue;
      }
      const droppedSegments = stage.payload?.droppedSegments;
      if (!Array.isArray(droppedSegments)) {
        continue;
      }
      for (const segment of droppedSegments) {
        this.dependencies.logger?.debug('session', 'hallucination segment dropped', segment);
      }
    }
  }

  private handleLockedNoteClosed(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      return;
    }

    this.dependencies.notice('Dictation stopped — locked note was closed');
    void this.stopDictation();
  }

  private handleLockedNoteDeleted(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      return;
    }

    this.dependencies.notice('Dictation cancelled — locked note was deleted');
    void this.cancelDictation();
  }

  private handleError(message: string, error: unknown): void {
    this.dependencies.logger?.error('session', message, error);
    this.applyUiState('error');
    this.dependencies.notice(`${message}: ${formatErrorMessage(error)}`);
  }

  private async abortSessionAfterError(sessionId: string): Promise<void> {
    if (this.abortingSessionId === sessionId) {
      return;
    }

    this.abortingSessionId = sessionId;

    try {
      await this.dependencies.sidecarConnection.cancelSession(sessionId);
    } catch (error) {
      this.dependencies.logger?.warn(
        'session',
        'failed to cancel an errored session cleanly',
        error,
      );

      if (this.sessionId === sessionId) {
        await this.cleanupLocalSession();
      }
    } finally {
      if (this.abortingSessionId === sessionId) {
        this.abortingSessionId = null;
      }
    }
  }

  private requireSelectedModel(
    settings: PluginSettings,
  ): NonNullable<PluginSettings['selectedModel']> {
    if (settings.selectedModel !== null) {
      return settings.selectedModel;
    }

    throw new Error('Select a Local Dictation model before starting dictation.');
  }
}

function createSessionId(): string {
  return `session-${randomUUID()}`;
}

function resolveLlmPostprocessSnapshot(settings: PluginSettings): LlmPostprocessConfig | null {
  const model = settings.llmPostprocessModel.trim();

  if (
    !settings.llmFeaturesEnabled ||
    settings.llmPostprocessMode !== 'per_utterance' ||
    settings.showTimestamps ||
    model.length === 0
  ) {
    return null;
  }

  return {
    keepAlive: OLLAMA_KEEP_ALIVE,
    model,
    noteContextChars: settings.llmPostprocessNoteContextChars,
    priorUtterancesN: settings.llmPostprocessPriorUtterancesN,
    prompt: settings.llmPostprocessPrompt,
    showRawBelow: settings.llmPostprocessShowRawBelow,
    skipMinWords: settings.llmPostprocessSkipMinWords,
    temperature: settings.llmPostprocessTemperature,
    totalContextCap: settings.llmPostprocessTotalContextCap,
  };
}

function shouldRunBatchCleanup(
  snapshot: ActiveSessionSnapshot,
  reason: Extract<SidecarEvent, { type: 'session_stopped' }>['reason'],
): boolean {
  if (!snapshot.llmFeaturesEnabled || snapshot.llmPostprocessMode !== 'batch') {
    return false;
  }

  return reason === 'user_stop' || reason === 'sentence_complete';
}

function isAnchorVisibleSessionState(state: SessionState): boolean {
  return state === 'speech_detected' || state === 'speech_ending' || state === 'transcribing';
}

function shouldAppendRawLlmPostprocessCallout(
  event: TranscriptReadyEvent,
  snapshot: ActiveSessionSnapshot | null,
): boolean {
  if (snapshot?.llmPostprocess?.showRawBelow !== true || event.llmPostprocessRawText === null) {
    return false;
  }

  return event.stageResults.some(
    (stage) => stage.stageId === 'llm_postprocess' && stage.status.kind === 'ok',
  );
}

function enforceLlmContextCap(
  sources: ContextWindowSource[],
  totalContextCap: number,
): ContextWindowSource[] {
  if (totalContextCap <= 0) {
    return [];
  }

  const result = sources.map((source) => ({ ...source }));

  for (const kind of ['note_text', 'prior_utterance'] as const) {
    while (totalSourceChars(result) > totalContextCap) {
      const index = result.findIndex((source) => source.kind === kind && source.text.length > 0);
      if (index < 0) {
        break;
      }

      const source = result[index];
      if (source === undefined) {
        break;
      }
      const overflow = totalSourceChars(result) - totalContextCap;
      const nextMaxChars = Math.max(0, source.text.length - overflow);
      const truncated = truncateLeadingText(source.text, nextMaxChars);
      result[index] = {
        ...source,
        text: truncated.text,
        truncated: true,
      };
    }
  }

  return result.filter(
    (source) => source.text.trim().length > 0 || source.kind === 'note_glossary',
  );
}

function totalSourceChars(sources: readonly ContextWindowSource[]): number {
  return sources.reduce((sum, source) => sum + source.text.length, 0);
}
