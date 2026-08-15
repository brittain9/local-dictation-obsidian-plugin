import type { Editor } from 'obsidian';

import { PcmPlaybackQueue } from '../audio/pcm-playback-queue';
import { type DictationLanguage, dictationLanguageLabel } from '../language/dictation-language';
import {
  type CatalogModelSelection,
  type ModelCatalogRecord,
  matchesModelTriple,
} from '../models/model-management-types';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import {
  type SidecarEvent,
  SYNTHESIS_LANGUAGES,
  type SynthesisAudioFrame,
  type SynthesisLanguage,
  type SynthesisTextChunk,
} from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { localizeKnownSidecarEventCode } from '../sidecar/sidecar-event-localization';
import {
  SidecarLifecycleConflictError,
  type SidecarLifecycleGate,
  type SidecarLifecycleLease,
} from '../sidecar/sidecar-lifecycle-gate';
import { extractAndSegmentMarkdown } from './markdown-extractor';
import { resolveReadAloudVoiceId } from './read-aloud-selection';

export type ReadAloudState = 'idle' | 'paused' | 'reading';
export type ReadAloudFallbackRange = 'entire_note' | 'from_cursor';

/// Read aloud speaks the dictation language, but only when the selected voice
/// model declares it. An unlisted tag would otherwise fall through to the
/// language-neutral synthesis branch and produce mispronounced audio instead of
/// an honest failure — Serbian, which no voice model covers, is the live case.
function resolveSynthesisLanguage(
  dictationLanguage: DictationLanguage,
  modelLanguageTags: readonly string[],
): SynthesisLanguage | null {
  if (dictationLanguage === 'auto') return 'na';
  if (!modelLanguageTags.includes(dictationLanguage)) return null;
  return (
    SYNTHESIS_LANGUAGES.find(
      (language): language is SynthesisLanguage => language === dictationLanguage,
    ) ?? null
  );
}

interface SynthesisConfiguration {
  language: SynthesisLanguage;
  modelSelection: CatalogModelSelection;
  modelStorePathOverride?: string;
  voiceId: string;
}

interface ReadAloudControllerDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  getCatalog: () => ModelCatalogRecord;
  getSettings: () => PluginSettings;
  isDictationBusy: () => boolean;
  logger?: PluginLogger;
  onModelMissing: () => Promise<void> | void;
  onStateChange: (state: ReadAloudState) => void;
  sidecarConnection: Pick<
    SidecarConnection,
    | 'cancelSynthesis'
    | 'reportSynthesisPlaybackPosition'
    | 'startSynthesis'
    | 'subscribe'
    | 'subscribeSynthesisAudio'
  >;
  sidecarLifecycleGate: SidecarLifecycleGate;
  stopDictation: () => Promise<void>;
}

export class ReadAloudController {
  private activeChunks: SynthesisTextChunk[] = [];
  private activeSpeechLease: SidecarLifecycleLease | null = null;
  private activeSynthesisId: number | null = null;
  private lastPlayedSequence = -1;
  private nextSynthesisId = 1;
  private pendingStartRevision = 0;
  private readonly pendingSpeechLeases = new Set<SidecarLifecycleLease>();
  private releaseAudio: (() => void) | null;
  private releaseEvents: (() => void) | null;
  private sampleRate: number | null = null;
  private state: ReadAloudState = 'idle';
  private readonly playback: PcmPlaybackQueue;

  constructor(private readonly deps: ReadAloudControllerDependencies) {
    this.playback = new PcmPlaybackQueue({
      onDrained: () => this.finish(),
      onPlayedThrough: (sequence) => {
        this.lastPlayedSequence = Math.max(this.lastPlayedSequence, sequence);
        if (this.activeSynthesisId !== null) {
          this.deps.sidecarConnection.reportSynthesisPlaybackPosition(
            this.activeSynthesisId,
            sequence,
          );
        }
      },
    });
    this.releaseEvents = this.deps.sidecarConnection.subscribe((event) => {
      this.handleEvent(event);
    });
    this.releaseAudio = this.deps.sidecarConnection.subscribeSynthesisAudio((frame) => {
      this.handleAudio(frame);
    });
  }

  getState(): ReadAloudState {
    return this.state;
  }

  isActive(): boolean {
    return this.state !== 'idle';
  }

  async read(editor: Editor, fallbackRange: ReadAloudFallbackRange = 'entire_note'): Promise<void> {
    const source = editor.getValue();
    const range = resolveReadRange(editor, source, fallbackRange);
    const chunks = extractAndSegmentMarkdown(source, range);
    if (chunks.length === 0) {
      this.deps.feedback.show({ intent: 'warning', message: t('tts.notice.noText') });
      return;
    }
    const configuration = this.resolveSynthesisConfiguration();
    if (configuration === null) return;

    let speechLease: SidecarLifecycleLease;
    try {
      speechLease = this.deps.sidecarLifecycleGate.acquireSpeech();
    } catch (error) {
      if (!(error instanceof SidecarLifecycleConflictError)) throw error;
      this.deps.feedback.show({
        intent: 'warning',
        key: 'sidecar-maintenance',
        message: t('notice.sidecarMaintenanceInProgress'),
      });
      return;
    }

    const releaseStartOperation = speechLease.retain();
    this.pendingSpeechLeases.add(speechLease);
    const startRevision = ++this.pendingStartRevision;
    try {
      if (this.deps.isDictationBusy()) await this.deps.stopDictation();
      if (startRevision !== this.pendingStartRevision) return;
      await this.startChunks(chunks, this.deps.getSettings().ttsSpeed, configuration, speechLease);
    } finally {
      if (this.pendingSpeechLeases.delete(speechLease)) {
        speechLease.release();
      }
      releaseStartOperation();
    }
  }

  async togglePaused(): Promise<void> {
    const synthesisId = this.activeSynthesisId;
    if (synthesisId === null) return;
    const paused = await this.playback.togglePaused();
    if (this.activeSynthesisId !== synthesisId) return;
    this.setState(paused ? 'paused' : 'reading');
  }

  stop(): void {
    this.pendingStartRevision += 1;
    for (const lease of this.pendingSpeechLeases) {
      lease.release();
    }
    this.pendingSpeechLeases.clear();
    const synthesisId = this.activeSynthesisId;
    this.clearActive();
    if (synthesisId !== null) this.deps.sidecarConnection.cancelSynthesis(synthesisId);
  }

  async applySpeed(speed: number): Promise<void> {
    if (!this.isActive()) return;
    const remaining = this.activeChunks.slice(this.lastPlayedSequence + 1);
    if (remaining.length === 0) {
      this.stop();
      return;
    }
    const configuration = this.resolveSynthesisConfiguration();
    if (configuration === null) return;
    const speechLease = this.activeSpeechLease;
    if (speechLease === null) return;
    const releaseStartOperation = speechLease.retain();
    this.pendingStartRevision += 1;
    try {
      await this.startChunks(remaining, speed, configuration, speechLease);
    } finally {
      releaseStartOperation();
    }
  }

  dispose(): void {
    this.stop();
    this.releaseAudio?.();
    this.releaseAudio = null;
    this.releaseEvents?.();
    this.releaseEvents = null;
  }

  private async startChunks(
    chunks: SynthesisTextChunk[],
    speed: number,
    configuration: SynthesisConfiguration,
    speechLease: SidecarLifecycleLease,
  ): Promise<void> {
    const previousSynthesisId = this.activeSynthesisId;
    if (previousSynthesisId !== null) {
      this.deps.sidecarConnection.cancelSynthesis(previousSynthesisId);
    }
    const previousSpeechLease = this.activeSpeechLease;
    this.pendingSpeechLeases.delete(speechLease);
    this.activeSpeechLease = speechLease;
    if (previousSpeechLease !== null && previousSpeechLease !== speechLease) {
      previousSpeechLease.release();
    }
    const synthesisId = this.allocateSynthesisId();
    this.activeChunks = chunks;
    this.activeSynthesisId = synthesisId;
    this.lastPlayedSequence = -1;
    this.sampleRate = null;
    this.playback.start();
    this.setState('reading');
    try {
      await this.deps.sidecarConnection.startSynthesis({
        chunks,
        ...configuration,
        speed,
        synthesisId,
      });
      if (this.activeSynthesisId !== synthesisId) {
        // `startSynthesis` may have been waiting for the sidecar process to
        // launch when Stop was pressed. Cancel again after the command is
        // definitely written so stale work cannot run in the background.
        this.deps.sidecarConnection.cancelSynthesis(synthesisId);
      }
    } catch (error) {
      if (this.activeSynthesisId !== synthesisId) return;
      this.deps.logger?.error('tts', 'failed to start read aloud', error);
      this.deps.feedback.show({
        cause: error,
        intent: 'error',
        message: t('tts.notice.startFailed'),
      });
      this.clearActive();
    }
  }

  private resolveSynthesisConfiguration(): SynthesisConfiguration | null {
    const settings = this.deps.getSettings();
    const selection = settings.selectedTtsModel;
    if (selection === null || selection.kind !== 'catalog_model') {
      this.reportModelRequired();
      this.stop();
      return null;
    }
    const catalogModel = this.deps
      .getCatalog()
      .models.find((model) =>
        matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
      );
    if (catalogModel === undefined) {
      this.reportModelRequired();
      this.stop();
      return null;
    }
    const voiceId = resolveReadAloudVoiceId(settings.selectedTtsVoice, catalogModel.defaultVoice);
    if (voiceId === null) {
      this.deps.feedback.show({ intent: 'warning', message: t('tts.notice.voiceRequired') });
      this.stop();
      return null;
    }
    const language = resolveSynthesisLanguage(
      settings.dictationLanguage,
      catalogModel.languageTags,
    );
    if (language === null) {
      this.deps.feedback.show({
        intent: 'warning',
        message: t('tts.notice.languageUnsupported', {
          language: dictationLanguageLabel(settings.dictationLanguage),
        }),
      });
      this.stop();
      return null;
    }
    return {
      language,
      modelSelection: selection,
      ...(settings.modelStorePathOverride.length > 0
        ? { modelStorePathOverride: settings.modelStorePathOverride }
        : {}),
      voiceId,
    };
  }

  private reportModelRequired(cause?: unknown): void {
    this.deps.feedback.show({
      action: {
        label: t('tts.action.chooseModel'),
        run: () => {
          void Promise.resolve()
            .then(() => this.deps.onModelMissing())
            .catch((error: unknown) => {
              this.reportModelRequired(error);
            });
        },
      },
      ...(cause === undefined ? {} : { cause }),
      intent: 'action-required',
      key: 'read-aloud-model-required',
      message: t('tts.notice.modelRequired'),
    });
  }

  private handleEvent(event: SidecarEvent): void {
    if (event.type === 'error' && event.code === 'sidecar_exited' && this.isActive()) {
      this.deps.feedback.show({ intent: 'error', message: t('tts.notice.sidecarExited') });
      this.clearActive();
      return;
    }
    if (!('synthesisId' in event) || event.synthesisId !== this.activeSynthesisId) return;
    switch (event.type) {
      case 'synthesis_started':
        this.sampleRate = event.sampleRate;
        break;
      case 'synthesis_complete':
        this.playback.markGenerationComplete();
        break;
      case 'synthesis_error': {
        const message = localizeKnownSidecarEventCode(event.code) ?? event.message;
        this.deps.feedback.show({
          intent: 'error',
          message: `${message}${event.details === undefined ? '' : ` (${event.details})`}`,
        });
        this.clearActive();
        break;
      }
      case 'synthesis_chunk_meta':
        break;
    }
  }

  private handleAudio(frame: SynthesisAudioFrame): void {
    if (frame.synthesisId !== this.activeSynthesisId) return;
    if (this.sampleRate === null) {
      this.deps.logger?.warn('tts', 'discarded synthesis audio received before sample rate');
      return;
    }
    try {
      this.playback.enqueue(frame.seq, this.sampleRate, frame.pcm16le);
    } catch (error) {
      this.deps.logger?.error('tts', 'failed to queue synthesis audio', error);
      this.deps.feedback.show({
        cause: error,
        intent: 'error',
        message: t('tts.notice.playbackFailed'),
      });
      this.stop();
    }
  }

  private finish(): void {
    this.clearActive();
  }

  private clearActive(): void {
    const speechLease = this.activeSpeechLease;
    this.activeSpeechLease = null;
    this.activeChunks = [];
    this.activeSynthesisId = null;
    this.lastPlayedSequence = -1;
    this.sampleRate = null;
    this.playback.stop();
    this.setState('idle');
    speechLease?.release();
  }

  private setState(state: ReadAloudState): void {
    if (state === this.state) return;
    this.state = state;
    this.deps.onStateChange(state);
  }

  private allocateSynthesisId(): number {
    const id = this.nextSynthesisId;
    this.nextSynthesisId = this.nextSynthesisId >= 0xffff_ffff ? 1 : this.nextSynthesisId + 1;
    return id;
  }
}

export function resolveReadRange(
  editor: Editor,
  source: string,
  fallbackRange: ReadAloudFallbackRange = 'entire_note',
): { from: number; to: number } {
  if (editor.somethingSelected()) {
    const anchor = editor.posToOffset(editor.getCursor('anchor'));
    const head = editor.posToOffset(editor.getCursor('head'));
    return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
  }

  return {
    from: fallbackRange === 'from_cursor' ? editor.posToOffset(editor.getCursor()) : 0,
    to: source.length,
  };
}
