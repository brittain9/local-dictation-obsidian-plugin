import { randomUUID } from 'node:crypto';

import type { AudioCaptureStream } from '../audio/audio-capture-stream';
import type { NotePlacementOptions } from '../editor/note-surface';
import { OLLAMA_KEEP_ALIVE } from '../llm/ollama-client';
import { type LlmPostprocessMode, resolveStyleOption } from '../llm/presets';
import type { Session } from '../session/session';
import type { StageId } from '../session/session-journal';
import type { PluginSettings } from '../settings/plugin-settings';
import { formatErrorMessage } from '../shared/format-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import { truncateLeadingText } from '../shared/text-truncation';
import type {
  BatchCleanupReadyEvent,
  ContextRequestEvent,
  ContextWindow,
  ContextWindowSource,
  LlmPostprocessConfig,
  QueueBackpressureTier,
  SessionState,
  SidecarEvent,
  TranscriptReadyEvent,
} from '../sidecar/protocol';
import { type SidecarConnection, SidecarError } from '../sidecar/sidecar-connection';
import { SidecarNotInstalledError } from '../sidecar/sidecar-paths';
import type { TranscriptRenderOptions } from '../transcript/renderer';

export type DictationControllerState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'speech_detected'
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
  speakingStyle: PluginSettings['speakingStyle'];
  timestamps: TranscriptRenderOptions['timestamps'];
  transcriptFormatting: PluginSettings['transcriptFormatting'];
  useNoteAsContext: PluginSettings['useNoteAsContext'];
}

type SessionPhase = 'starting' | 'active' | 'stopping' | 'cancelling' | 'stopped';

interface ManagedSession {
  anchorTimerId: ReturnType<typeof setTimeout> | null;
  llmFailureLogged: boolean;
  phase: SessionPhase;
  session: ControllerSession;
  snapshot: ActiveSessionSnapshot;
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
  onModelMissing?: () => void;
  onSidecarMissing?: () => void;
  setRibbonQueueTier: (tier: QueueBackpressureTier) => void;
  setRibbonState: (state: DictationControllerState) => void;
  sidecarConnection: Pick<
    SidecarConnection,
    | 'cancelSession'
    | 'ensureStarted'
    | 'requestBatchCleanup'
    | 'requestStopSession'
    | 'sendAudioFrame'
    | 'sendContextResponse'
    | 'startSession'
    | 'subscribe'
  >;
}

const ANCHOR_VISIBLE_DELAY_MS = 2500;
const MAX_CONTROLLER_SESSIONS = 5;

export class DictationSessionController {
  private activeSessionId: string | null = null;
  private readonly releaseSidecarSubscription: () => void;
  private readonly sessions = new Map<string, ManagedSession>();
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
    return this.activeSessionId !== null || this.sessions.size > 0 || this.state === 'starting';
  }

  async cancelDictation(): Promise<void> {
    const sessionId = this.activeSessionId ?? this.latestSessionId();

    if (sessionId === null) {
      this.dependencies.notice('Dictation is not currently active.');
      return;
    }

    await this.cancelSession(sessionId);
  }

  async dispose(): Promise<void> {
    if (this.dependencies.captureStream.isCapturing()) {
      await this.dependencies.captureStream.stop();
    }

    const sessionIds = [...this.sessions.keys()];
    await Promise.allSettled(sessionIds.map((sessionId) => this.cancelSession(sessionId)));
    this.releaseSidecarSubscription();
    for (const sessionId of [...this.sessions.keys()]) {
      this.disposeLocalSession(sessionId);
    }
    this.activeSessionId = null;
    this.resetQueueTier();
    this.applyUiState('idle');
  }

  async toggleDictation(): Promise<void> {
    if (this.state === 'error' && this.activeSessionId === null) {
      this.applyUiState('idle');
      return;
    }

    if (this.activeSessionId !== null) {
      await this.stopDictation();
      return;
    }

    if (this.sessions.size >= MAX_CONTROLLER_SESSIONS) {
      return;
    }

    await this.startDictation();
  }

  async startDictation(): Promise<void> {
    if (this.activeSessionId !== null || this.sessions.size >= MAX_CONTROLLER_SESSIONS) {
      return;
    }

    this.applyUiState('starting');

    try {
      await this.dependencies.sidecarConnection.ensureStarted();
    } catch (error) {
      if (error instanceof SidecarNotInstalledError) {
        this.dependencies.logger?.debug('sidecar', 'sidecar not installed; prompting install');
        this.applyUiState('idle');
        this.dependencies.onSidecarMissing?.();
        return;
      }
      this.handleError('Failed to start the dictation session', error);
      return;
    }

    const settings = this.dependencies.getSettings();
    if (settings.selectedModel === null) {
      this.dependencies.logger?.debug('session', 'no model selected; prompting model picker');
      this.applyUiState('idle');
      this.dependencies.onModelMissing?.();
      return;
    }

    const sessionId = createSessionId();
    const snapshot = createSessionSnapshot(settings, settings.selectedModel);
    let session: ControllerSession;

    try {
      session = this.dependencies.createSession({
        callbacks: {
          onLockedNoteClosed: () => {
            this.cancelOnLockedNoteEvent(sessionId, 'closed');
          },
          onLockedNoteDeleted: () => {
            this.cancelOnLockedNoteEvent(sessionId, 'deleted');
          },
        },
        placement: { anchor: snapshot.dictationAnchor },
        rendererOptions: {
          timestamps: snapshot.timestamps,
          transcriptFormatting: snapshot.transcriptFormatting,
        },
        sessionId,
      });
    } catch (error) {
      this.handleError('Failed to start the dictation session', error);
      return;
    }

    const entry: ManagedSession = {
      anchorTimerId: null,
      llmFailureLogged: false,
      phase: 'starting',
      session,
      snapshot,
    };
    this.sessions.set(sessionId, entry);
    this.activeSessionId = sessionId;
    this.dependencies.logger?.debug('session', `starting dictation session ${sessionId}`);

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

      if (entry.phase !== 'starting' || this.activeSessionId !== sessionId) {
        return;
      }
      entry.phase = 'active';

      // Read the saved deviceId at session-start time so a settings change
      // applies on the next dictation rather than mid-session.
      const audioInputDeviceId = this.dependencies.getSettings().audioInputDevice?.deviceId ?? null;

      await this.dependencies.captureStream.start(
        { sessionId, audioInputDeviceId },
        (frameSessionId, frameBytes) => {
          if (this.activeSessionId !== frameSessionId) {
            return;
          }

          const activeEntry = this.sessions.get(frameSessionId);
          if (activeEntry === undefined || activeEntry.phase !== 'active') {
            return;
          }

          try {
            this.dependencies.sidecarConnection.sendAudioFrame(frameSessionId, frameBytes);
          } catch (error) {
            this.dependencies.logger?.warn(
              'session',
              'stopping audio capture: sidecar rejected an audio frame',
              error,
            );
            void this.cancelSession(frameSessionId);
          }
        },
      );

      if (this.activeSessionId === sessionId) {
        this.applyUiState('listening');
      } else if (this.dependencies.captureStream.isCapturing()) {
        await this.dependencies.captureStream.stop();
      }
    } catch (error) {
      await this.cleanupFailedStart(sessionId, error);
    }
  }

  async stopDictation(): Promise<void> {
    const sessionId = this.activeSessionId;

    if (sessionId === null) {
      this.dependencies.notice('Dictation is not currently active.');
      return;
    }

    const entry = this.sessions.get(sessionId);
    if (entry !== undefined) {
      entry.phase = 'stopping';
      this.clearAnchorTimer(entry);
      entry.session.setAnchorMode('hidden');
    }

    await this.clearActiveSession(sessionId);

    try {
      this.dependencies.sidecarConnection.requestStopSession(sessionId);
    } catch (error) {
      this.disposeLocalSession(sessionId);
      this.handleError('Failed to stop the dictation session', error);
    }
  }

  private async cleanupFailedStart(sessionId: string, error: unknown): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
        this.applyUiState('idle');
      }
      return;
    }

    if (isCapacityExceededStartError(error)) {
      this.dependencies.logger?.warn('sidecar', formatErrorMessage(error));
      this.disposeLocalSession(sessionId);
      return;
    }

    if (entry.phase === 'starting') {
      this.disposeLocalSession(sessionId);
    } else {
      await this.cancelSession(sessionId);
    }
    this.handleError('Failed to start the dictation session', error);
  }

  private async cancelSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry !== undefined) {
      entry.phase = 'cancelling';
    }

    await this.clearActiveSession(sessionId);

    try {
      await this.dependencies.sidecarConnection.cancelSession(sessionId);
    } catch (error) {
      this.dependencies.logger?.warn('session', 'failed to cancel dictation cleanly', error);
      this.disposeLocalSession(sessionId);
    }
  }

  private async clearActiveSession(sessionId: string): Promise<void> {
    if (this.activeSessionId !== sessionId) {
      return;
    }
    this.activeSessionId = null;
    this.applyUiState('idle');
    this.resetQueueTier();
    if (this.dependencies.captureStream.isCapturing()) {
      await this.dependencies.captureStream.stop();
    }
  }

  private applyUiState(state: DictationControllerState): void {
    this.state = state;
    this.dependencies.setRibbonState(state);
  }

  private latestSessionId(): string | null {
    return [...this.sessions.keys()].at(-1) ?? null;
  }

  private disposeLocalSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return;
    }

    this.clearAnchorTimer(entry);
    entry.session.clearSessionProcessingMark();
    entry.session.dispose();
    this.sessions.delete(sessionId);

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
      this.applyUiState('idle');
      this.resetQueueTier();
    }
  }

  private applySessionStateToAnchor(entry: ManagedSession, state: SessionState): void {
    if (!isAnchorVisibleSessionState(state)) {
      this.clearAnchorTimer(entry);
      entry.session.setAnchorMode('hidden');
      return;
    }

    if (entry.anchorTimerId !== null) {
      return;
    }

    const timerId = setTimeout(() => {
      if (entry.anchorTimerId !== timerId) {
        return;
      }

      entry.session.setAnchorMode('visible');
    }, ANCHOR_VISIBLE_DELAY_MS);

    entry.anchorTimerId = timerId;
  }

  private clearAnchorTimer(entry: ManagedSession): void {
    if (entry.anchorTimerId !== null) {
      clearTimeout(entry.anchorTimerId);
      entry.anchorTimerId = null;
    }
  }

  private async handleSidecarEvent(event: SidecarEvent): Promise<void> {
    switch (event.type) {
      case 'health_ok':
      case 'system_info':
        return;

      case 'session_started':
        return;

      case 'session_state_changed':
        this.handleSessionStateChanged(event);
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

      case 'batch_cleanup_ready':
        this.handleBatchCleanupReady(event);
        return;

      case 'warning':
        this.dependencies.logger?.warn('sidecar', event.message, event.details);
        return;

      case 'session_stopped':
        this.handleSessionStopped(event);
        return;

      case 'error':
        await this.handleErrorEvent(event);
        return;
    }
  }

  private handleSessionStateChanged(
    event: Extract<SidecarEvent, { type: 'session_state_changed' }>,
  ): void {
    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    this.applySessionStateToAnchor(entry, event.state);

    if (
      event.sessionId !== this.activeSessionId ||
      entry.phase !== 'active' ||
      !this.dependencies.captureStream.isCapturing()
    ) {
      return;
    }

    const nextState = toCaptureUiState(event.state);
    if (nextState !== null) {
      this.applyUiState(nextState);
    }
  }

  private handleQueueTierChange(
    event: Extract<SidecarEvent, { type: 'transcription_queue_changed' }>,
  ): void {
    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    if (event.sessionId === this.activeSessionId) {
      this.dependencies.setRibbonQueueTier(event.tier);
    }
  }

  private resetQueueTier(): void {
    this.dependencies.setRibbonQueueTier('normal');
  }

  private handleContextRequest(event: ContextRequestEvent): void {
    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    const context = this.buildContextWindow(entry, event.budgetChars);

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

  private buildContextWindow(entry: ManagedSession, budgetChars: number): ContextWindow | null {
    const sources: ContextWindowSource[] = [];
    let promptText = '';

    if (entry.snapshot.useNoteAsContext) {
      const glossary = entry.session.readNoteGlossary(Math.min(384, budgetChars));
      if (glossary !== null) {
        sources.push({
          kind: 'note_glossary',
          text: glossary.text,
          truncated: glossary.truncated,
        });
        promptText = glossary.text;
      }
    }

    if (entry.snapshot.llmPostprocess !== null) {
      sources.push(...this.buildLlmContextSources(entry, entry.snapshot.llmPostprocess));
    }

    if (sources.length === 0) {
      return null;
    }

    return {
      budgetChars,
      sources,
      text: promptText,
      truncated: sources.some((source) => source.truncated),
    };
  }

  private buildLlmContextSources(
    entry: ManagedSession,
    config: LlmPostprocessConfig,
  ): ContextWindowSource[] {
    const sources: ContextWindowSource[] = [];
    const noteText =
      config.noteContextChars > 0 ? entry.session.readNoteText(config.noteContextChars) : null;

    if (noteText !== null) {
      sources.push({ kind: 'note_text', text: noteText.text, truncated: noteText.truncated });
    }

    const priorUtteranceBudget =
      config.priorUtterancesN > 0
        ? Math.max(1, Math.ceil(config.totalContextCap / config.priorUtterancesN))
        : 0;
    for (const utterance of entry.session.readPriorUtterances(
      config.priorUtterancesN,
      priorUtteranceBudget,
    )) {
      sources.push({
        kind: 'prior_utterance',
        text: utterance.text,
        truncated: utterance.truncated,
      });
    }

    return enforceLlmContextCap(sources, config.totalContextCap);
  }

  private async handleTranscriptReady(event: TranscriptReadyEvent): Promise<void> {
    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    this.dependencies.logger?.debug(
      'session',
      `transcript received (${event.text.length} chars, ${event.processingDurationMs}ms processing)`,
    );

    for (const warning of event.warnings) {
      this.dependencies.logger?.debug(
        'session',
        `capability gate dropped "${warning.field}": ${warning.reason}`,
      );
    }
    this.logDroppedHallucinations(event);
    this.maybeLogLlmStageFailure(entry, event);

    const result = entry.session.acceptTranscript({
      isFinal: event.isFinal,
      llmPostprocessRawText: shouldAppendRawLlmPostprocessCallout(event, entry.snapshot)
        ? event.llmPostprocessRawText
        : null,
      pauseMsBeforeUtterance: event.pauseMsBeforeUtterance,
      revision: event.revision,
      segments: event.segments,
      sessionId: event.sessionId,
      stageResults: event.stageResults,
      text: event.text.trim(),
      utteranceEndMsInSession: event.utteranceEndMsInSession,
      utteranceId: event.utteranceId,
      utteranceIndex: event.utteranceIndex,
      utteranceStartMsInSession: event.utteranceStartMsInSession,
    });

    if (result.kind === 'rejected') {
      this.handleError('Failed to record the local transcript', new Error(result.reason));
      await this.cancelSession(event.sessionId);
    }
  }

  private handleSessionStopped(event: Extract<SidecarEvent, { type: 'session_stopped' }>): void {
    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    this.dependencies.logger?.debug(
      'session',
      `session ${event.sessionId} stopped (reason: ${event.reason})`,
    );
    entry.phase = 'stopped';

    if (event.sessionId === this.activeSessionId) {
      this.activeSessionId = null;
      this.applyUiState('idle');
      this.resetQueueTier();
    }

    if (shouldRunBatchCleanup(entry.snapshot, event.reason)) {
      this.requestBatchCleanup(event.sessionId, entry);
      return;
    }

    this.disposeLocalSession(event.sessionId);
  }

  private requestBatchCleanup(sessionId: string, entry: ManagedSession): void {
    const config = resolveBatchLlmPostprocessConfig(entry.snapshot);
    const transcriptText = entry.session.readCurrentSessionText();

    if (config === null || transcriptText.length === 0) {
      if (config !== null) {
        this.dependencies.logger?.warn(
          'llm',
          'batch cleanup skipped: locked note closed before transcript could be read',
        );
      }
      this.disposeLocalSession(sessionId);
      return;
    }

    const noteContext =
      entry.snapshot.llmPostprocessNoteContextChars > 0
        ? (entry.session.readNoteText(entry.snapshot.llmPostprocessNoteContextChars)?.text ?? null)
        : null;

    entry.session.markSessionRangeAsProcessing();
    try {
      this.dependencies.sidecarConnection.requestBatchCleanup({
        config,
        noteContext,
        sessionId,
        transcriptText,
      });
    } catch (error) {
      this.dependencies.logger?.warn(
        'llm',
        `batch cleanup request failed; raw transcript kept: ${formatErrorMessage(error)}`,
        error,
      );
      entry.session.clearSessionProcessingMark();
      this.disposeLocalSession(sessionId);
    }
  }

  private handleBatchCleanupReady(event: BatchCleanupReadyEvent): void {
    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    entry.session.clearSessionProcessingMark();

    const cleanText = event.cleanText.trim();
    if (cleanText.length === 0) {
      this.dependencies.logger?.debug('llm', 'batch cleanup returned empty text');
      this.disposeLocalSession(event.sessionId);
      return;
    }

    const replaced = entry.session.replaceSessionRangeWithCleaned(cleanText, {
      rawTextForCallout: event.rawText,
      showRawBelow: entry.snapshot.llmPostprocessShowRawBelow,
    });

    if (!replaced) {
      this.dependencies.logger?.warn(
        'llm',
        'batch cleanup replacement skipped; session range no longer available',
      );
    } else {
      this.dependencies.logger?.debug('llm', 'batch cleanup complete', {
        chars: cleanText.length,
      });
    }

    this.disposeLocalSession(event.sessionId);
  }

  private async handleErrorEvent(event: Extract<SidecarEvent, { type: 'error' }>): Promise<void> {
    if (event.code === 'session_capacity_exceeded' && event.sessionId !== undefined) {
      this.dependencies.logger?.warn('sidecar', event.message, event.details);
      await this.clearActiveSession(event.sessionId);
      this.disposeLocalSession(event.sessionId);
      return;
    }

    if (event.code === 'batch_cleanup_failed' && event.sessionId !== undefined) {
      const entry = this.sessions.get(event.sessionId);
      if (entry !== undefined) {
        entry.session.clearSessionProcessingMark();
        this.dependencies.logger?.warn(
          'llm',
          `batch cleanup failed; raw transcript kept: ${event.details ?? event.message}`,
        );
        this.disposeLocalSession(event.sessionId);
      }
      return;
    }

    const detail = event.details ? `${event.message} (${event.details})` : event.message;

    if (event.sessionId === undefined) {
      this.handleError('Local Dictation sidecar error', detail);
      return;
    }

    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    if (event.sessionId === this.activeSessionId) {
      this.applyUiState('error');
      this.dependencies.notice(`Local Dictation: ${detail}`);
    } else {
      this.dependencies.logger?.warn('session', detail);
    }

    await this.cancelSession(event.sessionId);
  }

  private maybeLogLlmStageFailure(entry: ManagedSession, event: TranscriptReadyEvent): void {
    if (entry.llmFailureLogged) {
      return;
    }
    const failed = event.stageResults.find(
      (stage) => stage.stageId === 'llm_postprocess' && stage.status.kind === 'failed',
    );
    if (failed === undefined || failed.status.kind !== 'failed') {
      return;
    }
    entry.llmFailureLogged = true;
    this.dependencies.logger?.warn(
      'llm',
      `per-utterance LLM transform failed: ${failed.status.error}`,
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

  private cancelOnLockedNoteEvent(sessionId: string, reason: 'closed' | 'deleted'): void {
    if (!this.sessions.has(sessionId)) {
      return;
    }

    this.dependencies.logger?.warn('session', `locked note ${reason} for session ${sessionId}`);
    void this.cancelSession(sessionId);
  }

  private handleError(message: string, error: unknown): void {
    this.dependencies.logger?.error('session', message, error);
    this.applyUiState('error');
    this.dependencies.notice(`${message}: ${formatErrorMessage(error)}`);
  }
}

function createSessionId(): string {
  return randomUUID();
}

function isCapacityExceededStartError(error: unknown): boolean {
  return error instanceof SidecarError && error.code === 'session_capacity_exceeded';
}

function createSessionSnapshot(
  settings: PluginSettings,
  selectedModel: NonNullable<PluginSettings['selectedModel']>,
): ActiveSessionSnapshot {
  const effectiveGeneration = resolveActiveGenerationDefaults(settings);
  const sessionStartUnixMs = Date.now();
  const noteContextChars = settings.useLlmNoteContext ? settings.llmPostprocessNoteContextChars : 0;

  return {
    accelerationPreference: settings.accelerationPreference,
    dictationAnchor: settings.dictationAnchor,
    listeningMode: settings.listeningMode,
    llmFeaturesEnabled: settings.llmFeaturesEnabled,
    llmPostprocess: resolveLlmPostprocessSnapshot(settings, noteContextChars),
    llmPostprocessMode: settings.llmPostprocessMode,
    llmPostprocessModel: settings.llmPostprocessModel,
    llmPostprocessNoteContextChars: noteContextChars,
    llmPostprocessPrompt: settings.llmPostprocessPrompt,
    llmPostprocessShowRawBelow: settings.llmPostprocessShowRawBelow,
    llmPostprocessTemperature: effectiveGeneration.temperature,
    modelSelection: selectedModel,
    modelStorePathOverride: settings.modelStorePathOverride,
    sessionStartUnixMs,
    speakingStyle: settings.speakingStyle,
    timestamps: {
      clock: settings.timestampClock,
      density: settings.timestampDensity,
      enabled: settings.timestampsEnabled,
      header: settings.timestampSessionHeader,
      sessionStartUnixMs,
      sparseIntervalMs: settings.timestampSparseIntervalMs,
    },
    transcriptFormatting: settings.transcriptFormatting,
    useNoteAsContext: settings.useNoteAsContext,
  };
}

function resolveLlmPostprocessSnapshot(
  settings: PluginSettings,
  noteContextChars: number,
): LlmPostprocessConfig | null {
  const model = settings.llmPostprocessModel.trim();

  if (
    !settings.llmFeaturesEnabled ||
    settings.llmPostprocessMode !== 'per_utterance' ||
    model.length === 0
  ) {
    return null;
  }

  const { skipMinWords, temperature } = resolveActiveGenerationDefaults(settings);

  return {
    keepAlive: OLLAMA_KEEP_ALIVE,
    model,
    noteContextChars,
    priorUtterancesN: settings.llmPostprocessPriorUtterancesN,
    prompt: settings.llmPostprocessPrompt,
    showRawBelow: settings.llmPostprocessShowRawBelow,
    skipMinWords,
    temperature,
    totalContextCap: settings.llmPostprocessTotalContextCap,
  };
}

function resolveBatchLlmPostprocessConfig(
  snapshot: ActiveSessionSnapshot,
): LlmPostprocessConfig | null {
  const model = snapshot.llmPostprocessModel.trim();

  if (
    !snapshot.llmFeaturesEnabled ||
    snapshot.llmPostprocessMode !== 'batch' ||
    model.length === 0
  ) {
    return null;
  }

  return {
    keepAlive: OLLAMA_KEEP_ALIVE,
    model,
    noteContextChars: snapshot.llmPostprocessNoteContextChars,
    priorUtterancesN: 0,
    prompt: snapshot.llmPostprocessPrompt,
    showRawBelow: snapshot.llmPostprocessShowRawBelow,
    skipMinWords: 0,
    temperature: snapshot.llmPostprocessTemperature,
    totalContextCap: snapshot.llmPostprocessNoteContextChars,
  };
}

function resolveActiveGenerationDefaults(settings: PluginSettings): {
  skipMinWords: number;
  temperature: number;
} {
  const activeOption = resolveStyleOption(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );
  return {
    skipMinWords: activeOption?.minWords ?? settings.llmPostprocessSkipMinWords,
    temperature: activeOption?.temperature ?? settings.llmPostprocessTemperature,
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

function toCaptureUiState(state: SessionState): DictationControllerState | null {
  switch (state) {
    case 'speech_detected':
    case 'speech_ending':
      return 'speech_detected';
    case 'listening':
    case 'transcribing':
    case 'idle':
      return 'listening';
    case 'error':
      return 'error';
  }
}

function shouldAppendRawLlmPostprocessCallout(
  event: TranscriptReadyEvent,
  snapshot: ActiveSessionSnapshot,
): boolean {
  if (snapshot.llmPostprocess?.showRawBelow !== true || event.llmPostprocessRawText === null) {
    return false;
  }

  return event.stageResults.some(
    (stage) => stage.stageId === 'llm_postprocess' && stage.status.kind === 'ok',
  );
}

export function enforceLlmContextCap(
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
