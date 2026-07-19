import type { Editor } from 'obsidian';

import { PcmPlaybackQueue } from '../audio/pcm-playback-queue';
import type { ModelCatalogRecord } from '../models/model-management-types';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { SidecarEvent, SynthesisAudioFrame, SynthesisTextChunk } from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { extractAndSegmentMarkdown } from './markdown-extractor';

export type ReadAloudState = 'idle' | 'paused' | 'reading';

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

  async read(editor: Editor, entireNote = false): Promise<void> {
    const source = editor.getValue();
    const range = resolveReadRange(editor, source, entireNote);
    const chunks = extractAndSegmentMarkdown(source, range);
    if (chunks.length === 0) {
      this.deps.feedback.show({ intent: 'warning', message: t('tts.notice.noText') });
      return;
    }
    if (this.deps.isDictationBusy()) await this.deps.stopDictation();
    await this.startChunks(chunks, this.deps.getSettings().ttsSpeed);
  }

  async togglePaused(): Promise<void> {
    if (!this.isActive()) return;
    const paused = await this.playback.togglePaused();
    this.setState(paused ? 'paused' : 'reading');
  }

  stop(): void {
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
    await this.startChunks(remaining, speed);
  }

  dispose(): void {
    this.stop();
    this.releaseAudio?.();
    this.releaseAudio = null;
    this.releaseEvents?.();
    this.releaseEvents = null;
  }

  private async startChunks(chunks: SynthesisTextChunk[], speed: number): Promise<void> {
    if (this.activeSynthesisId !== null) {
      this.deps.sidecarConnection.cancelSynthesis(this.activeSynthesisId);
    }
    const settings = this.deps.getSettings();
    const selection = settings.selectedTtsModel;
    if (selection === null || selection.kind !== 'catalog_model') {
      this.deps.feedback.show({
        intent: 'warning',
        message: t('tts.notice.modelRequired'),
      });
      this.clearActive();
      return;
    }
    const catalogModel = this.deps
      .getCatalog()
      .models.find(
        (model) =>
          model.runtimeId === selection.runtimeId &&
          model.familyId === selection.familyId &&
          model.modelId === selection.modelId,
      );
    const voiceId = settings.selectedTtsVoice ?? catalogModel?.defaultVoice ?? null;
    if (voiceId === null) {
      this.deps.feedback.show({ intent: 'warning', message: t('tts.notice.voiceRequired') });
      this.clearActive();
      return;
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
        modelSelection: selection,
        ...(settings.modelStorePathOverride.length > 0
          ? { modelStorePathOverride: settings.modelStorePathOverride }
          : {}),
        speed,
        synthesisId,
        voiceId,
      });
    } catch (error) {
      this.deps.logger?.error('tts', 'failed to start read aloud', error);
      this.deps.feedback.show({
        cause: error,
        intent: 'error',
        message: t('tts.notice.startFailed'),
      });
      this.clearActive();
    }
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
      case 'synthesis_error':
        this.deps.feedback.show({
          intent: 'error',
          message: `${event.message}${event.details === undefined ? '' : ` (${event.details})`}`,
        });
        this.clearActive();
        break;
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

export function resolveReadRange(
  editor: Editor,
  source: string,
  entireNote: boolean,
): { from: number; to: number } {
  if (entireNote) return { from: 0, to: source.length };
  if (editor.somethingSelected()) {
    const anchor = editor.posToOffset(editor.getCursor('anchor'));
    const head = editor.posToOffset(editor.getCursor('head'));
    return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
  }

  const cursor = editor.getCursor();
  let blockStartLine = cursor.line;
  while (blockStartLine > 0 && editor.getLine(blockStartLine - 1).trim().length > 0) {
    blockStartLine -= 1;
  }
  return {
    from: editor.posToOffset({ ch: 0, line: blockStartLine }),
    to: source.length,
  };
}
