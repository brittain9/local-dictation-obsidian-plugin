import type { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import type { SidecarEvent, StartSessionCommand } from '../src/sidecar/protocol';
import { SidecarLifecycleGate } from '../src/sidecar/sidecar-lifecycle-gate';
import {
  AudioFileTranscriptionController,
  applyTranscriptBlocks,
  findEmbeddedAudioReferences,
  isSupportedAudioFile,
  markdownPathForAudio,
} from '../src/transcription/audio-file-transcription-controller';
import type { FileTranscriptionProgress } from '../src/transcription/file-transcription-progress';

describe('audio file transcription', () => {
  it.each(['wav', 'MP3', 'flac', 'm4a', 'ogg', 'opus', 'webm'])(
    'recognizes .%s as an audio file',
    (extension) => {
      expect(isSupportedAudioFile({ extension })).toBe(true);
    },
  );

  it('creates a same-directory Markdown path from the audio basename', () => {
    expect(markdownPathForAudio('Recordings/interview.v2.wav')).toBe('Recordings/interview.v2.md');
  });

  it('finds local wiki and Markdown audio embeds while ignoring images and remote audio', () => {
    const markdown = [
      '![[Recording 1.webm]]',
      '![[Audio/interview.mp3|Interview]]',
      '![memo](Audio/memo.m4a)',
      '![photo](photo.png)',
      '![remote](https://example.com/audio.wav)',
    ].join('\n');

    expect(findEmbeddedAudioReferences(markdown).map(({ linkPath }) => linkPath)).toEqual([
      'Recording 1.webm',
      'Audio/interview.mp3',
      'Audio/memo.m4a',
    ]);
  });

  it('inserts multiple transcript blocks below their embeds in source order', () => {
    const markdown = '![[first.wav]]\n\nMiddle\n\n![[second.ogg]]\n';
    const [firstReference, secondReference] = findEmbeddedAudioReferences(markdown);
    if (firstReference === undefined || secondReference === undefined) {
      throw new Error('Expected two embedded audio references.');
    }
    const result = applyTranscriptBlocks(
      markdown,
      [
        { reference: firstReference, text: 'First transcript' },
        { reference: secondReference, text: 'Second transcript' },
      ],
      'Transcript',
    );

    expect(result.indexOf('First transcript')).toBeLessThan(result.indexOf('Middle'));
    expect(result.indexOf('Middle')).toBeLessThan(result.indexOf('Second transcript'));
    expect(result.match(/speech-kit-transcript:start/gu)).toHaveLength(2);
  });

  it('replaces an existing generated transcript block instead of duplicating it', () => {
    const original = [
      '![[recording.wav]]',
      '',
      '<!-- speech-kit-transcript:start -->',
      '> [!quote] Transcript',
      '> Old text',
      '<!-- speech-kit-transcript:end -->',
      '',
      'Following text',
    ].join('\n');
    const reference = findEmbeddedAudioReferences(original)[0];
    if (reference === undefined) throw new Error('Expected an embedded audio reference.');
    const result = applyTranscriptBlocks(original, [{ reference, text: 'New text' }], 'Transcript');

    expect(result).not.toContain('Old text');
    expect(result).toContain('New text');
    expect(result).toContain('Following text');
    expect(result.match(/speech-kit-transcript:start/gu)).toHaveLength(1);
  });

  it('feeds decoded audio through the selected ASR session and creates the transcript note', async () => {
    let listener: ((event: SidecarEvent) => void) | null = null;
    let sessionId = '';
    const sendAudioFrameWithBackpressure = vi.fn(async () => {});
    const create = vi.fn(async () => ({}) as TFile);
    const progress = vi.fn();
    const sidecarConnection = {
      cancelSession: vi.fn(async (id: string) => ({
        reason: 'user_cancel' as const,
        sessionId: id,
        type: 'session_stopped' as const,
      })),
      ensureStarted: vi.fn(async () => {}),
      requestStopSession: vi.fn((id: string) => {
        listener?.(transcriptEvent(id, 1, 'second'));
        listener?.(transcriptEvent(id, 0, 'first'));
        listener?.({ reason: 'user_stop', sessionId: id, type: 'session_stopped' });
      }),
      sendAudioFrameWithBackpressure,
      sendContextResponse: vi.fn(),
      startSession: vi.fn(async (payload: Omit<StartSessionCommand, 'type'>) => {
        sessionId = payload.sessionId;
        return { mode: payload.mode, sessionId, type: 'session_started' as const };
      }),
      subscribe: vi.fn((nextListener: (event: SidecarEvent) => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      }),
    };
    const controller = new AudioFileTranscriptionController({
      decodeAudio: async () => ({
        channels: [new Float32Array(1_600).fill(0.1)],
        sampleRate: 16_000,
      }),
      feedback: { dismiss: vi.fn(), show: vi.fn() },
      getSettings: () => ({
        ...DEFAULT_PLUGIN_SETTINGS,
        selectedModel: {
          familyId: 'funasr_hybrid',
          kind: 'catalog_model',
          modelId: 'funasr-hybrid-sensevoice-small-q8',
          runtimeId: 'funasr_llamacpp',
        },
      }),
      onModelMissing: vi.fn(),
      onProgress: progress,
      onSidecarMissing: vi.fn(),
      sidecarConnection,
      sidecarLifecycleGate: new SidecarLifecycleGate(),
      vault: {
        create,
        getAbstractFileByPath: vi.fn(() => null),
        process: vi.fn(async (_file: TFile, transform: (data: string) => string) => transform('')),
        read: vi.fn(async () => ''),
        readBinary: vi.fn(async () => new ArrayBuffer(4)),
      },
    });

    await controller.transcribe({
      extension: 'wav',
      name: 'meeting.wav',
      path: 'Audio/meeting.wav',
    } as TFile);

    expect(sessionId).not.toBe('');
    expect(sendAudioFrameWithBackpressure).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('Audio/meeting.md', 'first\n\nsecond\n');
    expect(controller.isActive()).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(null);
    expect(
      progress.mock.calls
        .map(([state]) => state?.progress)
        .filter((value): value is number => value !== undefined),
    ).toEqual(expect.arrayContaining([0, 1]));
  });

  it('reports progress from finalized audio seconds instead of submitted frames', async () => {
    let listener: ((event: SidecarEvent) => void) | null = null;
    const progress = vi.fn();
    const controller = createController({
      decodeAudio: async () => ({
        channels: [new Float32Array(16_000)],
        sampleRate: 16_000,
      }),
      onProgress: progress,
      onStop: (sessionId) => {
        listener?.(transcriptEvent(sessionId, 0, 'halfway'));
        listener?.({ reason: 'user_stop', sessionId, type: 'session_stopped' });
      },
      setListener: (next) => {
        listener = next;
      },
    });

    await controller.transcribe(audioFile('one-second.wav'));

    const values = progress.mock.calls
      .map(([state]) => state?.progress)
      .filter((value): value is number => value !== undefined);
    expect(values).toContain(0.5);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('weights Markdown batch progress by audio duration', async () => {
    let listener: ((event: SidecarEvent) => void) | null = null;
    const progress = vi.fn();
    const durations: Record<string, number> = { 'long.wav': 3, 'short.wav': 1 };
    let currentPath = '';
    const controller = createController({
      decodeAudio: async () => ({
        channels: [new Float32Array(16_000 * (durations[currentPath] ?? 1))],
        sampleRate: 16_000,
      }),
      markdown: '![[short.wav]]\n![[long.wav]]',
      onProgress: progress,
      onReadBinary: (file) => {
        currentPath = file.path;
      },
      onStop: (sessionId) => {
        listener?.(transcriptEvent(sessionId, 0, 'done'));
        listener?.({ reason: 'user_stop', sessionId, type: 'session_stopped' });
      },
      setListener: (next) => {
        listener = next;
      },
    });

    await controller.transcribeMarkdown(audioFile('note.md'));

    const values = progress.mock.calls
      .map(([state]) => state?.progress)
      .filter((value): value is number => value !== undefined);
    expect(values).toContain(0.25);
    expect(values).not.toContain(0.5);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it.each([
    {
      event: { code: 'sidecar_exited', message: 'Sidecar exited.', type: 'error' } as const,
      label: 'a global sidecar error',
    },
    {
      event: {
        reason: 'queue_overload',
        sessionId: 'replace-at-runtime',
        type: 'session_stopped',
      } as const,
      label: 'an overloaded session stop',
    },
  ])('does not create a partial transcript after $label', async ({ event }) => {
    let listener: ((event: SidecarEvent) => void) | null = null;
    const onCreate = vi.fn();
    const controller = createController({
      decodeAudio: async () => ({
        channels: [new Float32Array(16_000)],
        sampleRate: 16_000,
      }),
      onCreate,
      onProgress: vi.fn(),
      onStop: (sessionId) => {
        listener?.(event.type === 'session_stopped' ? { ...event, sessionId } : event);
      },
      setListener: (next) => {
        listener = next;
      },
    });

    await controller.transcribe(audioFile('failed.wav'));

    expect(onCreate).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  it('finishes cancellation without waiting for a session-stopped event', async () => {
    const cancelSession = vi.fn(async (sessionId: string) => ({
      reason: 'user_cancel' as const,
      sessionId,
      type: 'session_stopped' as const,
    }));
    let controller: AudioFileTranscriptionController;
    controller = createController({
      cancelSession,
      decodeAudio: async () => ({
        channels: [new Float32Array(16_000)],
        sampleRate: 16_000,
      }),
      onCreate: vi.fn(),
      onProgress: vi.fn(),
      onStop: () => controller.cancel(),
      setListener: vi.fn(),
    });

    await controller.transcribe(audioFile('cancelled.wav'));

    expect(cancelSession).toHaveBeenCalledOnce();
    expect(controller.isActive()).toBe(false);
  });
});

function audioFile(path: string): TFile {
  return { extension: path.split('.').pop() ?? '', name: path, path } as TFile;
}

function createController(options: {
  cancelSession?: (
    sessionId: string,
  ) => Promise<{ reason: 'user_cancel'; sessionId: string; type: 'session_stopped' }>;
  decodeAudio: (bytes: ArrayBuffer) => Promise<{ channels: Float32Array[]; sampleRate: number }>;
  markdown?: string;
  onCreate?: () => void;
  onProgress: (state: FileTranscriptionProgress | null) => void;
  onReadBinary?: (file: TFile) => void;
  onStop: (sessionId: string) => void;
  setListener: (listener: ((event: SidecarEvent) => void) | null) => void;
}): AudioFileTranscriptionController {
  const files = new Map([
    ['short.wav', audioFile('short.wav')],
    ['long.wav', audioFile('long.wav')],
  ]);
  return new AudioFileTranscriptionController({
    decodeAudio: options.decodeAudio,
    feedback: { dismiss: vi.fn(), show: vi.fn() },
    getSettings: () => ({
      ...DEFAULT_PLUGIN_SETTINGS,
      selectedModel: {
        familyId: 'funasr_hybrid',
        kind: 'catalog_model',
        modelId: 'funasr-hybrid-sensevoice-small-q8',
        runtimeId: 'funasr_llamacpp',
      },
    }),
    onModelMissing: vi.fn(),
    onProgress: (state) => options.onProgress(state),
    onSidecarMissing: vi.fn(),
    resolveAudioLink: (path) => files.get(path) ?? null,
    sidecarConnection: {
      cancelSession:
        options.cancelSession ??
        vi.fn(async (sessionId: string) => ({
          reason: 'user_cancel' as const,
          sessionId,
          type: 'session_stopped' as const,
        })),
      ensureStarted: vi.fn(async () => {}),
      requestStopSession: vi.fn(options.onStop),
      sendAudioFrameWithBackpressure: vi.fn(async () => {}),
      sendContextResponse: vi.fn(),
      startSession: vi.fn(async (payload: Omit<StartSessionCommand, 'type'>) => ({
        mode: payload.mode,
        sessionId: payload.sessionId,
        type: 'session_started' as const,
      })),
      subscribe: vi.fn((listener: (event: SidecarEvent) => void) => {
        options.setListener(listener);
        return () => options.setListener(null);
      }),
    },
    sidecarLifecycleGate: new SidecarLifecycleGate(),
    vault: {
      create: vi.fn(async () => {
        options.onCreate?.();
        return {} as TFile;
      }),
      getAbstractFileByPath: vi.fn(() => null),
      process: vi.fn(async (_file: TFile, transform: (data: string) => string) =>
        transform(options.markdown ?? ''),
      ),
      read: vi.fn(async () => options.markdown ?? ''),
      readBinary: vi.fn(async (file: TFile) => {
        options.onReadBinary?.(file);
        return new ArrayBuffer(4);
      }),
    },
  });
}

function transcriptEvent(sessionId: string, utteranceIndex: number, text: string): SidecarEvent {
  return {
    isFinal: true,
    pauseMsBeforeUtterance: null,
    processingDurationMs: 10,
    revision: 1,
    segments: [],
    sessionId,
    speakerIndex: null,
    stageResults: [],
    text,
    type: 'transcript_ready',
    utteranceDurationMs: 500,
    utteranceEndMsInSession: (utteranceIndex + 1) * 500,
    utteranceId: `utterance-${utteranceIndex}`,
    utteranceIndex,
    utteranceStartMsInSession: utteranceIndex * 500,
    warnings: [],
  };
}
