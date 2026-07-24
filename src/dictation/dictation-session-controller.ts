import { randomUUID } from 'node:crypto';

import { Platform } from 'obsidian';

import type { AudioCaptureStream } from '../audio/audio-capture-stream';
import { formatMicrophoneCaptureErrorMessage } from '../audio/microphone-permission-message';
import type { SidecarAudioLevelMeter } from '../audio/sidecar-audio-level-meter';
import {
  formatSystemAudioErrorMessage,
  formatSystemAudioSidecarErrorMessage,
} from '../audio/system-audio-permission-message';
import type { NotePlacementOptions, SurfaceDesynchronization } from '../editor/note-surface';
import type { RawTranscriptRecoveryReceipt } from '../editor/raw-transcript-recovery';
import {
  type LlmPostprocessMode,
  type LlmPresetOutput,
  resolveActivePresetEntry,
  resolveEffectiveLlmGlobals,
} from '../llm/presets';
import { type LlmCleanupFailure, type LlmProviderId, ProviderError } from '../llm/provider';
import type { LlmRouter } from '../llm/router';
import type { Session, SessionAcceptResult } from '../session/session';
import type { StageId, StageOutcome, TranscriptRevision } from '../session/session-journal';
import type { PluginSettings, SmartParagraphPauseSettings } from '../settings/plugin-settings';
import { formatErrorMessage } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import { truncateLeadingText } from '../shared/text-truncation';
import type { FeedbackRequest, UserFeedback } from '../shared/user-feedback';
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
import { localizeSidecarEvent, rawSidecarEventDetail } from '../sidecar/sidecar-event-localization';
import {
  SidecarLifecycleConflictError,
  type SidecarLifecycleGate,
  type SidecarLifecycleLease,
} from '../sidecar/sidecar-lifecycle-gate';
import { SidecarNotInstalledError } from '../sidecar/sidecar-paths';
import { buildTranscriptSpans, type TranscriptRenderOptions } from '../transcript/renderer';

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
  diarizationEnabled: PluginSettings['diarizationEnabled'];
  diarizationMaxSpeakers: PluginSettings['diarizationMaxSpeakers'];
  dictationLanguage: PluginSettings['dictationLanguage'];
  includeSystemAudio: PluginSettings['includeSystemAudio'];
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
  smartParagraphPauses: SmartParagraphPauseSettings;
  speakingStyle: PluginSettings['speakingStyle'];
  timestamps: TranscriptRenderOptions['timestamps'];
  transcriptFormatting: PluginSettings['transcriptFormatting'];
  useNoteAsContext: PluginSettings['useNoteAsContext'];
}

type SessionPhase = 'starting' | 'active' | 'stopping' | 'cancelling' | 'stopped';
// Stable across sidecar lifecycle acknowledgements. Terminal causes claim the
// feedback slot, while cancellation also permanently rejects transcript work.
type TerminalArbitrationState = 'open' | 'feedback-claimed' | 'cancelled';

interface ManagedSession {
  anchorTimerId: number | null;
  capabilityDropLogKeys: Set<string>;
  // Final revisions enter this FIFO so concurrent per-utterance cleanups land
  // in final-event order. Partials bypass it and project immediately.
  cleanupChain: Promise<void>;
  cleanupAbortControllers: Set<AbortController>;
  llmFailureLogged: boolean;
  pendingTranscriptWork: Set<Promise<void>>;
  phase: SessionPhase;
  session: ControllerSession;
  speechLease: SidecarLifecycleLease;
  snapshot: ActiveSessionSnapshot;
  terminalArbitration: TerminalArbitrationState;
}

function rejectsTranscriptWork(entry: ManagedSession): boolean {
  return entry.terminalArbitration === 'cancelled';
}

interface DictationSessionControllerDependencies {
  audioLevelMeter: Pick<SidecarAudioLevelMeter, 'bindSession' | 'clearSession' | 'update'>;
  captureStream: Pick<AudioCaptureStream, 'isCapturing' | 'start' | 'stop'>;
  createSession: (options: {
    callbacks: {
      onLockedNoteClosed: () => void;
      onLockedNoteDeleted: () => void;
      onSurfaceDesynchronized: (failure: SurfaceDesynchronization) => void;
    };
    placement: NotePlacementOptions;
    rendererOptions: TranscriptRenderOptions;
    sessionId: string;
  }) => ControllerSession;
  createLlmRouter: (settings: PluginSettings) => LlmRouter;
  feedback: Pick<UserFeedback, 'show'>;
  getSettings: () => PluginSettings;
  hasDictationTarget: () => boolean;
  logger?: PluginLogger;
  onLlmCleanupFailure?: (failure: LlmCleanupFailure) => void;
  onLlmCleanupSuccess?: () => void;
  onFinalizedUtteranceAccepted?: (text: string) => void;
  onRawTranscriptRecoveryAvailable?: (receipt: RawTranscriptRecoveryReceipt) => void;
  onModelMissing?: () => void;
  onSidecarMissing?: () => void;
  countAudioInputDevices?: () => Promise<number | null>;
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
  sidecarLifecycleGate: SidecarLifecycleGate;
  stopConflictingSpeech: () => void;
}

const ANCHOR_VISIBLE_DELAY_MS = 2500;
const MAX_CONTROLLER_SESSIONS = 5;
interface FeedbackFailure {
  key: string;
  message: string;
}

const FEEDBACK_FAILURES = {
  recordTranscript: {
    key: 'transcript-record-failed',
    message: t('notice.transcriptRecordFailed'),
  },
  microphoneDisconnected: {
    key: 'microphone-capture-ended',
    message: t('notice.microphoneDisconnected'),
  },
  sidecar: {
    key: 'sidecar-session-error',
    message: t('notice.sidecarSessionError'),
  },
  surfaceDesynchronized: {
    key: 'dictation-surface-desynchronized',
    message: t('notice.surfaceDesynchronized'),
  },
  startDictation: {
    key: 'dictation-start-failed',
    message: t('notice.dictationStartFailed'),
  },
  stopDictation: {
    key: 'dictation-stop-failed',
    message: t('notice.dictationStopFailed'),
  },
  targetNoteClosed: {
    key: 'dictation-target-closed',
    message: t('notice.targetNoteClosed'),
  },
  targetNoteDeleted: {
    key: 'dictation-target-deleted',
    message: t('notice.targetNoteDeleted'),
  },
  transcriptWrite: {
    key: 'transcript-write-failed',
    message: t('notice.transcriptWriteFailed'),
  },
} as const satisfies Record<string, FeedbackFailure>;

export class DictationSessionController {
  private activeSessionId: string | null = null;
  private readonly cancellationPromises = new Map<string, Promise<void>>();
  private pendingSpeechLease: SidecarLifecycleLease | null = null;
  private readonly releaseSidecarSubscription: () => void;
  private readonly sessions = new Map<string, ManagedSession>();
  private startRevision = 0;
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

  isCaptureActive(): boolean {
    return this.activeSessionId !== null || this.state === 'starting';
  }

  async cancelDictation(): Promise<void> {
    const pendingStartCancelled = this.cancelPendingStart();
    if (pendingStartCancelled) return;
    const sessionId = this.activeSessionId ?? this.latestSessionId();

    if (sessionId === null) {
      this.dependencies.feedback.show({
        intent: 'information',
        key: 'dictation-not-active',
        message: t('notice.dictationNotActive'),
      });
      return;
    }

    await this.cancelSession(sessionId);
  }

  async dispose(): Promise<void> {
    this.cancelPendingStart();
    if (this.activeSessionId !== null) {
      await this.clearActiveSession(this.activeSessionId);
    } else {
      await this.stopCaptureForTeardown();
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

    if (this.isCaptureActive()) {
      await this.stopDictation();
      return;
    }

    if (this.sessions.size >= MAX_CONTROLLER_SESSIONS) {
      return;
    }

    await this.startDictation();
  }

  async startDictation(): Promise<void> {
    if (this.isCaptureActive() || this.sessions.size >= MAX_CONTROLLER_SESSIONS) {
      return;
    }

    let speechLease: SidecarLifecycleLease;
    try {
      speechLease = this.dependencies.sidecarLifecycleGate.acquireSpeech();
    } catch (error) {
      if (!(error instanceof SidecarLifecycleConflictError)) throw error;
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'sidecar-maintenance',
        message: t('notice.sidecarMaintenanceInProgress'),
      });
      return;
    }

    const releaseStartOperation = speechLease.retain();
    this.pendingSpeechLease = speechLease;
    try {
      await this.startDictationWithLease(speechLease);
    } finally {
      if (this.pendingSpeechLease === speechLease) {
        this.pendingSpeechLease = null;
        speechLease.release();
      }
      releaseStartOperation();
    }
  }

  private async startDictationWithLease(speechLease: SidecarLifecycleLease): Promise<void> {
    const startRevision = ++this.startRevision;
    this.applyUiState('starting');

    const settings = this.dependencies.getSettings();
    if (settings.selectedModel === null) {
      this.dependencies.logger?.debug('session', 'no model selected; prompting model picker');
      this.applyUiState('idle');
      this.dependencies.onModelMissing?.();
      return;
    }

    if (!this.dependencies.hasDictationTarget()) {
      this.dependencies.feedback.show({
        intent: 'warning',
        key: 'dictation-target-unavailable',
        message: t('setup.ready.openMarkdownNote'),
      });
      this.applyUiState('idle');
      return;
    }

    try {
      this.dependencies.stopConflictingSpeech();
    } catch (error) {
      if (startRevision !== this.startRevision) return;
      this.handleError(FEEDBACK_FAILURES.startDictation, error);
      return;
    }

    try {
      await this.assertMicrophoneInputAvailable();
    } catch (error) {
      if (startRevision !== this.startRevision) return;
      this.handleError(FEEDBACK_FAILURES.startDictation, error);
      return;
    }
    if (startRevision !== this.startRevision) return;

    try {
      await this.dependencies.sidecarConnection.ensureStarted();
    } catch (error) {
      if (startRevision !== this.startRevision) return;
      if (error instanceof SidecarNotInstalledError) {
        this.dependencies.logger?.debug('sidecar', 'sidecar not installed; prompting install');
        this.applyUiState('idle');
        this.dependencies.onSidecarMissing?.();
        return;
      }
      this.handleError(FEEDBACK_FAILURES.startDictation, error);
      return;
    }
    if (startRevision !== this.startRevision) return;

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
          onSurfaceDesynchronized: (failure) => {
            this.cancelOnFatalTranscriptFailure(
              sessionId,
              FEEDBACK_FAILURES.surfaceDesynchronized,
              failure,
            );
          },
        },
        placement: { anchor: snapshot.dictationAnchor },
        rendererOptions: {
          smartParagraphPauses: snapshot.smartParagraphPauses,
          timestamps: snapshot.timestamps,
          transcriptFormatting: snapshot.transcriptFormatting,
        },
        sessionId,
      });
    } catch (error) {
      this.handleError(FEEDBACK_FAILURES.startDictation, error);
      return;
    }

    const entry: ManagedSession = {
      anchorTimerId: null,
      capabilityDropLogKeys: new Set(),
      cleanupChain: Promise.resolve(),
      cleanupAbortControllers: new Set(),
      llmFailureLogged: false,
      pendingTranscriptWork: new Set(),
      phase: 'starting',
      session,
      speechLease,
      snapshot,
      terminalArbitration: 'open',
    };
    this.sessions.set(sessionId, entry);
    if (this.pendingSpeechLease === speechLease) {
      this.pendingSpeechLease = null;
    }
    this.activeSessionId = sessionId;
    this.dependencies.audioLevelMeter.bindSession(sessionId);
    this.dependencies.logger?.debug('session', `starting dictation session ${sessionId}`);

    try {
      await this.dependencies.sidecarConnection.startSession({
        accelerationPreference: snapshot.accelerationPreference,
        // Engine segment timing is always present when the model provides it.
        // This legacy protocol flag only enables dense word alignment, which no
        // supported timestamp frequency renders.
        detailedTimestampsEnabled: false,
        diarizationEnabled: snapshot.diarizationEnabled,
        diarizationMaxSpeakers: snapshot.diarizationMaxSpeakers,
        includeSystemAudio: snapshot.includeSystemAudio,
        language: snapshot.dictationLanguage,
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
    const pendingStartCancelled = this.cancelPendingStart();
    const sessionId = this.activeSessionId;

    if (sessionId === null) {
      if (pendingStartCancelled) return;
      this.dependencies.feedback.show({
        intent: 'information',
        key: 'dictation-not-active',
        message: t('notice.dictationNotActive'),
      });
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
      this.handleError(FEEDBACK_FAILURES.stopDictation, error, entry);
    }
  }

  private cancelPendingStart(): boolean {
    this.startRevision += 1;
    if (this.activeSessionId !== null || this.state !== 'starting') return false;
    this.pendingSpeechLease?.release();
    this.pendingSpeechLease = null;
    this.applyUiState('idle');
    return true;
  }

  async handleAudioCaptureEnded(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined || entry.phase !== 'active' || this.activeSessionId !== sessionId) {
      return;
    }

    this.dependencies.logger?.warn(
      'audio',
      `microphone capture ended unexpectedly for session ${sessionId}`,
    );
    this.reportTerminalFeedback(entry, {
      cause: { reason: 'microphone_disconnected', sessionId },
      intent: 'warning',
      key: FEEDBACK_FAILURES.microphoneDisconnected.key,
      message: FEEDBACK_FAILURES.microphoneDisconnected.message,
    });

    // Stop rather than cancel so the sidecar drains and emits transcripts for
    // audio already accepted before the device disappeared.
    await this.stopDictation();
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

    this.handleError(FEEDBACK_FAILURES.startDictation, error, entry);
    if (entry.phase === 'starting') {
      this.disposeLocalSession(sessionId);
    } else {
      await this.cancelSession(sessionId);
    }
  }

  private async assertMicrophoneInputAvailable(): Promise<void> {
    if (!Platform.isLinux) {
      return;
    }

    const countAudioInputDevices =
      this.dependencies.countAudioInputDevices ?? countBrowserAudioInputDevices;
    const audioInputCount = await countAudioInputDevices();

    if (audioInputCount === 0) {
      throw createMicrophoneNotFoundError();
    }
  }

  private cancelSession(sessionId: string): Promise<void> {
    const inFlightCancellation = this.cancellationPromises.get(sessionId);
    if (inFlightCancellation !== undefined) {
      return inFlightCancellation;
    }

    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return Promise.resolve();
    }

    // Establish the terminal state before capture teardown yields. Every caller
    // then joins the same promise, so concurrent failure sources cannot send
    // duplicate cancellation commands to the sidecar.
    entry.terminalArbitration = 'cancelled';
    entry.phase = 'cancelling';
    this.abortProviderCleanups(entry);
    const cancellation = Promise.resolve().then(() => this.completeSessionCancellation(sessionId));
    this.cancellationPromises.set(sessionId, cancellation);
    void cancellation.then(
      () => {
        if (this.cancellationPromises.get(sessionId) === cancellation) {
          this.cancellationPromises.delete(sessionId);
        }
      },
      () => {
        if (this.cancellationPromises.get(sessionId) === cancellation) {
          this.cancellationPromises.delete(sessionId);
        }
      },
    );
    return cancellation;
  }

  private async completeSessionCancellation(sessionId: string): Promise<void> {
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
    this.dependencies.audioLevelMeter.clearSession(sessionId);
    this.applyUiState('idle');
    this.resetQueueTier();
    await this.stopCaptureForTeardown();
  }

  private async stopCaptureForTeardown(): Promise<void> {
    if (!this.dependencies.captureStream.isCapturing()) {
      return;
    }

    // Capture teardown is best-effort: a rejection here (e.g. AudioContext.close()
    // throwing) must not stop stopDictation/cancelSession/dispose from sending the
    // sidecar stop/cancel command or disposing the local session afterward.
    try {
      await this.dependencies.captureStream.stop();
    } catch (error) {
      this.dependencies.logger?.warn(
        'audio',
        'failed to stop audio capture cleanly during teardown',
        error,
      );
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
    entry.speechLease.release();

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
      this.dependencies.audioLevelMeter.clearSession(sessionId);
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

      case 'audio_level':
        this.handleAudioLevel(event);
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
    if (entry.phase === 'cancelling') {
      return;
    }

    this.applySessionStateToAnchor(entry, event.state);

    const audioActive = this.dependencies.captureStream.isCapturing();
    if (event.sessionId !== this.activeSessionId || entry.phase !== 'active' || !audioActive) {
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

    const glossary = entry.session.readNoteGlossary(budgetChars);
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
    if (entry === undefined || rejectsTranscriptWork(entry)) {
      return;
    }

    const work = this.processTranscriptReady(entry, event);
    entry.pendingTranscriptWork.add(work);
    try {
      await work;
    } catch (error) {
      // processTranscriptReady handles cleanup failures itself. A projection
      // exception means this session can no longer write safely, so contain it
      // exactly like a typed surface failure instead of retrying every revision.
      this.cancelOnFatalTranscriptFailure(
        event.sessionId,
        FEEDBACK_FAILURES.transcriptWrite,
        error,
      );
    } finally {
      entry.pendingTranscriptWork.delete(work);
    }
  }

  private async processTranscriptReady(
    entry: ManagedSession,
    event: TranscriptReadyEvent,
  ): Promise<void> {
    if (event.isFinal && event.text.length > 0) {
      this.dependencies.logger?.debug(
        'session',
        `final transcript received (${event.text.length} chars, ${event.processingDurationMs}ms processing)`,
      );
    }

    for (const warning of event.warnings) {
      const logKey = JSON.stringify([warning.field, warning.reason]);
      if (entry.capabilityDropLogKeys.has(logKey)) {
        continue;
      }
      entry.capabilityDropLogKeys.add(logKey);
      this.dependencies.logger?.debug(
        'session',
        `capability gate dropped "${warning.field}": ${warning.reason}`,
      );
    }
    this.logDroppedHallucinations(event);

    const revisionPromise = this.resolveTranscriptRevision(entry, event);

    if (!event.isFinal) {
      const revision = await revisionPromise;
      await this.acceptResolvedRevision(entry, event.sessionId, revision);
      return;
    }

    // Final cleanup network calls run concurrently, but their accepts are
    // serialized so out-of-order remote completions land in final-event order.
    const accept = entry.cleanupChain.then(async () => {
      const revision = await revisionPromise;
      await this.acceptResolvedRevision(entry, event.sessionId, revision);
    });
    entry.cleanupChain = accept.catch(() => {});
    await accept;
  }

  private async acceptResolvedRevision(
    entry: ManagedSession,
    sessionId: string,
    revision: TranscriptRevision | null,
  ): Promise<void> {
    // Gate on 'cancelling' only: cancelSession sets it synchronously before
    // its first await and it persists if cancellation cleanup throws, so
    // queued accepts cannot land in a half-cancelled session (#138).
    // 'stopped' must NOT be gated — the sidecar can deliver the final
    // transcript_ready and session_stopped in one I/O chunk, and the stop
    // path drains these in-flight accepts after the phase flips.
    if (
      revision === null ||
      !this.sessions.has(sessionId) ||
      entry.phase === 'cancelling' ||
      rejectsTranscriptWork(entry)
    ) {
      return;
    }
    let result: SessionAcceptResult;
    try {
      result = entry.session.acceptTranscript(revision);
    } catch (error) {
      this.cancelOnFatalTranscriptFailure(sessionId, FEEDBACK_FAILURES.transcriptWrite, error);
      return;
    }
    if (rejectsTranscriptWork(entry)) {
      return;
    }
    if (result.kind === 'rejected') {
      this.handleError(FEEDBACK_FAILURES.recordTranscript, new Error(result.reason), entry);
      await this.cancelSession(sessionId);
      return;
    }
    if (result.kind === 'accepted' && revision.isFinal && revision.text.trim().length > 0) {
      this.dependencies.onFinalizedUtteranceAccepted?.(revision.text);
    }
  }

  private async resolveTranscriptRevision(
    entry: ManagedSession,
    event: TranscriptReadyEvent,
  ): Promise<TranscriptRevision | null> {
    const baseRevision = toTranscriptRevision(event, entry.snapshot.timestamps);

    // A single-text rewrite cannot be re-attributed across speakers without
    // losing who-said-what, so per-utterance cleanup is skipped when diarization
    // splits an utterance into multiple speaker spans; the labelled raw spans are
    // rendered and batch whole-session cleanup still applies. Single-speaker
    // utterances clean as before.
    if (
      !shouldRunProviderPerUtteranceCleanup(entry.snapshot, event) ||
      baseRevision.spans.length > 1
    ) {
      return baseRevision;
    }

    const rawText = event.text.trim();
    const userMessage = renderProviderUserMessage(
      this.buildProviderCleanupContextSources(entry),
      rawText,
    );
    const providerId = entry.snapshot.llmRouter.selectProviderId(rawText.length);
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
        spans: buildTranscriptSpans([], cleanedText, baseRevision.speakerIndex, {
          timestamps: entry.snapshot.timestamps,
          utteranceStartMsInSession: event.utteranceStartMsInSession,
        }),
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
    if (!rejectsTranscriptWork(entry)) {
      entry.phase = 'stopped';
    }

    if (event.sessionId === this.activeSessionId) {
      this.activeSessionId = null;
      this.dependencies.audioLevelMeter.clearSession(event.sessionId);
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

  private handleAudioLevel(event: Extract<SidecarEvent, { type: 'audio_level' }>): void {
    if (event.sessionId !== this.activeSessionId) {
      return;
    }
    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined || entry.phase !== 'active') {
      return;
    }
    this.dependencies.audioLevelMeter.update(event);
  }

  private async runBatchCleanup(sessionId: string, entry: ManagedSession): Promise<void> {
    // The sidecar can emit the final transcript_ready and session_stopped in the
    // same I/O chunk, so drain in-flight per-utterance accepts before reading the
    // transcript — otherwise the batch rewrite would miss the last utterance(s).
    if (entry.pendingTranscriptWork.size > 0) {
      await this.drainPendingTranscriptWork(entry);
    }
    if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
      return;
    }

    const transcriptText = entry.session.readCurrentSessionText();
    if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
      return;
    }

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
    const providerId = entry.snapshot.llmRouter.selectProviderId(transcriptText.length);

    // The flashing processing range is now the "working" indicator, so the
    // cursor steps aside for the batch rewrite.
    entry.session.setAnchorMode('hidden');
    if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
      return;
    }
    entry.session.markSessionRangeAsProcessing();
    if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
      return;
    }

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
          if (!this.stopTerminatedBatchCleanup(sessionId, entry)) {
            this.disposeLocalSession(sessionId);
          }
        }
        return;
      }
      if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
        return;
      }

      entry.session.clearSessionProcessingMark();
      if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
        return;
      }

      this.applyBatchCleanupResult(sessionId, entry, result.text.trim(), transcriptText);
      if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
        return;
      }
      this.dependencies.onLlmCleanupSuccess?.();
      this.disposeLocalSession(sessionId);
    } catch (error) {
      if (abortController.signal.aborted) {
        if (this.sessions.get(sessionId) === entry) {
          entry.session.clearSessionProcessingMark();
          if (!this.stopTerminatedBatchCleanup(sessionId, entry)) {
            this.disposeLocalSession(sessionId);
          }
        }
        return;
      }
      if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
        return;
      }

      this.handleProviderCleanupFailure(failedProviderId(error, providerId), error);
      entry.session.clearSessionProcessingMark();
      if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
        return;
      }
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
    sessionId: string,
    entry: ManagedSession,
    cleanedText: string,
    transcriptText: string,
  ): void {
    if (entry.snapshot.llmPostprocessOutput === 'replace') {
      if (cleanedText.length === 0) {
        throw new ProviderError('Provider returned empty cleaned text.', 'invalid_response');
      }

      const replacement = entry.session.replaceSessionRangeWithCleaned(cleanedText, {
        rawTextForCallout: transcriptText,
        showRawBelow: entry.snapshot.llmPostprocessShowRawBelow,
      });
      if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
        return;
      }

      if (replacement.kind === 'denied') {
        this.dependencies.logger?.warn(
          'llm',
          'batch cleanup replacement skipped; session range no longer available',
        );
      } else {
        this.dependencies.onRawTranscriptRecoveryAvailable?.(replacement.recovery);
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
      this.dependencies.feedback.show({
        intent: 'information',
        message: t('notice.llmTransformEmpty'),
      });
      return;
    }

    const placement = entry.snapshot.llmPostprocessOutput === 'add_above' ? 'above' : 'below';
    const inserted = entry.session.insertAdjacentToSessionRange(cleanedText, placement);
    if (this.stopTerminatedBatchCleanup(sessionId, entry)) {
      return;
    }

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

  private stopTerminatedBatchCleanup(sessionId: string, entry: ManagedSession): boolean {
    if (this.sessions.get(sessionId) !== entry) {
      return true;
    }
    if (!rejectsTranscriptWork(entry)) {
      return false;
    }

    this.disposeLocalSession(sessionId);
    return true;
  }

  private async handleErrorEvent(event: Extract<SidecarEvent, { type: 'error' }>): Promise<void> {
    if (event.code === 'session_capacity_exceeded' && event.sessionId !== undefined) {
      this.dependencies.logger?.warn('sidecar', event.message, event.details);
      await this.clearActiveSession(event.sessionId);
      this.disposeLocalSession(event.sessionId);
      return;
    }

    if (event.code === 'utterance_queue_overload' && event.sessionId !== undefined) {
      await this.handleQueueOverload(event);
      return;
    }

    const rawDetail = rawSidecarEventDetail(event);
    const detail = formatSystemAudioErrorMessage(localizeSidecarEvent(event), event.code);
    this.dependencies.logger?.warn('sidecar', rawDetail, event.code);

    if (event.sessionId === undefined) {
      this.handleError(FEEDBACK_FAILURES.sidecar, detail);
      return;
    }

    const entry = this.sessions.get(event.sessionId);
    if (entry === undefined) {
      return;
    }

    if (event.sessionId === this.activeSessionId) {
      const reported = this.reportTerminalFeedback(entry, {
        cause: { code: event.code, details: event.details, sessionId: event.sessionId },
        intent: 'error',
        key: FEEDBACK_FAILURES.sidecar.key,
        message: detail,
      });
      if (reported) {
        this.applyUiState('error');
      }
    } else {
      this.dependencies.logger?.warn('session', rawDetail);
    }

    await this.cancelSession(event.sessionId);
  }

  // Queue overload is a sidecar-initiated graceful stop: capture is already
  // stopped natively and the already-accepted utterances keep draining until a
  // session_stopped(queue_overload) event completes the teardown. Cancelling
  // here (the fate of every other session-scoped error) would tear the worker
  // down and drop that queued work before it lands, so surface the notice and
  // let the drain run its course.
  private async handleQueueOverload(
    event: Extract<SidecarEvent, { type: 'error' }>,
  ): Promise<void> {
    const sessionId = event.sessionId;
    if (sessionId === undefined) {
      return;
    }

    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return;
    }
    if (entry.phase === 'cancelling') {
      return;
    }

    const rawDetail = rawSidecarEventDetail(event);
    const detail = localizeSidecarEvent(event);
    this.dependencies.logger?.warn('sidecar', rawDetail, event.code);
    if (sessionId === this.activeSessionId) {
      // Queue overload is a graceful stop, not a cancellation cause. Keep its
      // warning outside terminal arbitration so a later target loss can explain
      // why accepted work was discarded while the queue was draining.
      this.dependencies.feedback.show({
        cause: { code: event.code, details: event.details, sessionId },
        intent: 'warning',
        key: 'utterance-queue-overload',
        message: detail,
      });
    } else {
      this.dependencies.logger?.warn('session', rawDetail);
    }

    entry.phase = 'stopping';
    await this.clearActiveSession(sessionId);
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
      const editedSegments = stage.payload?.editedSegments;
      const dropped = Array.isArray(droppedSegments) ? droppedSegments.length : 0;
      const edited = Array.isArray(editedSegments) ? editedSegments.length : 0;
      if (dropped + edited > 0) {
        this.dependencies.logger?.debug('session', 'hallucination filter adjusted segments', {
          dropped,
          edited,
        });
      }
    }
  }

  private cancelOnLockedNoteEvent(sessionId: string, reason: 'closed' | 'deleted'): void {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return;
    }

    const failure =
      reason === 'closed'
        ? FEEDBACK_FAILURES.targetNoteClosed
        : FEEDBACK_FAILURES.targetNoteDeleted;
    this.reportTerminalFeedback(entry, {
      cause: { reason, sessionId },
      intent: 'warning',
      key: failure.key,
      message: failure.message,
    });
    void this.cancelSession(sessionId);
  }

  private cancelOnFatalTranscriptFailure(
    sessionId: string,
    failure: FeedbackFailure,
    details: unknown,
  ): void {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined || rejectsTranscriptWork(entry)) {
      return;
    }

    this.abortProviderCleanups(entry);
    this.reportTerminalFeedback(entry, {
      cause: details,
      intent: 'error',
      key: failure.key,
      message: failure.message,
    });
    entry.terminalArbitration = 'cancelled';

    if (entry.phase === 'cancelling' || entry.phase === 'stopped') {
      return;
    }

    // Mark cancellation before any await so concurrent queued transcript work
    // observes the terminal phase and cannot repeat the failure.
    entry.phase = 'cancelling';
    void this.cancelSession(sessionId);
  }

  private reportTerminalFeedback(entry: ManagedSession, request: FeedbackRequest): boolean {
    if (entry.terminalArbitration !== 'open') {
      return false;
    }

    entry.terminalArbitration = 'feedback-claimed';
    this.dependencies.feedback.show(request);
    return true;
  }

  private handleError(failure: FeedbackFailure, error: unknown, entry?: ManagedSession): void {
    // Microphone-capture failures get specific, actionable copy that stands on
    // its own; prefixing it with the generic start-failure message just buries
    // the instructions. The Settings mic picker shows the same copy for parity.
    const microphoneMessage = formatMicrophoneCaptureErrorMessage(error);
    let request: FeedbackRequest;
    if (microphoneMessage !== null) {
      request = {
        cause: error,
        intent: 'action-required',
        key: 'microphone-permission',
        message: microphoneMessage,
      };
    } else {
      const systemAudioMessage = formatSystemAudioSidecarErrorMessage(error);
      request =
        systemAudioMessage === null
          ? {
              cause: error,
              intent: 'error',
              key: failure.key,
              message: failure.message,
            }
          : {
              cause: error,
              intent: 'action-required',
              key: 'system-audio-permission',
              message: systemAudioMessage,
            };
    }

    let reported: boolean;
    if (entry === undefined) {
      this.dependencies.feedback.show(request);
      reported = true;
    } else {
      reported = this.reportTerminalFeedback(entry, request);
    }
    if (reported) {
      this.applyUiState('error');
    }
  }
}

function createSessionId(): string {
  return randomUUID();
}

function isCapacityExceededStartError(error: unknown): boolean {
  return error instanceof SidecarError && error.code === 'session_capacity_exceeded';
}

async function countBrowserAudioInputDevices(): Promise<number | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const mediaDevices = window.navigator?.mediaDevices;
  if (mediaDevices?.enumerateDevices === undefined) {
    return null;
  }

  const devices = await mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput').length;
}

function createMicrophoneNotFoundError(): Error {
  const error = new Error('No audio input devices found.');
  error.name = 'NotFoundError';
  return error;
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
    diarizationEnabled: settings.diarizationEnabled,
    diarizationMaxSpeakers: settings.diarizationMaxSpeakers,
    dictationLanguage: settings.dictationLanguage,
    includeSystemAudio: settings.includeSystemAudio,
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
    smartParagraphPauses: {
      lineBreakPauseMs: settings.smartParagraphLineBreakPauseMs,
      paragraphPauseMs: settings.smartParagraphParagraphPauseMs,
    },
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

function toTranscriptRevision(
  event: TranscriptReadyEvent,
  timestamps: TranscriptRenderOptions['timestamps'],
): TranscriptRevision {
  // RAW-BELOW is TS-only now: the success path in resolveTranscriptRevision sets
  // llmPostprocessRawText when a cleanup ran and showRawBelow is on.
  const text = event.text.trim();
  return {
    isFinal: event.isFinal,
    llmPostprocessRawText: null,
    pauseMsBeforeUtterance: event.pauseMsBeforeUtterance,
    revision: event.revision,
    segments: event.segments,
    sessionId: event.sessionId,
    speakerIndex: event.speakerIndex,
    spans: buildTranscriptSpans(event.segments, text, event.speakerIndex, {
      timestamps,
      utteranceStartMsInSession: event.utteranceStartMsInSession,
    }),
    stageResults: event.stageResults,
    text,
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
