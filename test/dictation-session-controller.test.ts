import { describe, expect, it, vi } from 'vitest';
import {
  type DictationControllerState,
  DictationSessionController,
} from '../src/dictation/dictation-session-controller';
import type { NotePlacementOptions } from '../src/editor/note-surface';
import type { TranscriptRevision } from '../src/session/session-journal';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import type {
  ContextWindow,
  LlmPostprocessConfig,
  QueueBackpressureTier,
  SidecarEvent,
  StartSessionCommand,
} from '../src/sidecar/protocol';
import type { TranscriptRenderOptions } from '../src/transcript/renderer';

class FakeCaptureStream {
  public capturing = false;
  public frameListener: ((sessionId: string, frameBytes: Uint8Array) => void) | null = null;
  public sessionId: string | null = null;
  public start = vi.fn(
    async (sessionId: string, listener: (sessionId: string, frameBytes: Uint8Array) => void) => {
      this.capturing = true;
      this.sessionId = sessionId;
      this.frameListener = listener;
    },
  );
  public stop = vi.fn(async () => {
    this.capturing = false;
    this.sessionId = null;
    this.frameListener = null;
  });

  emitFrame(frameBytes: Uint8Array): void {
    if (this.sessionId === null) {
      throw new Error('capture is not active');
    }
    this.frameListener?.(this.sessionId, frameBytes);
  }

  isCapturing(): boolean {
    return this.capturing;
  }
}

class FakeSession {
  public currentSessionText = '';
  public readonly acceptTranscript = vi.fn((revision: TranscriptRevision) => {
    if (revision.isFinal) {
      this.currentSessionText = revision.text;
    }
    return { kind: 'accepted' as const };
  });
  public readonly clearSessionProcessingMark = vi.fn();
  public readonly dispose = vi.fn();
  public readonly markSessionRangeAsProcessing = vi.fn(() => true);
  public readonly readCurrentSessionText = vi.fn(() => this.currentSessionText);
  public readonly readNoteGlossary = vi.fn(
    (_maxChars: number): { text: string; truncated: boolean } | null => null,
  );
  public readonly readNoteText = vi.fn(
    (_maxChars: number): { text: string; truncated: boolean } | null => null,
  );
  public readonly readPriorUtterances = vi.fn(
    (
      _maxCount: number,
      _maxCharsPerUtterance: number,
    ): Array<{
      text: string;
      truncated: boolean;
    }> => [],
  );
  public readonly replaceSessionRangeWithCleaned = vi.fn(
    (
      cleanText: string,
      _options?: {
        rawTextForCallout?: string;
        showRawBelow?: boolean;
      },
    ) => {
      this.currentSessionText = cleanText;
      return true;
    },
  );
  public readonly setAnchorMode = vi.fn((_mode: 'hidden' | 'visible') => {});
}

class FakeLogger {
  public readonly debug = vi.fn();
  public readonly error = vi.fn();
  public readonly warn = vi.fn();
}

class FakeSidecarConnection {
  public readonly batchCleanupRequests: Array<{
    config: LlmPostprocessConfig;
    noteContext: string | null;
    sessionId: string;
    transcriptText: string;
  }> = [];
  public readonly cancelSession = vi.fn(async (sessionId: string) => {
    this.emit({ reason: 'user_cancel', sessionId, type: 'session_stopped' });
    return { reason: 'user_cancel', sessionId, type: 'session_stopped' } as const;
  });
  public readonly ensureStarted = vi.fn(async () => {});
  public readonly listeners = new Set<(event: SidecarEvent) => void>();
  public readonly requestBatchCleanup = vi.fn(
    (payload: {
      config: LlmPostprocessConfig;
      noteContext: string | null;
      sessionId: string;
      transcriptText: string;
    }) => {
      this.batchCleanupRequests.push(payload);
    },
  );
  public readonly requestStopSession = vi.fn((_sessionId: string) => {});
  public readonly sendAudioFrame = vi.fn((_sessionId: string, _frameBytes: Uint8Array) => {});
  public readonly sendContextResponse = vi.fn(
    (_correlationId: string, _context: ContextWindow | null) => {},
  );
  public readonly startSession = vi.fn(async (payload: Omit<StartSessionCommand, 'type'>) => {
    this.emit({ mode: payload.mode, sessionId: payload.sessionId, type: 'session_started' });
    this.emit({ sessionId: payload.sessionId, state: 'listening', type: 'session_state_changed' });
    return { mode: payload.mode, sessionId: payload.sessionId, type: 'session_started' } as const;
  });
  public readonly subscribe = vi.fn((listener: (event: SidecarEvent) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  });

  emit(event: SidecarEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe('DictationSessionController', () => {
  it('starts a bare-UUID session and tags audio frames with that session id', async () => {
    const captureStream = new FakeCaptureStream();
    const sidecarConnection = new FakeSidecarConnection();
    const controller = createController({ captureStream, sidecarConnection });

    await controller.startDictation();

    const startPayload = sidecarConnection.startSession.mock.calls[0]?.[0];
    expect(startPayload?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(startPayload?.sessionId.startsWith('session-')).toBe(false);

    const frame = new Uint8Array(640).fill(3);
    captureStream.emitFrame(frame);

    expect(sidecarConnection.sendAudioFrame).toHaveBeenCalledWith(startPayload?.sessionId, frame);
    expect(controller.getState()).toBe('listening');
  });

  it('accepts late transcript events from a stopped session after a new session starts', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionA = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    await controller.stopDictation();
    await controller.startDictation();
    const sessionB = sidecarConnection.startSession.mock.calls[1]?.[0].sessionId ?? '';

    sidecarConnection.emit(transcriptReady(sessionA, 'alpha'));
    sidecarConnection.emit(transcriptReady(sessionB, 'bravo'));

    expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: sessionA, text: 'alpha' }),
    );
    expect(sessions[1]?.acceptTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: sessionB, text: 'bravo' }),
    );
    expect(controller.getState()).toBe('listening');
  });

  it('silently enforces the five-session active plus draining cap', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const controller = createController({ sidecarConnection });

    for (let index = 0; index < 5; index += 1) {
      await controller.startDictation();
      await controller.stopDictation();
    }

    await controller.startDictation();

    expect(sidecarConnection.startSession).toHaveBeenCalledTimes(5);
  });

  it('runs batch cleanup through the sidecar and applies the ready event', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'batch',
          llmPostprocessModel: 'llama3.2:latest',
          selectedModel: createExternalModelSelection(),
        }),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await controller.stopDictation();
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    expect(sidecarConnection.requestBatchCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        transcriptText: 'raw transcript',
      }),
    );

    sidecarConnection.emit({
      cleanText: 'Clean transcript.',
      rawText: 'raw transcript',
      sessionId,
      stageResults: [],
      type: 'batch_cleanup_ready',
    });

    expect(sessions[0]?.replaceSessionRangeWithCleaned).toHaveBeenCalledWith(
      'Clean transcript.',
      expect.objectContaining({ rawTextForCallout: 'raw transcript' }),
    );
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('warns when batch cleanup cannot read transcript text after the note closes', async () => {
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'batch',
          llmPostprocessModel: 'llama3.2:latest',
          selectedModel: createExternalModelSelection(),
        }),
      logger,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await controller.stopDictation();
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    session.currentSessionText = '';
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    expect(sidecarConnection.requestBatchCleanup).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'llm',
      'batch cleanup skipped: locked note closed before transcript could be read',
    );
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('cleans up silently when the sidecar rejects capacity as a backstop', async () => {
    const captureStream = new FakeCaptureStream();
    const logger = new FakeLogger();
    const notice = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSession: (session) => {
        sessions.push(session);
      },
      logger,
      notice,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';

    sidecarConnection.emit({
      code: 'session_capacity_exceeded',
      message: 'capacity exceeded',
      sessionId,
      type: 'error',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(notice).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(captureStream.stop).toHaveBeenCalledTimes(1);
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe('idle');
  });

  it('handles stop during a pending start without opening capture', async () => {
    const captureStream = new FakeCaptureStream();
    const sidecarConnection = new FakeSidecarConnection();
    const resolveStart: {
      current?: (value: Awaited<ReturnType<FakeSidecarConnection['startSession']>>) => void;
    } = {};
    sidecarConnection.startSession.mockImplementationOnce(
      (payload: Omit<StartSessionCommand, 'type'>) =>
        new Promise((resolve) => {
          resolveStart.current = resolve;
          sidecarConnection.emit({
            mode: payload.mode,
            sessionId: payload.sessionId,
            type: 'session_started',
          });
        }),
    );
    const controller = createController({ captureStream, sidecarConnection });

    const startPromise = controller.startDictation();
    await Promise.resolve();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    await controller.stopDictation();

    const completeStart = resolveStart.current;
    if (completeStart === undefined) {
      throw new Error('startSession promise was not captured');
    }
    completeStart({ mode: 'always_on', sessionId, type: 'session_started' });
    await startPromise;

    expect(sidecarConnection.requestStopSession).toHaveBeenCalledWith(sessionId);
    expect(captureStream.start).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('idle');
  });
});

function createController({
  captureStream = new FakeCaptureStream(),
  createSession,
  getSettings = () => createSettings({ selectedModel: createExternalModelSelection() }),
  logger = new FakeLogger(),
  notice = vi.fn(),
  sidecarConnection = new FakeSidecarConnection(),
}: {
  captureStream?: FakeCaptureStream;
  createSession?: (session: FakeSession) => void;
  getSettings?: () => PluginSettings;
  logger?: FakeLogger;
  notice?: (message: string) => void;
  sidecarConnection?: FakeSidecarConnection;
} = {}): DictationSessionController {
  return new DictationSessionController({
    captureStream,
    createSession: (_options: {
      callbacks: {
        onLockedNoteClosed: () => void;
        onLockedNoteDeleted: () => void;
      };
      placement: NotePlacementOptions;
      rendererOptions: TranscriptRenderOptions;
      sessionId: string;
    }) => {
      const session = new FakeSession();
      createSession?.(session);
      return session;
    },
    getSettings,
    logger,
    notice,
    onModelMissing: vi.fn(),
    onSidecarMissing: vi.fn(),
    setRibbonQueueTier: vi.fn((_tier: QueueBackpressureTier) => {}),
    setRibbonState: vi.fn((_state: DictationControllerState) => {}),
    sidecarConnection,
  });
}

function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_PLUGIN_SETTINGS,
    ...overrides,
  };
}

function createExternalModelSelection(): NonNullable<PluginSettings['selectedModel']> {
  return {
    familyId: 'whisper',
    filePath: '/tmp/model.bin',
    kind: 'external_file',
    runtimeId: 'whisper_cpp',
  };
}

function transcriptReady(sessionId: string, text: string): SidecarEvent {
  return {
    isFinal: true,
    llmPostprocessRawText: null,
    pauseMsBeforeUtterance: null,
    processingDurationMs: 12,
    revision: 0,
    segments: [],
    sessionId,
    stageResults: [],
    text,
    type: 'transcript_ready',
    utteranceDurationMs: 1000,
    utteranceEndMsInSession: 1000,
    utteranceId: crypto.randomUUID(),
    utteranceIndex: 0,
    utteranceStartMsInSession: 0,
    warnings: [],
  };
}
