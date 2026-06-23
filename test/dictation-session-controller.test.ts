import { describe, expect, it, vi } from 'vitest';
import { formatMicrophonePermissionDeniedMessage } from '../src/audio/microphone-permission-message';
import {
  type DictationControllerState,
  DictationSessionController,
} from '../src/dictation/dictation-session-controller';
import type { NotePlacementOptions } from '../src/editor/note-surface';
import { type LlmCleanupFailure, ProviderError } from '../src/llm/provider';
import type { LlmRouter, LlmRouterCleanupResult } from '../src/llm/router';
import type { TranscriptRevision } from '../src/session/session-journal';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import type {
  ContextWindow,
  QueueBackpressureTier,
  SidecarEvent,
  StartSessionCommand,
} from '../src/sidecar/protocol';
import type { TranscriptRenderOptions } from '../src/transcript/renderer';
import { createFakeLlmRouter, createUserPreset } from './fixtures/llm';

class FakeCaptureStream {
  public capturing = false;
  public frameListener: ((sessionId: string, frameBytes: Uint8Array) => void) | null = null;
  public sessionId: string | null = null;
  public start = vi.fn(
    async (
      options: { sessionId: string; audioInputDeviceId?: string | null },
      listener: (sessionId: string, frameBytes: Uint8Array) => void,
    ) => {
      this.capturing = true;
      this.sessionId = options.sessionId;
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
  public readonly acceptedTexts: string[] = [];
  public readonly acceptTranscript = vi.fn((revision: TranscriptRevision) => {
    this.acceptedTexts.push(revision.text);
    if (revision.isFinal) {
      this.currentSessionText = revision.text;
    }
    return { kind: 'accepted' as const };
  });
  public readonly clearSessionProcessingMark = vi.fn();
  public readonly dispose = vi.fn();
  public readonly insertAdjacentToSessionRange = vi.fn(
    (_blockText: string, _placement: 'above' | 'below') => true,
  );
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
  public readonly cancelSession = vi.fn(async (sessionId: string) => {
    this.emit({ reason: 'user_cancel', sessionId, type: 'session_stopped' });
    return { reason: 'user_cancel', sessionId, type: 'session_stopped' } as const;
  });
  public readonly ensureStarted = vi.fn(async () => {});
  public readonly listeners = new Set<(event: SidecarEvent) => void>();
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

class FakeAudioLevelMeter {
  public readonly bindSession = vi.fn((_sessionId: string) => {});
  public readonly clearSession = vi.fn((_sessionId: string) => {});
  public readonly update = vi.fn((_event: Extract<SidecarEvent, { type: 'audio_level' }>) => {});
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
    // The sidecar no longer runs LLM work, so start-session must not carry it.
    expect(startPayload).not.toHaveProperty('llmPostprocess');

    const frame = new Uint8Array(640).fill(3);
    captureStream.emitFrame(frame);

    expect(sidecarConnection.sendAudioFrame).toHaveBeenCalledWith(startPayload?.sessionId, frame);
    expect(controller.getState()).toBe('listening');
  });

  it('includes system audio without skipping microphone capture', async () => {
    const captureStream = new FakeCaptureStream();
    const sidecarConnection = new FakeSidecarConnection();
    const controller = createController({
      captureStream,
      sidecarConnection,
      getSettings: () =>
        createSettings({ includeSystemAudio: true, selectedModel: createExternalModelSelection() }),
    });

    await controller.startDictation();

    const startPayload = sidecarConnection.startSession.mock.calls[0]?.[0];
    expect(startPayload).toMatchObject({ includeSystemAudio: true });
    expect(captureStream.start).toHaveBeenCalledTimes(1);
    expect(captureStream.isCapturing()).toBe(true);

    const frame = new Uint8Array(640).fill(7);
    captureStream.emitFrame(frame);

    expect(sidecarConnection.sendAudioFrame).toHaveBeenCalledWith(startPayload?.sessionId, frame);
    expect(controller.getState()).toBe('listening');
  });

  it('binds ribbon audio levels to the active session and ignores stale level events', async () => {
    const audioLevelMeter = new FakeAudioLevelMeter();
    const sidecarConnection = new FakeSidecarConnection();
    const controller = createController({ audioLevelMeter, sidecarConnection });

    await controller.startDictation();

    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const event = {
      bands: [0, 0.1, 0.2, 0.3, 0.4, 1] as [number, number, number, number, number, number],
      peak: 0.9,
      rms: 0.25,
      sessionId,
      type: 'audio_level' as const,
    };
    expect(audioLevelMeter.bindSession).toHaveBeenCalledWith(sessionId);

    sidecarConnection.emit({ ...event, sessionId: crypto.randomUUID() });
    sidecarConnection.emit(event);

    expect(audioLevelMeter.update).toHaveBeenCalledTimes(1);
    expect(audioLevelMeter.update).toHaveBeenCalledWith(event);

    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    expect(audioLevelMeter.clearSession).toHaveBeenCalledWith(sessionId);
  });

  it('surfaces the bare microphone-permission message when capture is denied, without the generic start-failure prefix', async () => {
    const captureStream = new FakeCaptureStream();
    captureStream.start.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
    );
    const notice = vi.fn();
    const controller = createController({ captureStream, notice });

    await controller.startDictation();

    expect(notice).toHaveBeenCalledWith(formatMicrophonePermissionDeniedMessage());
    expect(notice).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to start the dictation session'),
    );
  });

  it('surfaces a descriptive no-microphone message when capture finds no input device', async () => {
    const captureStream = new FakeCaptureStream();
    captureStream.start.mockRejectedValueOnce(
      Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }),
    );
    const logger = new FakeLogger();
    const notice = vi.fn();
    const controller = createController({ captureStream, logger, notice });

    await controller.startDictation();

    expect(notice).toHaveBeenCalledWith(expect.stringContaining('No microphone detected'));
    expect(notice).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to start the dictation session'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'session',
      'Failed to start the dictation session',
      'Requested device not found',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not start the sidecar session when device enumeration finds no microphone', async () => {
    const captureStream = new FakeCaptureStream();
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const notice = vi.fn();
    const controller = createController({
      captureStream,
      countAudioInputDevices: async () => 0,
      logger,
      notice,
      sidecarConnection,
    });

    await controller.startDictation();

    expect(notice).toHaveBeenCalledWith(expect.stringContaining('No microphone detected'));
    expect(sidecarConnection.ensureStarted).not.toHaveBeenCalled();
    expect(sidecarConnection.startSession).not.toHaveBeenCalled();
    expect(captureStream.start).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('error');
    expect(logger.warn).toHaveBeenCalledWith(
      'session',
      'Failed to start the dictation session',
      'No audio input devices found.',
    );
    expect(logger.error).not.toHaveBeenCalled();
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

    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: sessionA, text: 'alpha' }),
      );
    });
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

  it('runs per-utterance cleanup through the router and keeps raw text for the callout', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'llama3.2:latest',
        providerId: 'ollama',
        text: 'Clean transcript.',
      }),
    );
    const onLlmCleanupSuccess = vi.fn();
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'per_utterance',
          llmPostprocessShowRawBelow: true,
          llmPostprocessSkipMinWords: 0,
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({ cleanup }),
      onLlmCleanupSuccess,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));

    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({ userMessage: '<utterance>\nraw transcript\n</utterance>' }),
      );
    });
    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          llmPostprocessRawText: 'raw transcript',
          text: 'Clean transcript.',
        }),
      );
    });
    expect(onLlmCleanupSuccess).toHaveBeenCalledTimes(1);
  });

  it('accepts cleaned per-utterance revisions in utterance order despite out-of-order completions', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const resolvers: Array<(value: LlmRouterCleanupResult) => void> = [];
    const cleanup = vi.fn(
      () =>
        new Promise<LlmRouterCleanupResult>((resolve) => {
          resolvers.push((value) => {
            resolve(value);
          });
        }),
    );
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'per_utterance',
          llmPostprocessSkipMinWords: 0,
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({ cleanup }),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';

    sidecarConnection.emit(transcriptReady(sessionId, 'first utterance'));
    sidecarConnection.emit(transcriptReady(sessionId, 'second utterance'));

    await vi.waitFor(() => {
      expect(resolvers).toHaveLength(2);
    });

    // Resolve the SECOND utterance's cleanup before the first.
    resolvers[1]?.({ model: 'm', providerId: 'ollama', text: 'second clean' });
    resolvers[0]?.({ model: 'm', providerId: 'ollama', text: 'first clean' });

    await vi.waitFor(() => {
      expect(sessions[0]?.acceptedTexts).toEqual(['first clean', 'second clean']);
    });
  });

  it('keeps raw transcript and reports a typed per-utterance cleanup failure', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const onLlmCleanupFailure = vi.fn();
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'per_utterance',
          llmPostprocessShowRawBelow: true,
          llmPostprocessSkipMinWords: 0,
          llmRouting: 'remote',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({
        cleanup: vi.fn(async () => {
          throw new ProviderError('bad key', 'auth_invalid');
        }),
        providerId: 'openrouter',
      }),
      onLlmCleanupFailure,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));

    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ llmPostprocessRawText: null, text: 'raw transcript' }),
      );
      expect(onLlmCleanupFailure).toHaveBeenCalledWith({
        code: 'auth_invalid',
        message: 'bad key',
        providerId: 'openrouter',
      });
    });
  });

  it('attributes cleanup failures to the provider selected by the router', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const onLlmCleanupFailure = vi.fn();
    const controller = createController({
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'per_utterance',
          llmPostprocessSkipMinWords: 0,
          llmRouting: 'remote',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({
        cleanup: vi.fn(async () => {
          throw new ProviderError('Ollama unavailable', 'connection_failed');
        }),
        providerId: 'ollama',
      }),
      onLlmCleanupFailure,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'private transcript'));

    await vi.waitFor(() => {
      expect(onLlmCleanupFailure).toHaveBeenCalledWith({
        code: 'connection_failed',
        message: 'Ollama unavailable',
        providerId: 'ollama',
      });
    });
  });

  it('runs batch cleanup through the router and replaces the session range', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'llama3.2:latest',
        providerId: 'ollama',
        text: 'Clean batch.',
      }),
    );
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'batch',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({ cleanup }),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await controller.stopDictation();
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: '<session_transcript>\nraw transcript\n</session_transcript>',
        }),
      );
    });
    await vi.waitFor(() => {
      expect(sessions[0]?.replaceSessionRangeWithCleaned).toHaveBeenCalledWith(
        'Clean batch.',
        expect.objectContaining({ rawTextForCallout: 'raw transcript' }),
      );
    });
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the raw utterance and reports failure when per-utterance cleanup returns empty text', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const onLlmCleanupFailure = vi.fn();
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'per_utterance',
          llmPostprocessSkipMinWords: 0,
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({
        cleanup: vi.fn(async () => ({ model: 'm', providerId: 'ollama' as const, text: '   ' })),
      }),
      onLlmCleanupFailure,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));

    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'raw transcript' }),
      );
    });
    expect(onLlmCleanupFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid_response' }),
    );
  });

  it('resolves the active preset prompt, overrides, and pinned timing into the snapshot', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'm',
        providerId: 'ollama',
        text: 'Clean batch.',
      }),
    );
    const controller = createController({
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessActivePresetRef: 'user:a',
          // Stored mode stays the user's choice; the preset pins batch timing.
          llmPostprocessMode: 'per_utterance',
          llmPostprocessTemperature: 0.2,
          llmPostprocessUserPresets: [
            createUserPreset({
              id: 'a',
              overrides: { temperature: 1.1 },
              prompt: 'P!',
              timing: 'batch',
            }),
          ],
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({ cleanup }),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await controller.stopDictation();
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'P!', temperature: 1.1 }),
      );
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('additive batch inserts adjacent to the session range instead of replacing', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'm',
        providerId: 'ollama',
        text: 'TLDR\n- point',
      }),
    );
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessActivePresetRef: 'builtin:tldr',
          llmPostprocessMode: 'batch',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({ cleanup }),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await controller.stopDictation();
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(sessions[0]?.insertAdjacentToSessionRange).toHaveBeenCalledWith(
        'TLDR\n- point',
        'above',
      );
    });
    expect(sessions[0]?.replaceSessionRangeWithCleaned).not.toHaveBeenCalled();
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('additive batch treats empty output as nothing to add and says so', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const notice = vi.fn();
    const onLlmCleanupFailure = vi.fn();
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      notice,
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessActivePresetRef: 'builtin:action-items',
          llmPostprocessMode: 'batch',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({
        cleanup: vi.fn(async () => ({ model: 'm', providerId: 'ollama' as const, text: '   ' })),
      }),
      onLlmCleanupFailure,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await controller.stopDictation();
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    });
    expect(sessions[0]?.insertAdjacentToSessionRange).not.toHaveBeenCalled();
    expect(onLlmCleanupFailure).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith('LLM transform returned nothing to add.');
  });

  it('drains pending utterance accepts before the batch read when stop arrives in the same turn', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'm',
        providerId: 'ollama',
        text: 'Clean batch.',
      }),
    );
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'batch',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({ cleanup }),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';

    // The sidecar delivers the final transcript_ready and session_stopped in one
    // I/O chunk; emit them in the same synchronous turn (no await between) so the
    // batch read must wait for the last utterance's accept to land.
    sidecarConnection.emit(transcriptReady(sessionId, 'final utterance'));
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: '<session_transcript>\nfinal utterance\n</session_transcript>',
        }),
      );
    });
  });

  it('keeps raw transcript when a batch cleanup fails and reports it', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const onLlmCleanupFailure = vi.fn();
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'batch',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({
        cleanup: vi.fn(async () => {
          throw new ProviderError('model gone', 'unknown_model');
        }),
      }),
      onLlmCleanupFailure,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await controller.stopDictation();
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(onLlmCleanupFailure).toHaveBeenCalledWith({
        code: 'unknown_model',
        message: 'model gone',
        providerId: 'ollama',
      });
    });
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    expect(session.replaceSessionRangeWithCleaned).not.toHaveBeenCalled();
    expect(session.clearSessionProcessingMark).toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('warns when batch cleanup cannot read transcript text after the note closes', async () => {
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'm',
        providerId: 'ollama',
        text: 'unused',
      }),
    );
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'batch',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({ cleanup }),
      logger,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalled();
    });
    await controller.stopDictation();
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    // The utterance has landed; now simulate the note closing so the batch read
    // comes back empty.
    session.currentSessionText = '';
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    expect(cleanup).not.toHaveBeenCalled();
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
    await vi.waitFor(() => {
      expect(sidecarConnection.startSession).toHaveBeenCalledTimes(1);
    });
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

  it('keeps the cursor through Stop and only releases it when the drained session is disposed', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }

    session.setAnchorMode.mockClear();
    await controller.stopDictation();

    // Stop must not hide the cursor — queued transcripts still land at it.
    expect(session.setAnchorMode).not.toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();

    // The drain completes; disposing the surface is what releases the cursor.
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('hides the cursor when the batch-cleanup flash starts', async () => {
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
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter(),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await vi.waitFor(() => {
      expect(session.acceptTranscript).toHaveBeenCalled();
    });
    await controller.stopDictation();

    session.setAnchorMode.mockClear();
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    expect(session.markSessionRangeAsProcessing).toHaveBeenCalledTimes(1);
    expect(session.setAnchorMode).toHaveBeenCalledWith('hidden');
  });
});

function createController({
  audioLevelMeter = new FakeAudioLevelMeter(),
  captureStream = new FakeCaptureStream(),
  countAudioInputDevices,
  createSession,
  llmRouter = createFakeLlmRouter(),
  getSettings = () => createSettings({ selectedModel: createExternalModelSelection() }),
  logger = new FakeLogger(),
  notice = vi.fn(),
  sidecarConnection = new FakeSidecarConnection(),
  onLlmCleanupFailure,
  onLlmCleanupSuccess,
}: {
  audioLevelMeter?: FakeAudioLevelMeter;
  captureStream?: FakeCaptureStream;
  countAudioInputDevices?: () => Promise<number | null>;
  createSession?: (session: FakeSession) => void;
  getSettings?: () => PluginSettings;
  llmRouter?: LlmRouter;
  logger?: FakeLogger;
  notice?: (message: string) => void;
  onLlmCleanupFailure?: (failure: LlmCleanupFailure) => void;
  onLlmCleanupSuccess?: () => void;
  sidecarConnection?: FakeSidecarConnection;
} = {}): DictationSessionController {
  return new DictationSessionController({
    captureStream,
    audioLevelMeter,
    ...(countAudioInputDevices !== undefined ? { countAudioInputDevices } : {}),
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
    createLlmRouter: () => llmRouter,
    getSettings,
    logger,
    notice,
    ...(onLlmCleanupFailure !== undefined ? { onLlmCleanupFailure } : {}),
    ...(onLlmCleanupSuccess !== undefined ? { onLlmCleanupSuccess } : {}),
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
    pauseMsBeforeUtterance: null,
    processingDurationMs: 12,
    revision: 0,
    segments: [],
    sessionId,
    speakerIndex: null,
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
