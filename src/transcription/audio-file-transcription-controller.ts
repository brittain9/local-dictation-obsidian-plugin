import type { TFile, Vault } from 'obsidian';

import { mixChannelsToMono, PcmFrameProcessor } from '../audio/pcm-frame-processor';
import type { SelectedModel } from '../models/model-management-types';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import {
  SidecarLifecycleConflictError,
  type SidecarLifecycleGate,
} from '../sidecar/sidecar-lifecycle-gate';
import { SidecarNotInstalledError } from '../sidecar/sidecar-paths';
import type { FileTranscriptionProgress } from './file-transcription-progress';

export const AUDIO_FILE_EXTENSIONS = new Set([
  'aac',
  'flac',
  'm4a',
  'mp3',
  'oga',
  'ogg',
  'opus',
  'wav',
  'webm',
]);

const INPUT_CHUNK_SAMPLES = 16_384;
const QUEUE_PAUSE_THRESHOLD = 3;
const TRAILING_SILENCE_SECONDS = 3;
const TRANSCRIPT_START = '<!-- speech-kit-transcript:start -->';
const TRANSCRIPT_END = '<!-- speech-kit-transcript:end -->';

interface DecodedAudio {
  channels: Float32Array[];
  sampleRate: number;
}

interface ActiveJob {
  cancelled: boolean;
  cancelledSignal: Promise<void>;
  path: string;
  resolveCancelled: () => void;
  sessionId: string | null;
}

export interface EmbeddedAudioReference {
  end: number;
  linkPath: string;
  start: number;
}

export interface EmbeddedAudioTranscript {
  reference: EmbeddedAudioReference;
  text: string;
}

interface AudioFileTranscriptionControllerDependencies {
  decodeAudio?: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
  feedback: Pick<UserFeedback, 'dismiss' | 'show'>;
  getSettings: () => PluginSettings;
  logger?: PluginLogger;
  onModelMissing: () => void;
  onProgress?: (state: FileTranscriptionProgress | null) => void;
  onSidecarMissing: () => void;
  resolveAudioLink?: (linkPath: string, sourcePath: string) => TFile | null;
  sidecarConnection: Pick<
    SidecarConnection,
    | 'cancelSession'
    | 'ensureStarted'
    | 'requestStopSession'
    | 'sendAudioFrameWithBackpressure'
    | 'sendContextResponse'
    | 'startSession'
    | 'subscribe'
  >;
  sidecarLifecycleGate: SidecarLifecycleGate;
  vault: Pick<Vault, 'create' | 'getAbstractFileByPath' | 'process' | 'read' | 'readBinary'>;
}

class FileTranscriptionCancelledError extends Error {}

export class AudioFileTranscriptionController {
  private activeJob: ActiveJob | null = null;

  constructor(private readonly dependencies: AudioFileTranscriptionControllerDependencies) {}

  isActive(): boolean {
    return this.activeJob !== null;
  }

  async transcribe(file: TFile): Promise<void> {
    const outputPath = markdownPathForAudio(file.path);
    if (this.dependencies.vault.getAbstractFileByPath(outputPath) !== null) {
      this.dependencies.feedback.show({
        intent: 'warning',
        message: t('audioFile.outputExists', { path: outputPath }),
      });
      return;
    }

    await this.runJob(file, async (job, settings, modelSelection) => {
      const transcript = await this.transcribeToText(
        file,
        job,
        settings,
        modelSelection,
        (processedSeconds, totalSeconds) =>
          this.reportProgress(job, processedSeconds / totalSeconds),
      );
      if (transcript.length === 0) {
        this.dependencies.feedback.show({
          intent: 'warning',
          key: 'audio-file-transcription',
          message: t('audioFile.noSpeech', { name: file.name }),
        });
        return;
      }

      await this.dependencies.vault.create(outputPath, `${transcript}\n`);
      this.dependencies.feedback.show({
        intent: 'success',
        key: 'audio-file-transcription',
        message: t('audioFile.completed', { path: outputPath }),
      });
    });
  }

  async transcribeMarkdown(file: TFile): Promise<void> {
    await this.runJob(file, async (job, settings, modelSelection) => {
      const markdown = await this.dependencies.vault.read(file);
      const resolved = findEmbeddedAudioReferences(markdown)
        .map((reference) => ({
          file: this.dependencies.resolveAudioLink?.(reference.linkPath, file.path) ?? null,
          reference,
        }))
        .filter((entry): entry is { file: TFile; reference: EmbeddedAudioReference } =>
          Boolean(entry.file),
        );

      if (resolved.length === 0) {
        this.dependencies.feedback.show({
          intent: 'warning',
          key: 'audio-file-transcription',
          message: t('audioFile.noEmbeddedAudio', { name: file.name }),
        });
        return;
      }

      const durations: number[] = [];
      for (const entry of resolved) {
        this.throwIfCancelledOrFailed(job, null);
        durations.push(await this.measureAudioDuration(entry.file, job));
      }
      const totalDurationSeconds = durations.reduce((total, duration) => total + duration, 0);

      const transcripts: EmbeddedAudioTranscript[] = [];
      let completedDurationSeconds = 0;
      for (const [index, entry] of resolved.entries()) {
        this.throwIfCancelledOrFailed(job, null);
        const text = await this.transcribeToText(
          entry.file,
          job,
          settings,
          modelSelection,
          (processedSeconds, currentDurationSeconds) =>
            this.reportProgress(
              job,
              (completedDurationSeconds + Math.min(processedSeconds, currentDurationSeconds)) /
                totalDurationSeconds,
            ),
        );
        if (text.length > 0) transcripts.push({ reference: entry.reference, text });
        completedDurationSeconds += durations[index] ?? 0;
      }

      this.throwIfCancelledOrFailed(job, null);
      if (transcripts.length > 0) {
        let applied = false;
        await this.dependencies.vault.process(file, (current) => {
          if (current !== markdown) return current;
          applied = true;
          return applyTranscriptBlocks(markdown, transcripts, t('audioFile.transcriptLabel'));
        });
        if (!applied) throw new Error('The Markdown file changed during transcription.');
      }
      this.reportProgress(job, 1);
      this.dependencies.feedback.show({
        intent: transcripts.length > 0 ? 'success' : 'warning',
        key: 'audio-file-transcription',
        message: t('audioFile.markdownCompleted', {
          completed: transcripts.length,
          total: resolved.length,
        }),
      });
    });
  }

  cancel(): void {
    const job = this.activeJob;
    if (job === null) return;
    job.cancelled = true;
    job.resolveCancelled();
    this.activeJob = null;
    this.dependencies.onProgress?.(null);
    if (job.sessionId !== null) {
      void this.dependencies.sidecarConnection.cancelSession(job.sessionId).catch(() => {});
    }
  }

  dispose(): void {
    this.cancel();
  }

  private async runJob(
    file: TFile,
    run: (job: ActiveJob, settings: PluginSettings, modelSelection: SelectedModel) => Promise<void>,
  ): Promise<void> {
    if (this.activeJob !== null) {
      this.dependencies.feedback.show({ intent: 'warning', message: t('audioFile.busy') });
      return;
    }

    const settings = this.dependencies.getSettings();
    const modelSelection = settings.selectedModel;
    if (modelSelection === null) {
      this.dependencies.feedback.show({
        intent: 'warning',
        message: t('settings.model.noModelSelected'),
      });
      this.dependencies.onModelMissing();
      return;
    }

    let resolveCancelled = () => {};
    const cancelledSignal = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    const job: ActiveJob = {
      cancelled: false,
      cancelledSignal,
      path: file.path,
      resolveCancelled,
      sessionId: null,
    };
    this.activeJob = job;
    this.reportProgress(job, 0);
    this.dependencies.feedback.show({
      intent: 'information',
      key: 'audio-file-transcription',
      message: t('audioFile.started', { name: file.name }),
    });

    try {
      await this.dependencies.sidecarLifecycleGate.runUse(async () => {
        await run(job, settings, modelSelection);
      });
    } catch (error) {
      if (error instanceof FileTranscriptionCancelledError) {
        this.dependencies.feedback.show({
          intent: 'information',
          key: 'audio-file-transcription',
          message: t('audioFile.cancelled', { name: file.name }),
        });
        return;
      }
      if (error instanceof SidecarNotInstalledError) {
        this.dependencies.onSidecarMissing();
        return;
      }
      const message =
        error instanceof SidecarLifecycleConflictError
          ? t('audioFile.engineBusy')
          : t('audioFile.failed', { name: file.name });
      this.dependencies.feedback.show({
        cause: error,
        intent: 'error',
        key: 'audio-file-transcription',
        message,
      });
      this.dependencies.logger?.error(
        'transcription',
        `file transcription failed: ${file.path}`,
        error,
      );
    } finally {
      if (this.activeJob === job) this.activeJob = null;
      this.dependencies.onProgress?.(null);
    }
  }

  private async transcribeToText(
    file: TFile,
    job: ActiveJob,
    settings: PluginSettings,
    modelSelection: SelectedModel,
    onProgress: (processedSeconds: number, totalSeconds: number) => void,
  ): Promise<string> {
    this.throwIfCancelledOrFailed(job, null);
    await this.dependencies.sidecarConnection.ensureStarted();
    this.throwIfCancelledOrFailed(job, null);
    const bytes = await this.dependencies.vault.readBinary(file);
    this.throwIfCancelledOrFailed(job, null);
    const decoded = await (this.dependencies.decodeAudio ?? decodeAudioFile)(bytes);
    this.throwIfCancelledOrFailed(job, null);
    const firstChannel = decoded.channels[0];
    if (firstChannel === undefined || firstChannel.length === 0 || decoded.sampleRate <= 0) {
      throw new Error('The audio file contains no decodable samples.');
    }
    const sampleCount = firstChannel.length;
    const totalSeconds = sampleCount / decoded.sampleRate;
    const operationTimeoutMs = Math.max(1_000, settings.sidecarRequestTimeoutSeconds * 1_000);

    const sessionId = crypto.randomUUID();
    job.sessionId = sessionId;
    const finalUtterances = new Map<number, string>();
    let queueDepth = 0;
    let terminalError: Error | null = null;
    let resolveStopped: (() => void) | null = null;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const unsubscribe = this.dependencies.sidecarConnection.subscribe((event) => {
      if (event.type === 'error' && event.sessionId === undefined) {
        terminalError = new Error(event.message);
        resolveStopped?.();
        return;
      }
      if (!('sessionId' in event) || event.sessionId !== sessionId) return;
      switch (event.type) {
        case 'context_request':
          this.dependencies.sidecarConnection.sendContextResponse(event.correlationId, null);
          return;
        case 'transcript_ready':
          if (!event.isFinal) return;
          if (event.text.trim().length > 0) {
            finalUtterances.set(event.utteranceIndex, event.text.trim());
          }
          onProgress(Math.min(event.utteranceEndMsInSession / 1_000, totalSeconds), totalSeconds);
          return;
        case 'transcription_queue_changed':
          queueDepth = event.queuedUtterances;
          return;
        case 'error':
          terminalError = new Error(event.message);
          resolveStopped?.();
          return;
        case 'session_stopped':
          if (!['sentence_complete', 'user_stop'].includes(event.reason)) {
            terminalError = new Error(`File transcription stopped: ${event.reason}.`);
          }
          resolveStopped?.();
          return;
      }
    });

    let started = false;
    let sessionFinished = false;
    try {
      await this.dependencies.sidecarConnection.startSession({
        accelerationPreference: settings.accelerationPreference,
        detailedTimestampsEnabled: false,
        diarizationEnabled: settings.diarizationEnabled,
        diarizationMaxSpeakers: settings.diarizationMaxSpeakers,
        includeSystemAudio: false,
        language: settings.dictationLanguage,
        mode: 'always_on',
        modelSelection,
        sessionId,
        sessionStartUnixMs: Date.now(),
        speakingStyle: settings.speakingStyle,
        forceContinuousTranscription: false,
        ...(settings.modelStorePathOverride.trim().length > 0
          ? { modelStorePathOverride: settings.modelStorePathOverride }
          : {}),
      });
      started = true;

      const processor = new PcmFrameProcessor({ sourceSampleRate: decoded.sampleRate });
      for (let offset = 0; offset < sampleCount; offset += INPUT_CHUNK_SAMPLES) {
        this.throwIfCancelledOrFailed(job, terminalError);
        await waitForQueueCapacity(
          () => queueDepth,
          () => this.throwIfCancelledOrFailed(job, terminalError),
          job.cancelledSignal,
          operationTimeoutMs,
        );
        const end = Math.min(sampleCount, offset + INPUT_CHUNK_SAMPLES);
        const channels = decoded.channels.map((channel) => channel.subarray(offset, end));
        await this.sendFrames(sessionId, processor.push(mixChannelsToMono(channels)));
        await yieldToEventLoop();
      }

      const trailingSilence = new Float32Array(
        Math.ceil(decoded.sampleRate * TRAILING_SILENCE_SECONDS),
      );
      await this.sendFrames(sessionId, processor.push(trailingSilence));
      this.dependencies.sidecarConnection.requestStopSession(sessionId);
      await waitForSessionStop(stopped, job.cancelledSignal, operationTimeoutMs);
      sessionFinished = true;
      this.throwIfCancelledOrFailed(job, terminalError);
      onProgress(totalSeconds, totalSeconds);

      return [...finalUtterances.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, text]) => text)
        .join('\n\n')
        .trim();
    } finally {
      unsubscribe();
      if (job.sessionId === sessionId) job.sessionId = null;
      if (started && !sessionFinished && !job.cancelled) {
        void this.dependencies.sidecarConnection.cancelSession(sessionId).catch(() => {});
      }
    }
  }

  private async measureAudioDuration(file: TFile, job: ActiveJob): Promise<number> {
    const bytes = await this.dependencies.vault.readBinary(file);
    this.throwIfCancelledOrFailed(job, null);
    const decoded = await (this.dependencies.decodeAudio ?? decodeAudioFile)(bytes);
    this.throwIfCancelledOrFailed(job, null);
    const sampleCount = decoded.channels[0]?.length ?? 0;
    if (decoded.channels.length === 0 || sampleCount === 0 || decoded.sampleRate <= 0) {
      throw new Error('The audio file contains no decodable samples.');
    }
    return sampleCount / decoded.sampleRate;
  }

  private reportProgress(job: ActiveJob, progress: number): void {
    if (this.activeJob !== job || job.cancelled) return;
    this.dependencies.onProgress?.({
      cancel: () => this.cancel(),
      path: job.path,
      progress: Math.max(0, Math.min(1, progress)),
    });
  }

  private async sendFrames(sessionId: string, frames: Int16Array[]): Promise<void> {
    for (const frame of frames) {
      const bytes = new Uint8Array(frame.byteLength);
      bytes.set(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
      await this.dependencies.sidecarConnection.sendAudioFrameWithBackpressure(sessionId, bytes);
    }
  }

  private throwIfCancelledOrFailed(job: ActiveJob, terminalError: Error | null): void {
    if (job.cancelled || this.activeJob !== job) throw new FileTranscriptionCancelledError();
    if (terminalError !== null) throw terminalError;
  }
}

export function findEmbeddedAudioReferences(markdown: string): EmbeddedAudioReference[] {
  const references: EmbeddedAudioReference[] = [];
  const wikiEmbed = /!\[\[([^\]]+)\]\]/gu;
  for (const match of markdown.matchAll(wikiEmbed)) {
    const rawTarget = match[1]?.split('|', 1)[0]?.trim() ?? '';
    const linkPath = stripSubpath(rawTarget);
    if (linkPath.length > 0 && hasSupportedAudioExtension(linkPath) && match.index !== undefined) {
      references.push({ end: match.index + match[0].length, linkPath, start: match.index });
    }
  }

  const markdownEmbed = /!\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/gu;
  for (const match of markdown.matchAll(markdownEmbed)) {
    const rawTarget = match[1] ?? '';
    const linkPath = stripSubpath(
      (rawTarget.startsWith('<') ? rawTarget.slice(1, -1) : rawTarget).trim(),
    );
    if (
      !isLocalLink(linkPath) ||
      !hasSupportedAudioExtension(linkPath) ||
      match.index === undefined
    ) {
      continue;
    }
    references.push({ end: match.index + match[0].length, linkPath, start: match.index });
  }

  return references.sort((left, right) => left.start - right.start);
}

export function applyTranscriptBlocks(
  markdown: string,
  transcripts: EmbeddedAudioTranscript[],
  label: string,
): string {
  let result = markdown;
  const ordered = [...transcripts].sort(
    (left, right) => right.reference.start - left.reference.start,
  );
  for (const { reference, text } of ordered) {
    const block = formatTranscriptBlock(text, label);
    const suffix = result.slice(reference.end);
    const existing = suffix.match(
      /^\s*\r?\n[ \t]*<!-- speech-kit-transcript:start -->[\s\S]*?<!-- speech-kit-transcript:end -->/u,
    );
    const replaceEnd = reference.end + (existing?.[0].length ?? 0);
    result = `${result.slice(0, reference.end)}\n\n${block}${result.slice(replaceEnd)}`;
  }
  return result;
}

export function isSupportedAudioFile(file: { extension: string }): boolean {
  return AUDIO_FILE_EXTENSIONS.has(file.extension.toLowerCase());
}

export function markdownPathForAudio(path: string): string {
  const extensionStart = path.lastIndexOf('.');
  return `${extensionStart > path.lastIndexOf('/') ? path.slice(0, extensionStart) : path}.md`;
}

function formatTranscriptBlock(text: string, label: string): string {
  const quoted = text
    .split(/\r?\n/u)
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
  return `${TRANSCRIPT_START}\n> [!quote] ${label}\n${quoted}\n${TRANSCRIPT_END}`;
}

function stripSubpath(path: string): string {
  return path.split('#', 1)[0]?.trim() ?? '';
}

function hasSupportedAudioExtension(path: string): boolean {
  const cleanPath = path.split(/[?#]/u, 1)[0] ?? '';
  const extension = cleanPath.slice(cleanPath.lastIndexOf('.') + 1);
  return AUDIO_FILE_EXTENSIONS.has(extension.toLowerCase());
}

function isLocalLink(path: string): boolean {
  return !/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(path);
}

async function decodeAudioFile(bytes: ArrayBuffer): Promise<DecodedAudio> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(bytes.slice(0));
    return {
      channels: Array.from({ length: audio.numberOfChannels }, (_, index) =>
        audio.getChannelData(index).slice(),
      ),
      sampleRate: audio.sampleRate,
    };
  } finally {
    await context.close();
  }
}

async function waitForQueueCapacity(
  getQueueDepth: () => number,
  assertCanContinue: () => void,
  cancelledSignal: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (getQueueDepth() >= QUEUE_PAUSE_THRESHOLD) {
    assertCanContinue();
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('Timed out waiting for transcription queue capacity.');
    await Promise.race([delay(Math.min(25, remainingMs)), cancelledSignal]);
  }
  assertCanContinue();
}

function waitForSessionStop(
  stopped: Promise<void>,
  cancelledSignal: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (next: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutHandle);
      next();
    };
    const timeoutHandle = window.setTimeout(() => {
      finish(() => reject(new Error('Timed out waiting for file transcription to finish.')));
    }, timeoutMs);
    void stopped.then(
      () => finish(resolve),
      (error: unknown) =>
        finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
    void cancelledSignal.then(() => {
      finish(() => reject(new FileTranscriptionCancelledError()));
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function yieldToEventLoop(): Promise<void> {
  return delay(0);
}
