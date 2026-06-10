import { randomUUID } from 'node:crypto';

import type { AudioCaptureStream } from '../audio/audio-capture-stream';
import { formatMicrophonePermissionDeniedMessage } from '../audio/microphone-permission-message';
import type { NotePlacementOptions } from '../editor/note-surface';
import {
  type LlmPostprocessMode,
  type LlmPresetOutput,
  resolveActivePresetEntry,
  resolveEffectiveLlmGlobals,
} from '../llm/presets';
import { type LlmCleanupFailure, type LlmProviderId, ProviderError } from '../llm/provider';
import type { LlmRouter } from '../llm/router';
import type { Session } from '../session/session';
import type { StageId, StageOutcome, TranscriptRevision } from '../session/session-journal';
import type { PluginSettings } from '../settings/plugin-settings';
import { formatErrorMessage } from '../shared/format-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import { truncateLeadingText } from '../shared/text-truncation';
import type {
  ContextRequestEvent,
  ContextWindow,
  ContextWindowSource,
  QueueBackpressureTier,
  SessionState,
  SidecarEvent,
  TranscriptReadyEvent,
} from '../sidecar/protocol';
import { type SidecarConnection, SidecarError } from '../sidecar/sidecar-connection';
import { SidecarNotInstalledError } from '../sidecar/sidecar-paths';
import type { TranscriptRenderOptions } from '../transcript/renderer';

export interface ProviderContextSource {
  kind: 'note_text' | 'prior_utterance';
  text: string;
  truncated: boolean;
}

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
  | 'insertAdjacentToSessionRange'
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
  llmRouter: LlmRouter;
  llmPostprocessMode: LlmPostprocessMode;
  llmPostprocessNoteContextChars: PluginSettings['llmPostprocessNoteContextChars'];
  llmPostprocessOutput: LlmPresetOutput;
  llmPostprocessPrompt: string;
  llmPostprocessPriorUtterancesN: PluginSettings['llmPostprocessPriorUtterancesN'];
  llmPostprocessShowRawBelow: PluginSettings['llmPostprocessShowRawBelow'];
  llmPostprocessSkipMinWords: PluginSettings['llmPostprocessSkipMinWords'];
  llmPostprocessTemperature: PluginSettings['llmPostprocessTemperature'];
  llmPostprocessTotalContextCap: PluginSettings['llmPostprocessTotalContextCap'];
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
  anchorTimerId: number | null;
  // Per-session FIFO: per-utterance cleanups run concurrently but their
  // accept() must land in utterance order, so each transcript's cleanup+accept
  // chains on the previous one's completion.
  cleanupChain: Promise<void>;
  cleanupAbortControllers: Set<AbortController>;
  llmFailureLogged: boolean;
  pendingTranscriptWork: Set<Promise<void>>;
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
  createLlmRouter: (settings: PluginSettings) => LlmRouter;
  getSettings: () => PluginSettings;
  logger?: PluginLogger;
  notice: (message: string) => void;
  onLlmCleanupFailure?: (failure: LlmCleanupFailure) => void;
  onLlmCleanupSuccess?: () => void;
  onModelMissing?: () => void;
  onSidecarMissing?: () => void;
  setRibbonQueueTier: (tier: QueueBackpressureTier) => void;
  setRibbonState: (state: DictationControllerState) => void;
  sidecarConnection: Pick<
    SidecarConnection,
    | 'cancelSession'
    | 'ensureStarted'
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
    const snapshot = createSessionSnapshot(
      settings,
      settings.selectedModel,
      this.dependencies.createLlmRouter(settings),
    );
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
      cleanupChain: Promise.resolve(),
      cleanupAbortControllers: new Set(),
      llmFailureLogged: false,
      pendingTranscriptWork: new Set(),
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
      // Keep the cursor where text will land while queued transcripts drain.
      // It is cleared when the session is finally disposed (after the drain),
      // and the anchor timer is cleaned up there too.
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
      this.abortProviderCleanups(entry);
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
    this.abortProviderCleanups(entry);
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

    const timerId = window.setTimeout(() => {
      if (entry.anchorTimerId !== timerId) {
        return;
      }

      entry.session.setAnchorMode('visible');
    }, ANCHOR_VISIBLE_DELAY_MS);

    entry.anchorTimerId = timerId;
  }

  private clearAnchorTimer(entry: ManagedSession): void {
    if (entry.anchorTimerId !== null) {
      window.clearTimeout(entry.anchorTimerId);
      entry.anchorTimerId = null;
    }
  }

  private abortProviderCleanups(entry: ManagedSession): void {
    for (const controller of entry.cleanupAbortControllers) {
      controller.abort();
    }
    entry.cleanupAbortControllers.clear();
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
    // The wire window now carries only the spelling glossary for the engine's
    // initial prompt; LLM-prompt context (note_text/prior_utterance) is built
    // TS-side in `buildProviderCleanupContextSources`, never sent to the sidecar.
    if (!entry.snapshot.useNoteAsContext) {
      return null;
    }

    const glossary = entry.session.readNoteGlossary(Math.min(384, budgetChars));
    if (glossary === null) {
      return null;
    }

    const sources: ContextWindowSource[] = [
      { kind: 'note_glossary', text: glossary.text, truncated: glossary.truncated },
    ];

    return {
      budgetChars,
      sources,
      text: glossary.text,
      truncated: glossary.truncated,
    };
  }

  private async handleTranscriptReady(event: TranscriptReadyEvent): Promise<void> {
    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    const work = this.processTranscriptReady(entry, event);
    entry.pendingTranscriptWork.add(work);
    try {
      await work;
    } catch (error) {
      // processTranscriptReady handles cleanup failures itself; this guards the
      // rare case where acceptTranscript throws, so it cannot escape as an
      // unhandled rejection from the void-ed sidecar event handler.
      this.dependencies.logger?.error('session', 'failed to process transcript', error);
    } finally {
      entry.pendingTranscriptWork.delete(work);
    }
  }

  private async processTranscriptReady(
    entry: ManagedSession,
    event: TranscriptReadyEvent,
  ): Promise<void> {
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

    // The cleanup network call runs concurrently with later utterances for
    // throughput, but accept() is serialized through the per-session FIFO so
    // out-of-order remote completions still land in utterance order.
    const revisionPromise = this.resolveTranscriptRevision(entry, event);
    const accept = entry.cleanupChain.then(async () => {
      const revision = await revisionPromise;
      if (revision === null || !this.sessions.has(event.sessionId)) {
        return;
      }
      const result = entry.session.acceptTranscript(revision);
      if (result.kind === 'rejected') {
        this.handleError('Failed to record the local transcript', new Error(result.reason));
        await this.cancelSession(event.sessionId);
      }
    });
    entry.cleanupChain = accept.catch(() => {});
    await accept;
  }

  private async resolveTranscriptRevision(
    entry: ManagedSession,
    event: TranscriptReadyEvent,
  ): Promise<TranscriptRevision | null> {
    const baseRevision = toTranscriptRevision(event);

    if (!shouldRunProviderPerUtteranceCleanup(entry.snapshot, event)) {
      return baseRevision;
    }

    const rawText = event.text.trim();
    const userMessage = renderProviderUserMessage(
      this.buildProviderCleanupContextSources(entry),
      rawText,
    );
    const providerId = entry.snapshot.llmRouter.selectProviderId(userMessage.length);
    const startedAt = Date.now();
    const abortController = new AbortController();
    entry.cleanupAbortControllers.add(abortController);

    try {
      const result = await entry.snapshot.llmRouter.cleanup({
        abortSignal: abortController.signal,
        prompt: entry.snapshot.llmPostprocessPrompt,
        temperature: entry.snapshot.llmPostprocessTemperature,
        transcriptChars: rawText.length,
        userMessage,
      });

      if (abortController.signal.aborted || !this.sessions.has(event.sessionId)) {
        return null;
      }

      const cleanedText = result.text.trim();
      if (cleanedText.length === 0) {
        // An empty replacement would silently delete the spoken words from the
        // note; keep the raw utterance and surface a failure instead.
        throw new ProviderError('Provider returned empty cleaned text.', 'invalid_response');
      }

      this.dependencies.onLlmCleanupSuccess?.();

      return {
        ...baseRevision,
        llmPostprocessRawText: entry.snapshot.llmPostprocessShowRawBelow ? rawText : null,
        stageResults: [
          ...baseRevision.stageResults,
          createProviderStageOutcome({
            durationMs: Date.now() - startedAt,
            isFinal: event.isFinal,
            model: result.model,
            providerId: result.providerId,
            revision: event.revision,
            status: { kind: 'ok' },
          }),
        ],
        text: cleanedText,
      };
    } catch (error) {
      if (abortController.signal.aborted || !this.sessions.has(event.sessionId)) {
        return null;
      }

      const failedId = failedProviderId(error, providerId);
      const failure = this.handleProviderCleanupFailure(failedId, error);
      this.maybeLogLlmStageFailure(entry, failure.message);
      return {
        ...baseRevision,
        stageResults: [
          ...baseRevision.stageResults,
          createProviderStageOutcome({
            durationMs: Date.now() - startedAt,
            isFinal: event.isFinal,
            model: '',
            providerId: failedId,
            revision: event.revision,
            status: { error: failure.message, kind: 'failed' },
          }),
        ],
      };
    } finally {
      entry.cleanupAbortControllers.delete(abortController);
    }
  }

  private buildProviderCleanupContextSources(entry: ManagedSession): ProviderContextSource[] {
    const sources: ProviderContextSource[] = [];

    if (entry.snapshot.llmPostprocessNoteContextChars > 0) {
      const noteText = entry.session.readNoteText(entry.snapshot.llmPostprocessNoteContextChars);
      if (noteText !== null) {
        sources.push({ kind: 'note_text', text: noteText.text, truncated: noteText.truncated });
      }
    }

    const priorUtteranceBudget =
      entry.snapshot.llmPostprocessPriorUtterancesN > 0
        ? Math.max(
            1,
            Math.ceil(
              entry.snapshot.llmPostprocessTotalContextCap /
                entry.snapshot.llmPostprocessPriorUtterancesN,
            ),
          )
        : 0;
    for (const utterance of entry.session.readPriorUtterances(
      entry.snapshot.llmPostprocessPriorUtterancesN,
      priorUtteranceBudget,
    )) {
      sources.push({
        kind: 'prior_utterance',
        text: utterance.text,
        truncated: utterance.truncated,
      });
    }

    return enforceLlmContextCap(sources, entry.snapshot.llmPostprocessTotalContextCap);
  }

  private handleProviderCleanupFailure(
    providerId: LlmProviderId,
    error: unknown,
  ): LlmCleanupFailure {
    const providerError = normalizeProviderError(error);
    const failure: LlmCleanupFailure = {
      code: providerError.code,
      message: providerError.message,
      providerId,
    };

    this.dependencies.logger?.warn(
      'llm',
      `${providerId} cleanup failed; raw transcript kept: ${failure.message}`,
      error,
    );
    this.dependencies.onLlmCleanupFailure?.(failure);

    return failure;
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
      void this.runBatchCleanup(event.sessionId, entry);
      return;
    }

    void this.disposeAfterPendingWork(event.sessionId, entry);
  }

  private async drainPendingTranscriptWork(entry: ManagedSession): Promise<void> {
    while (entry.pendingTranscriptWork.size > 0) {
      await Promise.allSettled([...entry.pendingTranscriptWork]);
    }
  }

  private async disposeAfterPendingWork(sessionId: string, entry: ManagedSession): Promise<void> {
    if (entry.pendingTranscriptWork.size > 0) {
      await this.drainPendingTranscriptWork(entry);
    }
    if (this.sessions.get(sessionId) === entry) {
      this.disposeLocalSession(sessionId);
    }
  }

  private async runBatchCleanup(sessionId: string, entry: ManagedSession): Promise<void> {
    // The sidecar can emit the final transcript_ready and session_stopped in the
    // same I/O chunk, so drain in-flight per-utterance accepts before reading the
    // transcript — otherwise the batch rewrite would miss the last utterance(s).
    if (entry.pendingTranscriptWork.size > 0) {
      await this.drainPendingTranscriptWork(entry);
      if (this.sessions.get(sessionId) !== entry) {
        return;
      }
    }

    const transcriptText = entry.session.readCurrentSessionText();

    if (transcriptText.length === 0) {
      this.dependencies.logger?.warn(
        'llm',
        'batch cleanup skipped: locked note closed before transcript could be read',
      );
      this.disposeLocalSession(sessionId);
      return;
    }

    const noteContext =
      entry.snapshot.llmPostprocessNoteContextChars > 0
        ? (entry.session.readNoteText(entry.snapshot.llmPostprocessNoteContextChars)?.text ?? null)
        : null;
    const userMessage = renderBatchProviderUserMessage(noteContext, transcriptText);
    const providerId = entry.snapshot.llmRouter.selectProviderId(userMessage.length);

    // The flashing processing range is now the "working" indicator, so the
    // cursor steps aside for the batch rewrite.
    entry.session.setAnchorMode('hidden');
    entry.session.markSessionRangeAsProcessing();

    const abortController = new AbortController();
    entry.cleanupAbortControllers.add(abortController);

    try {
      const result = await entry.snapshot.llmRouter.cleanup({
        abortSignal: abortController.signal,
        prompt: entry.snapshot.llmPostprocessPrompt,
        temperature: entry.snapshot.llmPostprocessTemperature,
        transcriptChars: transcriptText.length,
        userMessage,
      });

      if (abortController.signal.aborted) {
        if (this.sessions.get(sessionId) === entry) {
          entry.session.clearSessionProcessingMark();
          this.disposeLocalSession(sessionId);
        }
        return;
      }
      if (!this.sessions.has(sessionId)) {
        return;
      }

      entry.session.clearSessionProcessingMark();

      this.applyBatchCleanupResult(entry, result.text.trim(), transcriptText);
      this.dependencies.onLlmCleanupSuccess?.();
      this.disposeLocalSession(sessionId);
    } catch (error) {
      if (abortController.signal.aborted) {
        if (this.sessions.get(sessionId) === entry) {
          entry.session.clearSessionProcessingMark();
          this.disposeLocalSession(sessionId);
        }
        return;
      }
      if (!this.sessions.has(sessionId)) {
        return;
      }

      this.handleProviderCleanupFailure(failedProviderId(error, providerId), error);
      entry.session.clearSessionProcessingMark();
      this.disposeLocalSession(sessionId);
    } finally {
      entry.cleanupAbortControllers.delete(abortController);
    }
  }

  // Applies a batch result per the preset's output behavior: replace rewrites
  // the session range, add_above/add_below insert next to the untouched
  // transcript. Throws ProviderError for an empty replace result so the caller's
  // failure path keeps the raw text.
  private applyBatchCleanupResult(
    entry: ManagedSession,
    cleanedText: string,
    transcriptText: string,
  ): void {
    if (entry.snapshot.llmPostprocessOutput === 'replace') {
      if (cleanedText.length === 0) {
        throw new ProviderError('Provider returned empty cleaned text.', 'invalid_response');
      }

      const replaced = entry.session.replaceSessionRangeWithCleaned(cleanedText, {
        rawTextForCallout: transcriptText,
        showRawBelow: entry.snapshot.llmPostprocessShowRawBelow,
      });

      if (!replaced) {
        this.dependencies.logger?.warn(
          'llm',
          'batch cleanup replacement skipped; session range no longer available',
        );
      } else {
        this.dependencies.logger?.debug('llm', 'batch cleanup complete', {
          chars: cleanedText.length,
        });
      }
      return;
    }

    if (cleanedText.length === 0) {
      // Additive presets may legitimately find nothing to add (e.g. no action
      // items), but say so — a silently failing model would otherwise look
      // like success.
      this.dependencies.notice('LLM transform returned nothing to add.');
      this.dependencies.logger?.debug(
        'llm',
        'additive batch returned empty output; nothing inserted',
      );
      return;
    }

    const placement = entry.snapshot.llmPostprocessOutput === 'add_above' ? 'above' : 'below';
    const inserted = entry.session.insertAdjacentToSessionRange(cleanedText, placement);

    if (!inserted) {
      this.dependencies.logger?.warn(
        'llm',
        'additive batch insert skipped; session range no longer available',
      );
    } else {
      this.dependencies.logger?.debug('llm', 'additive batch insert complete', {
        chars: cleanedText.length,
        placement,
      });
    }
  }

  private async handleErrorEvent(event: Extract<SidecarEvent, { type: 'error' }>): Promise<void> {
    if (event.code === 'session_capacity_exceeded' && event.sessionId !== undefined) {
      this.dependencies.logger?.warn('sidecar', event.message, event.details);
      await this.clearActiveSession(event.sessionId);
      this.disposeLocalSession(event.sessionId);
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

  private maybeLogLlmStageFailure(entry: ManagedSession, message: string): void {
    if (entry.llmFailureLogged) {
      return;
    }
    entry.llmFailureLogged = true;
    this.dependencies.logger?.warn('llm', `per-utterance LLM transform failed: ${message}`);
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

    // The microphone-permission copy is a complete, actionable sentence on its
    // own; prefixing it with the generic start-failure message just buries the
    // instructions. The Settings mic picker shows it bare for the same reason.
    if (isMicrophonePermissionDeniedError(error)) {
      this.dependencies.notice(formatMicrophonePermissionDeniedMessage());
      return;
    }

    this.dependencies.notice(`${message}: ${formatErrorMessage(error)}`);
  }
}

function isMicrophonePermissionDeniedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'NotAllowedError'
  );
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
  llmRouter: LlmRouter,
): ActiveSessionSnapshot {
  const activePreset = resolveActivePresetEntry(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  ).preset;
  const effective = resolveEffectiveLlmGlobals(
    {
      minWords: settings.llmPostprocessSkipMinWords,
      temperature: settings.llmPostprocessTemperature,
      useNoteContext: settings.useLlmNoteContext,
    },
    activePreset,
  );
  // A preset with pinned timing forces the effective mode without overwriting
  // the stored user choice.
  const llmPostprocessMode: LlmPostprocessMode =
    settings.llmPostprocessMode === 'off'
      ? 'off'
      : (activePreset.timing ?? settings.llmPostprocessMode);
  const sessionStartUnixMs = Date.now();
  const noteContextChars = effective.useNoteContext ? settings.llmPostprocessNoteContextChars : 0;

  return {
    accelerationPreference: settings.accelerationPreference,
    dictationAnchor: settings.dictationAnchor,
    listeningMode: settings.listeningMode,
    llmFeaturesEnabled: settings.llmFeaturesEnabled,
    llmRouter,
    llmPostprocessMode,
    llmPostprocessNoteContextChars: noteContextChars,
    llmPostprocessOutput: activePreset.output,
    llmPostprocessPrompt: activePreset.prompt,
    llmPostprocessPriorUtterancesN: settings.llmPostprocessPriorUtterancesN,
    llmPostprocessShowRawBelow: settings.llmPostprocessShowRawBelow,
    llmPostprocessSkipMinWords: effective.minWords,
    llmPostprocessTemperature: effective.temperature,
    llmPostprocessTotalContextCap: settings.llmPostprocessTotalContextCap,
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

function shouldRunBatchCleanup(
  snapshot: ActiveSessionSnapshot,
  reason: Extract<SidecarEvent, { type: 'session_stopped' }>['reason'],
): boolean {
  if (!snapshot.llmFeaturesEnabled || snapshot.llmPostprocessMode !== 'batch') {
    return false;
  }

  return reason === 'user_stop' || reason === 'sentence_complete';
}

function shouldRunProviderPerUtteranceCleanup(
  snapshot: ActiveSessionSnapshot,
  event: TranscriptReadyEvent,
): boolean {
  const rawText = event.text.trim();

  return (
    snapshot.llmFeaturesEnabled &&
    snapshot.llmPostprocessMode === 'per_utterance' &&
    event.isFinal &&
    rawText.length > 0 &&
    wordCount(rawText) >= snapshot.llmPostprocessSkipMinWords
  );
}

function toTranscriptRevision(event: TranscriptReadyEvent): TranscriptRevision {
  // RAW-BELOW is TS-only now: the success path in resolveTranscriptRevision sets
  // llmPostprocessRawText when a cleanup ran and showRawBelow is on.
  return {
    isFinal: event.isFinal,
    llmPostprocessRawText: null,
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
  };
}

function createProviderStageOutcome(args: {
  durationMs: number;
  isFinal: boolean;
  model: string;
  providerId: LlmProviderId;
  revision: number;
  status: StageOutcome['status'];
}): StageOutcome {
  return {
    durationMs: args.durationMs,
    isFinal: args.isFinal,
    payload: {
      model: args.model,
      provider: args.providerId,
    },
    revisionIn: args.revision,
    revisionOut: args.revision,
    stageId: 'llm_postprocess',
    status: args.status,
  };
}

// Prefer the provider the router actually used (attached to the thrown error)
// over the caller's earlier selection, which can be stale when the remote kill
// switch flips between selection and the cleanup call.
function failedProviderId(error: unknown, fallback: LlmProviderId): LlmProviderId {
  return error instanceof ProviderError && error.providerId !== undefined
    ? error.providerId
    : fallback;
}

function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError(formatErrorMessage(error), 'connection_failed');
}

function renderProviderUserMessage(
  sources: readonly ProviderContextSource[],
  utterance: string,
): string {
  const noteContext = joinContextSources(sources, 'note_text');
  const priorUtterances = joinContextSources(sources, 'prior_utterance');
  const sections: string[] = [];

  if (noteContext.length > 0) {
    sections.push(`<note_context>\n${noteContext}\n</note_context>`);
  }
  if (priorUtterances.length > 0) {
    sections.push(`<prior_utterances>\n${priorUtterances}\n</prior_utterances>`);
  }
  sections.push(`<utterance>\n${utterance}\n</utterance>`);

  return sections.join('\n\n');
}

function renderBatchProviderUserMessage(
  noteContext: string | null,
  transcriptText: string,
): string {
  const sections: string[] = [];

  if (noteContext !== null && noteContext.trim().length > 0) {
    sections.push(`<note_context>\n${noteContext.trim()}\n</note_context>`);
  }
  sections.push(`<session_transcript>\n${transcriptText.trim()}\n</session_transcript>`);

  return sections.join('\n\n');
}

function joinContextSources(
  sources: readonly ProviderContextSource[],
  kind: ProviderContextSource['kind'],
): string {
  return sources
    .filter((source) => source.kind === kind)
    .map((source) => source.text)
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

function wordCount(text: string): number {
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
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

export function enforceLlmContextCap(
  sources: ProviderContextSource[],
  totalContextCap: number,
): ProviderContextSource[] {
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

  return result.filter((source) => source.text.trim().length > 0);
}

function totalSourceChars(sources: readonly ProviderContextSource[]): number {
  return sources.reduce((sum, source) => sum + source.text.length, 0);
}
