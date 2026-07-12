import { describe, expect, it, vi } from 'vitest';
import { formatMicrophonePermissionDeniedMessage } from '../src/audio/microphone-permission-message';
import {
  type DictationControllerState,
  DictationSessionController,
} from '../src/dictation/dictation-session-controller';
import type { MarkdownCommandSnapshot } from '../src/editor/markdown-command-mode';
import type { NotePlacementOptions, SurfaceDesynchronization } from '../src/editor/note-surface';
import type { SelectionRedictationSnapshot } from '../src/editor/selection-redictation';
import { type LlmCleanupFailure, ProviderError } from '../src/llm/provider';
import type { LlmRouter, LlmRouterCleanupResult } from '../src/llm/router';
import type { SessionAcceptResult } from '../src/session/session';
import type { TranscriptRevision } from '../src/session/session-journal';
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from '../src/settings/plugin-settings';
import type { UserFeedback } from '../src/shared/user-feedback';
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
  public readonly acceptTranscript = vi.fn((revision: TranscriptRevision): SessionAcceptResult => {
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
  public readonly onUserCancellation = vi.fn();
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

  it('does not start selection capture when its target becomes stale during preflight', async () => {
    const captureStream = new FakeCaptureStream();
    const feedback = { show: vi.fn() };
    const sidecarConnection = new FakeSidecarConnection();
    const preflight: { finish?: () => void } = {};
    sidecarConnection.ensureStarted.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          preflight.finish = resolve;
        }),
    );
    let targetCurrent = true;
    const isSelectionRedictationSnapshotCurrent = vi.fn(() => targetCurrent);
    const createSelectionRedictationSession = vi.fn();
    const controller = createController({
      captureStream,
      createSelectionRedictationSession,
      feedback,
      isSelectionRedictationSnapshotCurrent,
      sidecarConnection,
    });
    const selection = createSelectionSnapshot();

    const start = controller.startSelectionRedictation(selection);
    await vi.waitFor(() => {
      expect(sidecarConnection.ensureStarted).toHaveBeenCalledOnce();
    });
    targetCurrent = false;
    const finishPreflight = preflight.finish;
    if (finishPreflight === undefined) {
      throw new Error('sidecar preflight did not start');
    }
    finishPreflight();
    await start;

    expect(isSelectionRedictationSnapshotCurrent).toHaveBeenCalledWith(selection);
    expect(createSelectionRedictationSession).not.toHaveBeenCalled();
    expect(sidecarConnection.startSession).not.toHaveBeenCalled();
    expect(captureStream.start).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('idle');
    expect(feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'selection-redictation-start-stale',
      message:
        'Re-dictation did not start because the selected note changed or closed. No audio was captured. Select the text again and retry.',
    });
  });

  it('starts selection re-dictation with microphone-only capture and no diarization', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const controller = createController({
      getSettings: () =>
        createSettings({
          diarizationEnabled: true,
          includeSystemAudio: true,
          selectedModel: createExternalModelSelection(),
        }),
      sidecarConnection,
    });

    await controller.startSelectionRedictation(createSelectionSnapshot());

    expect(sidecarConnection.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        diarizationEnabled: false,
        includeSystemAudio: false,
      }),
    );
  });

  it('does not start a Markdown command when its target becomes stale during preflight', async () => {
    const captureStream = new FakeCaptureStream();
    const feedback = { show: vi.fn() };
    const sidecarConnection = new FakeSidecarConnection();
    const preflight: { finish?: () => void } = {};
    sidecarConnection.ensureStarted.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          preflight.finish = resolve;
        }),
    );
    let targetCurrent = true;
    const isMarkdownCommandSnapshotCurrent = vi.fn(() => targetCurrent);
    const createMarkdownCommandSession = vi.fn();
    const controller = createController({
      captureStream,
      createMarkdownCommandSession,
      feedback,
      isMarkdownCommandSnapshotCurrent,
      sidecarConnection,
    });
    const command = createMarkdownCommandSnapshot();

    const start = controller.startMarkdownCommand(command);
    await vi.waitFor(() => {
      expect(sidecarConnection.ensureStarted).toHaveBeenCalledOnce();
    });
    targetCurrent = false;
    const finishPreflight = preflight.finish;
    if (finishPreflight === undefined) {
      throw new Error('sidecar preflight did not start');
    }
    finishPreflight();
    await start;

    expect(isMarkdownCommandSnapshotCurrent).toHaveBeenCalledWith(command);
    expect(createMarkdownCommandSession).not.toHaveBeenCalled();
    expect(sidecarConnection.startSession).not.toHaveBeenCalled();
    expect(captureStream.start).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('idle');
    expect(feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'markdown-command-start-stale',
      message:
        'The Markdown command did not start because the note changed or closed. No audio was captured. Run the command again.',
    });
  });

  it('runs one microphone-only Markdown command without context or provider cleanup', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'remote-model',
        providerId: 'openrouter',
        text: 'provider output',
      }),
    );
    const llmRouter = createFakeLlmRouter({ cleanup, providerId: 'openrouter' });
    const controller = createController({
      createMarkdownCommandSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          diarizationEnabled: true,
          includeSystemAudio: true,
          llmFeaturesEnabled: true,
          llmPostprocessActivePresetRef: 'builtin:markdown-formatting',
          llmPostprocessMode: 'batch',
          llmPostprocessSkipMinWords: 0,
          llmRemoteFeaturesEnabled: true,
          llmRouting: 'remote',
          selectedModel: createExternalModelSelection(),
          useLlmNoteContext: true,
          useNoteAsContext: true,
        }),
      llmRouter,
      sidecarConnection,
    });

    await controller.startMarkdownCommand(createMarkdownCommandSnapshot());
    const startPayload = sidecarConnection.startSession.mock.calls[0]?.[0];
    const sessionId = startPayload?.sessionId ?? '';
    expect(startPayload).toEqual(
      expect.objectContaining({
        diarizationEnabled: false,
        includeSystemAudio: false,
      }),
    );

    sidecarConnection.emit({
      budgetChars: 200,
      correlationId: 'markdown-context',
      sessionId,
      type: 'context_request',
      utteranceId: crypto.randomUUID(),
    });
    expect(sidecarConnection.sendContextResponse).toHaveBeenCalledWith('markdown-context', null);
    expect(sessions[0]?.readNoteGlossary).not.toHaveBeenCalled();

    sidecarConnection.emit(transcriptReady(sessionId, 'bull', { isFinal: false }));
    sidecarConnection.emit(transcriptReady(sessionId, 'bullet'));
    sidecarConnection.emit(transcriptReady(sessionId, 'horizontal rule', { revision: 1 }));

    await vi.waitFor(() => {
      expect(sidecarConnection.requestStopSession).toHaveBeenCalledWith(sessionId);
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true, text: 'bullet' }),
      );
    });
    expect(sessions[0]?.acceptedTexts).toEqual(['bull', 'bullet']);
    expect(cleanup).not.toHaveBeenCalled();
    expect(llmRouter.selectProviderId).not.toHaveBeenCalled();
  });

  it('stops capture on the first selection final and ignores every later revision', async () => {
    const captureStream = new FakeCaptureStream();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSelectionRedictationSession: (session) => {
        sessions.push(session);
      },
      sidecarConnection,
    });

    await controller.startSelectionRedictation(createSelectionSnapshot());
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected selection session fixture');
    }

    sidecarConnection.emit(transcriptReady(sessionId, 'partial', { isFinal: false }));
    await vi.waitFor(() => {
      expect(session.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: false, text: 'partial' }),
      );
    });
    expect(sidecarConnection.requestStopSession).not.toHaveBeenCalled();

    sidecarConnection.emit(transcriptReady(sessionId, 'first final'));
    sidecarConnection.emit(transcriptReady(sessionId, 'second final'));

    await vi.waitFor(() => {
      expect(sidecarConnection.requestStopSession).toHaveBeenCalledWith(sessionId);
      expect(session.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true, text: 'first final' }),
      );
    });
    expect(captureStream.stop).toHaveBeenCalledOnce();
    expect(session.acceptedTexts).toEqual(['partial', 'first final']);
    expect(controller.getState()).toBe('idle');

    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalledOnce();
    });
  });

  it('notifies the selection session before cancellation rejects transcript work', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      createSelectionRedictationSession: (session) => {
        sessions.push(session);
      },
      sidecarConnection,
    });

    await controller.startSelectionRedictation(createSelectionSnapshot());
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected selection session fixture');
    }

    await controller.cancelDictation();
    sidecarConnection.emit(transcriptReady(sessionId, 'late final'));

    expect(session.onUserCancellation).toHaveBeenCalledOnce();
    expect(session.acceptTranscript).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it('converts replace-style batch cleanup to one transform before selection replacement', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'm',
        providerId: 'ollama',
        text: 'Clean replacement.',
      }),
    );
    const llmRouter = createFakeLlmRouter({ cleanup });
    const controller = createController({
      createSelectionRedictationSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessActivePresetRef: 'builtin:markdown-formatting',
          llmPostprocessMode: 'batch',
          llmPostprocessSkipMinWords: 0,
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter,
      sidecarConnection,
    });

    await controller.startSelectionRedictation(createSelectionSnapshot());
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw replacement'));

    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: '<utterance>\nraw replacement\n</utterance>',
        }),
      );
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true, text: 'Clean replacement.' }),
      );
    });
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });
    await vi.waitFor(() => {
      expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    });

    expect(cleanup).toHaveBeenCalledOnce();
    expect(llmRouter.selectProviderId).toHaveBeenCalledOnce();
    expect(sessions[0]?.readCurrentSessionText).not.toHaveBeenCalled();
    expect(sessions[0]?.replaceSessionRangeWithCleaned).not.toHaveBeenCalled();
    expect(sessions[0]?.insertAdjacentToSessionRange).not.toHaveBeenCalled();
  });

  it.each([
    'builtin:tldr',
    'builtin:action-items',
  ] as const)('disables additive preset %s for selection re-dictation', async (activePresetRef) => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'remote-model',
        providerId: 'openrouter',
        text: 'Adjacent content',
      }),
    );
    const llmRouter = createFakeLlmRouter({ cleanup, providerId: 'openrouter' });
    const controller = createController({
      createSelectionRedictationSession: (session) => {
        sessions.push(session);
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessActivePresetRef: activePresetRef,
          llmPostprocessMode: 'batch',
          llmRemoteFeaturesEnabled: true,
          llmRouting: 'remote',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter,
      sidecarConnection,
    });

    await controller.startSelectionRedictation(createSelectionSnapshot());
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw replacement'));
    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true, text: 'raw replacement' }),
      );
    });
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });
    await vi.waitFor(() => {
      expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    });

    expect(cleanup).not.toHaveBeenCalled();
    expect(llmRouter.selectProviderId).not.toHaveBeenCalled();
    expect(sessions[0]?.readCurrentSessionText).not.toHaveBeenCalled();
    expect(sessions[0]?.replaceSessionRangeWithCleaned).not.toHaveBeenCalled();
    expect(sessions[0]?.insertAdjacentToSessionRange).not.toHaveBeenCalled();
  });

  it('stops on an empty first final and ignores a later non-empty selection final', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      createSelectionRedictationSession: (session) => {
        sessions.push(session);
      },
      sidecarConnection,
    });

    await controller.startSelectionRedictation(createSelectionSnapshot());
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, ''));
    sidecarConnection.emit(transcriptReady(sessionId, 'late replacement', { revision: 1 }));

    await vi.waitFor(() => {
      expect(sidecarConnection.requestStopSession).toHaveBeenCalledWith(sessionId);
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true, text: '' }),
      );
    });
    expect(sessions[0]?.acceptedTexts).toEqual(['']);
  });

  it('passes smart paragraph thresholds to renderer options', async () => {
    let rendererOptions: TranscriptRenderOptions | null = null;
    const controller = createController({
      createSession: (_session, options) => {
        rendererOptions = options.rendererOptions;
      },
      getSettings: () =>
        createSettings({
          selectedModel: createExternalModelSelection(),
          smartParagraphLineBreakPauseMs: 1200,
          smartParagraphParagraphPauseMs: 4500,
          transcriptFormatting: 'smart',
        }),
    });

    await controller.startDictation();

    if (rendererOptions === null) {
      throw new Error('expected renderer options');
    }
    expect(rendererOptions).toMatchObject({
      smartParagraphPauses: { lineBreakPauseMs: 1200, paragraphPauseMs: 4500 },
      transcriptFormatting: 'smart',
    });
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
    const show = vi.fn();
    const controller = createController({ captureStream, feedback: { show } });

    await controller.startDictation();

    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'action-required',
        message: formatMicrophonePermissionDeniedMessage(),
      }),
    );
  });

  it('surfaces a descriptive no-microphone message when capture finds no input device', async () => {
    const captureStream = new FakeCaptureStream();
    captureStream.start.mockRejectedValueOnce(
      Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }),
    );
    const logger = new FakeLogger();
    const show = vi.fn();
    const controller = createController({ captureStream, feedback: { show }, logger });

    await controller.startDictation();

    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('No microphone detected') }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not start the sidecar session when device enumeration finds no microphone', async () => {
    const captureStream = new FakeCaptureStream();
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const show = vi.fn();
    const controller = createController({
      captureStream,
      countAudioInputDevices: async () => 0,
      logger,
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();

    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('No microphone detected') }),
    );
    expect(sidecarConnection.ensureStarted).not.toHaveBeenCalled();
    expect(sidecarConnection.startSession).not.toHaveBeenCalled();
    expect(captureStream.start).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('error');
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

  it('debug-logs hallucination filter counts without transcript text', async () => {
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const controller = createController({ logger, sidecarConnection });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const event = transcriptReady(sessionId, 'Let me join');
    if (event.type !== 'transcript_ready') {
      throw new Error('expected transcript_ready fixture');
    }
    const edit = {
      index: 0,
      originalText: 'Gorglosa: Let me join',
      strippedPrefix: 'Gorglosa:',
    };
    event.stageResults = [
      {
        durationMs: 0,
        isFinal: true,
        payload: { droppedSegments: [], editedSegments: [edit], version: 2 },
        revisionIn: 0,
        revisionOut: 0,
        stageId: 'hallucination_filter',
        status: { kind: 'ok' },
      },
    ];

    sidecarConnection.emit(event);

    await vi.waitFor(() => {
      expect(logger.debug).toHaveBeenCalledWith(
        'session',
        'hallucination filter adjusted segments',
        { dropped: 0, edited: 1 },
      );
    });
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('Gorglosa');
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('Let me join');
  });

  it('debug-logs final transcript summaries without logging partial revision summaries', async () => {
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      logger,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    logger.debug.mockClear();

    sidecarConnection.emit(transcriptReady(sessionId, 'partial', { isFinal: false, revision: 1 }));

    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: false, text: 'partial' }),
      );
    });
    expect(logger.debug).not.toHaveBeenCalledWith(
      'session',
      expect.stringContaining('transcript received'),
    );

    sidecarConnection.emit(transcriptReady(sessionId, 'final', { isFinal: true, revision: 2 }));
    sidecarConnection.emit(transcriptReady(sessionId, '', { isFinal: true, revision: 3 }));

    await vi.waitFor(() => {
      expect(
        logger.debug.mock.calls.filter(
          ([category, message]) =>
            category === 'session' && String(message).includes('final transcript received'),
        ),
      ).toEqual([['session', 'final transcript received (5 chars, 12ms processing)']]);
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true, revision: 3, text: '' }),
      );
    });
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

  it('does not run per-utterance cleanup for partial revisions and runs it on the final', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(async () => ({
      model: 'm',
      providerId: 'ollama' as const,
      text: 'Clean final.',
    }));
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
    const utteranceId = crypto.randomUUID();
    sidecarConnection.emit(
      transcriptReady(sessionId, 'live partial', {
        isFinal: false,
        revision: 0,
        utteranceId,
      }),
    );

    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: false, text: 'live partial' }),
      );
    });
    expect(cleanup).not.toHaveBeenCalled();

    sidecarConnection.emit(
      transcriptReady(sessionId, 'final words', {
        isFinal: true,
        revision: 1,
        utteranceId,
      }),
    );
    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true, text: 'Clean final.' }),
      );
    });
  });

  it('projects monotonic partials while an earlier final cleanup is pending', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    let resolveCleanup: ((value: LlmRouterCleanupResult) => void) | undefined;
    const cleanup = vi.fn(
      () =>
        new Promise<LlmRouterCleanupResult>((resolve) => {
          resolveCleanup = resolve;
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
    sidecarConnection.emit(
      transcriptReady(sessionId, 'utterance A final', {
        utteranceId: crypto.randomUUID(),
        utteranceIndex: 0,
      }),
    );
    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    const liveUtteranceId = crypto.randomUUID();
    sidecarConnection.emit(
      transcriptReady(sessionId, 'utterance B partial 0', {
        isFinal: false,
        revision: 0,
        utteranceId: liveUtteranceId,
        utteranceIndex: 1,
      }),
    );
    sidecarConnection.emit(
      transcriptReady(sessionId, 'utterance B partial 1', {
        isFinal: false,
        revision: 1,
        utteranceId: liveUtteranceId,
        utteranceIndex: 1,
      }),
    );

    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ isFinal: false, revision: 0, utteranceId: liveUtteranceId }),
      );
      expect(sessions[0]?.acceptTranscript).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ isFinal: false, revision: 1, utteranceId: liveUtteranceId }),
      );
    });

    resolveCleanup?.({ model: 'm', providerId: 'ollama', text: 'Clean A.' });
    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true, text: 'Clean A.' }),
      );
    });
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

  it('drops a queued raw final after an acknowledged cancellation while earlier cleanup ignores abort', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    let cleanupSignal: AbortSignal | undefined;
    let resolveCleanup: ((value: LlmRouterCleanupResult) => void) | undefined;
    const cleanup = vi.fn(
      ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise<LlmRouterCleanupResult>((resolve) => {
          cleanupSignal = abortSignal;
          resolveCleanup = resolve;
        }),
    );
    let onLockedNoteClosed: (() => void) | undefined;
    const controller = createController({
      createSession: (session, options) => {
        sessions.push(session);
        onLockedNoteClosed = options.callbacks.onLockedNoteClosed;
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'per_utterance',
          llmPostprocessSkipMinWords: 2,
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({ cleanup }),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';

    sidecarConnection.emit(transcriptReady(sessionId, 'cleanup blocks'));
    sidecarConnection.emit(transcriptReady(sessionId, 'raw'));
    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledOnce();
    });

    onLockedNoteClosed?.();
    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledWith(sessionId);
    });
    expect(cleanupSignal?.aborted).toBe(true);
    expect(sessions[0]?.acceptTranscript).not.toHaveBeenCalled();

    // This provider deliberately ignores abort. Its completion releases the
    // raw final queued behind it after session_stopped has already arrived.
    resolveCleanup?.({ model: 'm', providerId: 'ollama', text: 'ignored cleanup' });
    await vi.waitFor(() => {
      expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    });
    expect(sessions[0]?.acceptTranscript).not.toHaveBeenCalled();
  });

  it('does not accept queued utterances after cancellation, even when capture teardown rejects', async () => {
    const captureStream = new FakeCaptureStream();
    const logger = new FakeLogger();
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSession: (session) => {
        sessions.push(session);
      },
      feedback: { show },
      logger,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    session.acceptTranscript.mockImplementation((revision: TranscriptRevision) => {
      if (revision.text === 'first utterance') {
        return { kind: 'rejected' as const, reason: 'failed to insert transcript' };
      }
      return { kind: 'accepted' as const };
    });
    captureStream.stop.mockRejectedValueOnce(new Error('failed to stop capture'));
    // Hold the sidecar's cancel round trip open so the session stays in the
    // 'cancelling' phase (matching real network timing) while the second
    // queued utterance is resolved, instead of resolving synchronously.
    let resolveCancel: (() => void) | undefined;
    sidecarConnection.cancelSession.mockImplementationOnce(
      (cancelSessionId: string) =>
        new Promise((resolve) => {
          resolveCancel = () => {
            sidecarConnection.emit({
              reason: 'user_cancel',
              sessionId: cancelSessionId,
              type: 'session_stopped',
            });
            resolve({ reason: 'user_cancel', sessionId: cancelSessionId, type: 'session_stopped' });
          };
        }),
    );

    sidecarConnection.emit(transcriptReady(sessionId, 'first utterance'));
    sidecarConnection.emit(transcriptReady(sessionId, 'second utterance'));

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'error',
          key: 'transcript-record-failed',
          message: 'Could not record the transcript.',
        }),
      );
    });
    // The rejected capture teardown must not stop cancellation from completing:
    // the sidecar still gets the cancel command even though it hasn't resolved yet.
    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledWith(sessionId);
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'audio',
      'failed to stop audio capture cleanly during teardown',
      expect.any(Error),
    );
    await vi.waitFor(() => {
      expect(session.acceptTranscript).toHaveBeenCalledTimes(1);
    });
    expect(session.acceptTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'first utterance' }),
    );

    // Once the sidecar confirms cancellation, teardown still finishes cleanly.
    resolveCancel?.();
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalledTimes(1);
    });
  });

  it('contains a fatal note-surface desynchronization once and drops later transcripts', async () => {
    const captureStream = new FakeCaptureStream();
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'm',
        providerId: 'ollama',
        text: 'must not run',
      }),
    );
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    const controller = createController({
      captureStream,
      createSession: (session, options) => {
        sessions.push(session);
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'per_utterance',
          llmPostprocessSkipMinWords: 0,
          selectedModel: createExternalModelSelection(),
        }),
      feedback: { show },
      llmRouter: createFakeLlmRouter({ cleanup }),
      sidecarConnection,
    });
    const failure: SurfaceDesynchronization = {
      documentLength: 4280,
      kind: 'surface_desynchronized',
      trackedPosition: 4314,
    };

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';

    onSurfaceDesynchronized?.(failure);
    onSurfaceDesynchronized?.(failure);
    sidecarConnection.emit(transcriptReady(sessionId, 'must be dropped'));

    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledOnce();
    });
    expect(sidecarConnection.cancelSession).toHaveBeenCalledWith(sessionId);
    expect(captureStream.stop).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith({
      cause: failure,
      intent: 'error',
      key: 'dictation-surface-desynchronized',
      message:
        'Dictation stopped because the note changed in a way Local Dictation could not safely track. Start dictation again to continue.',
    });
    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).not.toHaveBeenCalled();
    });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('reports and cancels once when fatal containment races target loss', async () => {
    const captureStream = new FakeCaptureStream();
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    let onLockedNoteClosed: (() => void) | undefined;
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    let resolveCaptureStop: (() => void) | undefined;
    captureStream.stop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCaptureStop = resolve;
        }),
    );
    const controller = createController({
      captureStream,
      createSession: (_session, options) => {
        onLockedNoteClosed = options.callbacks.onLockedNoteClosed;
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
      },
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();

    onSurfaceDesynchronized?.({
      documentLength: 4280,
      kind: 'surface_desynchronized',
      trackedPosition: 4314,
    });
    onLockedNoteClosed?.();

    await vi.waitFor(() => {
      expect(captureStream.stop).toHaveBeenCalledOnce();
    });
    expect(sidecarConnection.cancelSession).not.toHaveBeenCalled();

    resolveCaptureStop?.();
    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledOnce();
    });
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'dictation-surface-desynchronized' }),
    );
  });

  it('keeps target-loss feedback as the first cause when desynchronization follows', async () => {
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    let onLockedNoteClosed: (() => void) | undefined;
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    const controller = createController({
      createSession: (_session, options) => {
        onLockedNoteClosed = options.callbacks.onLockedNoteClosed;
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
      },
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();

    onLockedNoteClosed?.();
    onSurfaceDesynchronized?.({
      documentLength: 4280,
      kind: 'surface_desynchronized',
      trackedPosition: 4314,
    });

    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledOnce();
    });
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ key: 'dictation-target-closed' }));
  });

  it('keeps the controller idle when target loss wins a pending-start failure race', async () => {
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    let onLockedNoteClosed: (() => void) | undefined;
    let rejectStart: ((error: Error) => void) | undefined;
    sidecarConnection.startSession.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    sidecarConnection.cancelSession.mockImplementationOnce(async (sessionId) => ({
      reason: 'user_cancel',
      sessionId,
      type: 'session_stopped',
    }));
    const controller = createController({
      createSession: (_session, options) => {
        onLockedNoteClosed = options.callbacks.onLockedNoteClosed;
      },
      feedback: { show },
      sidecarConnection,
    });

    const start = controller.startDictation();
    await vi.waitFor(() => {
      expect(sidecarConnection.startSession).toHaveBeenCalledOnce();
    });

    onLockedNoteClosed?.();
    await vi.waitFor(() => {
      expect(controller.getState()).toBe('idle');
      expect(sidecarConnection.cancelSession).toHaveBeenCalledOnce();
    });

    rejectStart?.(new Error('sidecar start failed after cancellation'));
    await start;

    expect(controller.getState()).toBe('idle');
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ key: 'dictation-target-closed' }));
  });

  it.each([
    {
      error: (sessionId: string): SidecarEvent => ({
        code: 'inference_failed',
        message: 'The speech engine failed.',
        sessionId,
        type: 'error',
      }),
      source: 'sidecar error',
    },
    {
      error: (sessionId: string): SidecarEvent => ({
        code: 'utterance_queue_overload',
        message: 'The transcription backlog reached capacity.',
        sessionId,
        type: 'error',
      }),
      source: 'queue overload',
    },
  ])('keeps target-loss feedback when it races a $source', async ({ error, source: _source }) => {
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    let onLockedNoteClosed: (() => void) | undefined;
    const controller = createController({
      createSession: (_session, options) => {
        onLockedNoteClosed = options.callbacks.onLockedNoteClosed;
      },
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';

    onLockedNoteClosed?.();
    sidecarConnection.emit(error(sessionId));

    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledOnce();
    });
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ key: 'dictation-target-closed' }));
  });

  it('reports target loss after a prior queue-overload warning cancels the drain', async () => {
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    let onLockedNoteClosed: (() => void) | undefined;
    const controller = createController({
      createSession: (_session, options) => {
        onLockedNoteClosed = options.callbacks.onLockedNoteClosed;
      },
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit({
      code: 'utterance_queue_overload',
      message: 'The transcription backlog reached capacity.',
      sessionId,
      type: 'error',
    });
    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'utterance-queue-overload' }),
      );
    });

    onLockedNoteClosed?.();

    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledWith(sessionId);
    });
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: 'dictation-target-closed' }),
    );
  });

  it.each([
    {
      callback: 'onLockedNoteClosed' as const,
      expectedKey: 'dictation-target-closed',
      expectedMessage:
        'Dictation stopped because its target note was closed or replaced. Start dictation again to continue.',
      reason: 'closed',
    },
    {
      callback: 'onLockedNoteDeleted' as const,
      expectedKey: 'dictation-target-deleted',
      expectedMessage:
        'Dictation stopped because its target note was deleted. Restore or recreate the note, then start dictation again.',
      reason: 'deleted',
    },
  ])('reports one actionable explanation when the target is $reason', async (scenario) => {
    const captureStream = new FakeCaptureStream();
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    let callbacks: CreateSessionOptions['callbacks'] | undefined;
    const controller = createController({
      captureStream,
      createSession: (_session, options) => {
        callbacks = options.callbacks;
      },
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const targetLossCallback = callbacks?.[scenario.callback];

    targetLossCallback?.();
    targetLossCallback?.();

    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledOnce();
    });
    expect(captureStream.stop).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith({
      cause: { reason: scenario.reason, sessionId },
      intent: 'warning',
      key: scenario.expectedKey,
      message: scenario.expectedMessage,
    });
  });

  it('reports a pending fatal desynchronization after the sidecar has already stopped', async () => {
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    const failure: SurfaceDesynchronization = {
      documentLength: 4280,
      kind: 'surface_desynchronized',
      trackedPosition: 4314,
    };
    const controller = createController({
      createSession: (session, options) => {
        sessions.push(session);
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
        session.acceptTranscript.mockImplementation(() => {
          onSurfaceDesynchronized?.(failure);
          return { kind: 'accepted' };
        });
      },
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'final utterance'));
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    });
    expect(sidecarConnection.cancelSession).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ cause: failure }));
  });

  it('aborts pending provider work when a fatal surface failure arrives after stop', async () => {
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    let cleanupSignal: AbortSignal | undefined;
    let resolveCleanup: ((result: LlmRouterCleanupResult) => void) | undefined;
    const cleanup = vi.fn(
      ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise<LlmRouterCleanupResult>((resolve) => {
          cleanupSignal = abortSignal;
          resolveCleanup = resolve;
        }),
    );
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    const sessions: FakeSession[] = [];
    const controller = createController({
      createSession: (session, options) => {
        sessions.push(session);
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'per_utterance',
          llmPostprocessSkipMinWords: 0,
          selectedModel: createExternalModelSelection(),
        }),
      feedback: { show },
      llmRouter: createFakeLlmRouter({ cleanup }),
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'pending cleanup'));
    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledOnce();
    });
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });
    onSurfaceDesynchronized?.({
      documentLength: 4280,
      kind: 'surface_desynchronized',
      trackedPosition: 4314,
    });

    expect(cleanupSignal?.aborted).toBe(true);
    expect(sidecarConnection.cancelSession).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledOnce();

    resolveCleanup?.({ model: 'm', providerId: 'ollama', text: 'ignored' });
    await vi.waitFor(() => {
      expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    });
    expect(sessions[0]?.acceptTranscript).not.toHaveBeenCalled();
  });

  it('contains an unexpected projection exception with accurate single-shot notice copy', async () => {
    const captureStream = new FakeCaptureStream();
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSession: (session) => {
        sessions.push(session);
        session.acceptTranscript.mockImplementation(() => {
          throw new RangeError('Invalid change range 4314 to 4314 (in doc of length 4280)');
        });
      },
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(
      transcriptReady(sessionId, 'first', {
        isFinal: false,
        utteranceId: 'partial-1',
        utteranceIndex: 0,
      }),
    );
    sidecarConnection.emit(
      transcriptReady(sessionId, 'second', {
        isFinal: false,
        utteranceId: 'partial-2',
        utteranceIndex: 1,
      }),
    );

    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledOnce();
    });
    expect(captureStream.stop).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith({
      cause: expect.any(RangeError),
      intent: 'error',
      key: 'transcript-write-failed',
      message:
        'Dictation stopped because Local Dictation could not safely write to the note. Start dictation again to continue.',
    });
    expect(sessions[0]?.acceptTranscript).toHaveBeenCalledOnce();
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
    const show = vi.fn();
    const onLlmCleanupFailure = vi.fn();
    const controller = createController({
      createSession: (session) => {
        sessions.push(session);
      },
      feedback: { show },
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
    expect(show).toHaveBeenCalledWith({
      intent: 'information',
      message: 'LLM transform returned nothing to add.',
    });
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

  it('drains utterances accepted while stopping before the batch read', async () => {
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

    await controller.stopDictation();
    sidecarConnection.emit(transcriptReady(sessionId, 'final utterance'));
    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'final utterance' }),
      );
    });
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: '<session_transcript>\nfinal utterance\n</session_transcript>',
        }),
      );
    });
  });

  it('does not start batch provider work after a pending accept reports a fatal surface failure', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'm',
        providerId: 'ollama',
        text: 'must not run',
      }),
    );
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    const controller = createController({
      createSession: (session, options) => {
        sessions.push(session);
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
        session.acceptTranscript.mockImplementation((revision: TranscriptRevision) => {
          session.currentSessionText = revision.text;
          onSurfaceDesynchronized?.({
            documentLength: 4280,
            kind: 'surface_desynchronized',
            trackedPosition: 4314,
          });
          return { kind: 'accepted' };
        });
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

    sidecarConnection.emit(transcriptReady(sessionId, 'final utterance'));
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it.each([
    ['hiding the anchor', 'anchor'],
    ['marking the range', 'processing'],
  ] as const)('does not start batch provider work after a fatal failure while %s', async (_description, mutation) => {
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const cleanup = vi.fn(
      async (): Promise<LlmRouterCleanupResult> => ({
        model: 'm',
        providerId: 'ollama',
        text: 'must not run',
      }),
    );
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    const controller = createController({
      createSession: (session, options) => {
        sessions.push(session);
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
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
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledOnce();
    });
    await controller.stopDictation();

    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    const reportFatalFailure = () => {
      onSurfaceDesynchronized?.({
        documentLength: 4280,
        kind: 'surface_desynchronized',
        trackedPosition: 4314,
      });
    };
    if (mutation === 'anchor') {
      session.setAnchorMode.mockImplementationOnce(reportFatalFailure);
    } else {
      session.markSessionRangeAsProcessing.mockImplementationOnce(() => {
        reportFatalFailure();
        return false;
      });
    }

    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalledOnce();
    });
    expect(cleanup).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalledWith(
      'llm',
      expect.stringContaining('session range no longer available'),
    );
  });

  it('does not apply a batch result after clearing its processing mark reports a fatal failure', async () => {
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const onLlmCleanupSuccess = vi.fn();
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    const controller = createController({
      createSession: (session, options) => {
        sessions.push(session);
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          llmPostprocessMode: 'batch',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({
        cleanup: vi.fn(
          async (): Promise<LlmRouterCleanupResult> => ({
            model: 'm',
            providerId: 'ollama',
            text: 'Clean batch.',
          }),
        ),
      }),
      onLlmCleanupSuccess,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledOnce();
    });
    await controller.stopDictation();

    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    session.clearSessionProcessingMark.mockImplementationOnce(() => {
      onSurfaceDesynchronized?.({
        documentLength: 4280,
        kind: 'surface_desynchronized',
        trackedPosition: 4314,
      });
    });
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalledOnce();
    });
    expect(session.replaceSessionRangeWithCleaned).not.toHaveBeenCalled();
    expect(onLlmCleanupSuccess).not.toHaveBeenCalled();
  });

  it.each([
    [
      'replacement',
      undefined,
      'batch cleanup replacement skipped; session range no longer available',
    ],
    [
      'additive',
      'builtin:tldr',
      'additive batch insert skipped; session range no longer available',
    ],
  ] as const)('suppresses misleading %s batch logs and success after result application reports fatal', async (_description, activePresetRef, misleadingWarning) => {
    const logger = new FakeLogger();
    const show = vi.fn();
    const onLlmCleanupSuccess = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    let onSurfaceDesynchronized: ((failure: SurfaceDesynchronization) => void) | undefined;
    const controller = createController({
      createSession: (session, options) => {
        sessions.push(session);
        onSurfaceDesynchronized = options.callbacks.onSurfaceDesynchronized;
      },
      getSettings: () =>
        createSettings({
          llmFeaturesEnabled: true,
          ...(activePresetRef === undefined
            ? {}
            : { llmPostprocessActivePresetRef: activePresetRef }),
          llmPostprocessMode: 'batch',
          selectedModel: createExternalModelSelection(),
        }),
      llmRouter: createFakeLlmRouter({
        cleanup: vi.fn(
          async (): Promise<LlmRouterCleanupResult> => ({
            model: 'm',
            providerId: 'ollama',
            text: 'Clean batch.',
          }),
        ),
      }),
      feedback: { show },
      logger,
      onLlmCleanupSuccess,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    sidecarConnection.emit(transcriptReady(sessionId, 'raw transcript'));
    await vi.waitFor(() => {
      expect(sessions[0]?.acceptTranscript).toHaveBeenCalledOnce();
    });
    await controller.stopDictation();

    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    const reportFatalFailure = () => {
      onSurfaceDesynchronized?.({
        documentLength: 4280,
        kind: 'surface_desynchronized',
        trackedPosition: 4314,
      });
      return false;
    };
    if (activePresetRef === undefined) {
      session.replaceSessionRangeWithCleaned.mockImplementationOnce(reportFatalFailure);
    } else {
      session.insertAdjacentToSessionRange.mockImplementationOnce(reportFatalFailure);
    }
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });

    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalledOnce();
    });
    expect(logger.warn).not.toHaveBeenCalledWith('llm', misleadingWarning);
    expect(onLlmCleanupSuccess).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledOnce();
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
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSession: (session) => {
        sessions.push(session);
      },
      logger,
      feedback: { show },
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

    expect(show).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(captureStream.stop).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    });
    expect(controller.getState()).toBe('idle');
  });

  it('drains queued work on queue overload instead of cancelling the session', async () => {
    const captureStream = new FakeCaptureStream();
    const show = vi.fn();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSession: (session) => {
        sessions.push(session);
      },
      feedback: { show },
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }

    sidecarConnection.emit({
      code: 'utterance_queue_overload',
      details: 'queue depth reached saturation at 32',
      message:
        'Local Dictation stopped because the transcription backlog reached capacity. Already accepted utterances will finish processing.',
      sessionId,
      type: 'error',
    });
    // Drain the async error handler fully. Cancelling (the buggy path) would run
    // to completion here and dispose the session, so anything checked after this
    // flush reliably distinguishes drain from cancel.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Overload must not cancel — that would tear the worker down and drop the
    // queue the sidecar is still draining.
    expect(sidecarConnection.cancelSession).not.toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('backlog reached capacity') }),
    );
    expect(controller.getState()).toBe('idle');

    // Already-accepted utterances still land while the queue drains. On the
    // cancel path the session would already be gone, so this never records.
    sidecarConnection.emit(transcriptReady(sessionId, 'queued utterance'));
    await vi.waitFor(() => {
      expect(session.acceptTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'queued utterance' }),
      );
    });

    // The sidecar completes the drain; only then is the session disposed.
    sidecarConnection.emit({ reason: 'queue_overload', sessionId, type: 'session_stopped' });
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalledTimes(1);
    });
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

  it('still stops the sidecar session and returns to idle when capture teardown rejects on stop', async () => {
    const captureStream = new FakeCaptureStream();
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSession: (session) => {
        sessions.push(session);
      },
      logger,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    captureStream.stop.mockRejectedValueOnce(new Error('audio context close failed'));

    await controller.stopDictation();

    expect(sidecarConnection.requestStopSession).toHaveBeenCalledWith(sessionId);
    expect(logger.warn).toHaveBeenCalledWith(
      'audio',
      'failed to stop audio capture cleanly during teardown',
      expect.any(Error),
    );
    expect(controller.getState()).toBe('idle');

    // The rest of stop's teardown still ran: the drain completes and disposes as usual.
    sidecarConnection.emit({ reason: 'user_stop', sessionId, type: 'session_stopped' });
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('still cancels the sidecar session and disposes locally when capture teardown rejects on cancel', async () => {
    const captureStream = new FakeCaptureStream();
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSession: (session) => {
        sessions.push(session);
      },
      logger,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    const session = sessions[0];
    if (session === undefined) {
      throw new Error('expected session fixture');
    }
    captureStream.stop.mockRejectedValueOnce(new Error('audio context close failed'));

    sidecarConnection.emit({
      code: 'transcription_failed',
      message: 'the sidecar hit an unrecoverable error',
      sessionId,
      type: 'error',
    });

    await vi.waitFor(() => {
      expect(sidecarConnection.cancelSession).toHaveBeenCalledWith(sessionId);
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'audio',
      'failed to stop audio capture cleanly during teardown',
      expect.any(Error),
    );
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalledTimes(1);
    });
    expect(controller.getState()).toBe('idle');
  });

  it('still cancels sessions during dispose when capture teardown rejects', async () => {
    const captureStream = new FakeCaptureStream();
    const logger = new FakeLogger();
    const sidecarConnection = new FakeSidecarConnection();
    const sessions: FakeSession[] = [];
    const controller = createController({
      captureStream,
      createSession: (session) => {
        sessions.push(session);
      },
      logger,
      sidecarConnection,
    });

    await controller.startDictation();
    const sessionId = sidecarConnection.startSession.mock.calls[0]?.[0].sessionId ?? '';
    captureStream.stop.mockRejectedValueOnce(new Error('audio context close failed'));

    await controller.dispose();

    expect(sidecarConnection.cancelSession).toHaveBeenCalledWith(sessionId);
    expect(logger.warn).toHaveBeenCalledWith(
      'audio',
      'failed to stop audio capture cleanly during teardown',
      expect.any(Error),
    );
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
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
  createMarkdownCommandSession,
  createSession,
  createSelectionRedictationSession,
  llmRouter = createFakeLlmRouter(),
  getSettings = () => createSettings({ selectedModel: createExternalModelSelection() }),
  isMarkdownCommandSnapshotCurrent = () => true,
  isSelectionRedictationSnapshotCurrent = () => true,
  logger = new FakeLogger(),
  feedback = { show: vi.fn() },
  sidecarConnection = new FakeSidecarConnection(),
  onLlmCleanupFailure,
  onLlmCleanupSuccess,
}: {
  audioLevelMeter?: FakeAudioLevelMeter;
  captureStream?: FakeCaptureStream;
  countAudioInputDevices?: () => Promise<number | null>;
  createMarkdownCommandSession?: (
    session: FakeSession,
    options: CreateMarkdownCommandSessionOptions,
  ) => void;
  createSession?: (session: FakeSession, options: CreateSessionOptions) => void;
  createSelectionRedictationSession?: (
    session: FakeSession,
    options: CreateSelectionRedictationSessionOptions,
  ) => void;
  getSettings?: () => PluginSettings;
  isMarkdownCommandSnapshotCurrent?: (command: MarkdownCommandSnapshot) => boolean;
  isSelectionRedictationSnapshotCurrent?: (selection: SelectionRedictationSnapshot) => boolean;
  llmRouter?: LlmRouter;
  logger?: FakeLogger;
  feedback?: Pick<UserFeedback, 'show'>;
  onLlmCleanupFailure?: (failure: LlmCleanupFailure) => void;
  onLlmCleanupSuccess?: () => void;
  sidecarConnection?: FakeSidecarConnection;
} = {}): DictationSessionController {
  return new DictationSessionController({
    captureStream,
    audioLevelMeter,
    ...(countAudioInputDevices !== undefined ? { countAudioInputDevices } : {}),
    createMarkdownCommandSession: (_options: CreateMarkdownCommandSessionOptions) => {
      const session = new FakeSession();
      createMarkdownCommandSession?.(session, _options);
      return session;
    },
    createSession: (_options: CreateSessionOptions) => {
      const session = new FakeSession();
      createSession?.(session, _options);
      return session;
    },
    createSelectionRedictationSession: (_options: CreateSelectionRedictationSessionOptions) => {
      const session = new FakeSession();
      createSelectionRedictationSession?.(session, _options);
      return session;
    },
    createLlmRouter: () => llmRouter,
    feedback,
    getSettings,
    isMarkdownCommandSnapshotCurrent,
    isSelectionRedictationSnapshotCurrent,
    logger,
    ...(onLlmCleanupFailure !== undefined ? { onLlmCleanupFailure } : {}),
    ...(onLlmCleanupSuccess !== undefined ? { onLlmCleanupSuccess } : {}),
    onModelMissing: vi.fn(),
    onSidecarMissing: vi.fn(),
    setRibbonQueueTier: vi.fn((_tier: QueueBackpressureTier) => {}),
    setRibbonState: vi.fn((_state: DictationControllerState) => {}),
    sidecarConnection,
  });
}

interface CreateSessionOptions {
  callbacks: {
    onLockedNoteClosed: () => void;
    onLockedNoteDeleted: () => void;
    onSurfaceDesynchronized: (failure: SurfaceDesynchronization) => void;
  };
  placement: NotePlacementOptions;
  rendererOptions: TranscriptRenderOptions;
  sessionId: string;
}

interface CreateMarkdownCommandSessionOptions {
  callbacks: CreateSessionOptions['callbacks'];
  command: MarkdownCommandSnapshot;
  sessionId: string;
}

interface CreateSelectionRedictationSessionOptions {
  callbacks: CreateSessionOptions['callbacks'];
  selection: SelectionRedictationSnapshot;
  sessionId: string;
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

function createSelectionSnapshot(): SelectionRedictationSnapshot {
  return {
    documentText: 'original',
    editor: {},
    file: { path: 'note.md' },
    filePath: 'note.md',
    from: { ch: 0, line: 0 },
    to: { ch: 8, line: 0 },
  } as unknown as SelectionRedictationSnapshot;
}

function createMarkdownCommandSnapshot(): MarkdownCommandSnapshot {
  return {
    cursor: { ch: 0, line: 0 },
    documentText: '',
    editor: {},
    file: { path: 'note.md' },
    filePath: 'note.md',
  } as unknown as MarkdownCommandSnapshot;
}

function transcriptReady(
  sessionId: string,
  text: string,
  overrides: Partial<Extract<SidecarEvent, { type: 'transcript_ready' }>> = {},
): SidecarEvent {
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
    ...overrides,
  };
}
