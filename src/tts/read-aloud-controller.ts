import type { Editor } from 'obsidian';

import { PcmPlaybackQueue } from '../audio/pcm-playback-queue';
import {
  type CatalogModelSelection,
  type ModelCatalogRecord,
  matchesModelTriple,
} from '../models/model-management-types';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { SidecarEvent, SynthesisAudioFrame, SynthesisTextChunk } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { localizeKnownSidecarEventCode } from '../sidecar/sidecar-event-localization';
import { extractAndSegmentMarkdown } from './markdown-extractor';
import { resolveReadAloudVoiceId } from './read-aloud-selection';

export type ReadAloudState = 'idle' | 'paused' | 'reading';

interface SynthesisConfiguration {
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
  onStateChange: (state: ReadAloudState) => void;
  sidecarConnection: Pick<
    SidecarConnection,
    | 'cancelSynthesis'
    | 'reportSynthesisPlaybackPosition'
    | 'startSynthesis'
    | 'subscribe'
    | 'subscribeSynthesisAudio'
  >;
  stopDictation: () => Promise<void>;
}

export class ReadAloudController {
  private activeChunks: SynthesisTextChunk[] = [];
  private activeSynthesisId: number | null = null;
  private lastPlayedSequence = -1;
  private nextSynthesisId = 1;
  private pendingStartRevision = 0;
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

  async read(editor: Editor): Promise<void> {
    const source = editor.getValue();
    const range = resolveReadRange(editor, source);
    const chunks = extractAndSegmentMarkdown(source, range);
    if (chunks.length === 0) {
      this.deps.feedback.show({ intent: 'warning', message: t('tts.notice.noText') });
      return;
    }
    const configuration = this.resolveSynthesisConfiguration();
    if (configuration === null) return;
    const startRevision = ++this.pendingStartRevision;
    if (this.deps.isDictationBusy()) await this.deps.stopDictation();
    if (startRevision !== this.pendingStartRevision) return;
    await this.startChunks(chunks, this.deps.getSettings().ttsSpeed, configuration);
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
    this.pendingStartRevision += 1;
    await this.startChunks(remaining, speed, configuration);
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
  ): Promise<void> {
    const previousSynthesisId = this.activeSynthesisId;
    if (previousSynthesisId !== null) {
      this.deps.sidecarConnection.cancelSynthesis(previousSynthesisId);
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
      this.deps.feedback.show({
        intent: 'warning',
        message: t('tts.notice.modelRequired'),
      });
      this.stop();
      return null;
    }
    const catalogModel = this.deps
      .getCatalog()
      .models.find((model) =>
        matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
      );
    if (catalogModel === undefined) {
      this.deps.feedback.show({
        intent: 'warning',
        message: t('tts.notice.modelRequired'),
      });
      this.stop();
      return null;
    }
    const voiceId = resolveReadAloudVoiceId(settings.selectedTtsVoice, catalogModel.defaultVoice);
    if (voiceId === null) {
      this.deps.feedback.show({ intent: 'warning', message: t('tts.notice.voiceRequired') });
      this.stop();
      return null;
    }
    return {
      modelSelection: selection,
      ...(settings.modelStorePathOverride.length > 0
        ? { modelStorePathOverride: settings.modelStorePathOverride }
        : {}),
      voiceId,
    };
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
    this.activeChunks = [];
    this.activeSynthesisId = null;
    this.lastPlayedSequence = -1;
    this.sampleRate = null;
    this.playback.stop();
    this.setState('idle');
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

export function resolveReadRange(editor: Editor, source: string): { from: number; to: number } {
  if (editor.somethingSelected()) {
    const anchor = editor.posToOffset(editor.getCursor('anchor'));
    const head = editor.posToOffset(editor.getCursor('head'));
    return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
  }

  return { from: 0, to: source.length };
}
