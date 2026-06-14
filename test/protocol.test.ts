import { describe, expect, it } from 'vitest';

import { PCM_BYTES_PER_FRAME } from '../src/shared/pcm-format';
import {
  AUDIO_FRAME_KIND,
  bytesToSessionId,
  type ContextWindow,
  createCancelSessionCommand,
  createContextResponseCommand,
  createHealthCommand,
  createStartSessionCommand,
  createStopSessionCommand,
  decodeAudioFrameEnvelope,
  encodeAudioFrame,
  encodeJsonFrame,
  FRAME_HEADER_LENGTH,
  FramedMessageParser,
  JSON_FRAME_KIND,
  MAX_FRAME_PAYLOAD_BYTES,
  parseEventFrame,
  SESSION_ID_BYTES,
  sessionIdToBytes,
  type TranscriptReadyEvent,
} from '../src/sidecar/protocol';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';

// Fixture builders -----------------------------------------------------------
//
// The wire protocol has a small number of large payload shapes that repeat
// across tests. These builders return realistic defaults so each test can
// focus on the field under examination instead of redeclaring 15 unrelated
// fields. Inline shapes are preserved where the test's purpose is to pin the
// exact byte/JSON layout (e.g. small command frames).

function transcriptReadyPayload(
  overrides: Partial<TranscriptReadyEvent> = {},
): TranscriptReadyEvent {
  return {
    isFinal: true,
    pauseMsBeforeUtterance: null,
    processingDurationMs: 125,
    revision: 0,
    segments: [],
    sessionId: 'session-1',
    stageResults: [],
    text: 'hello world',
    type: 'transcript_ready',
    utteranceDurationMs: 900,
    utteranceEndMsInSession: 900,
    utteranceId: 'utt-1',
    utteranceIndex: 0,
    utteranceStartMsInSession: 0,
    warnings: [],
    ...overrides,
  };
}

function externalModelSelection() {
  return {
    familyId: 'whisper',
    filePath: '/tmp/m.bin',
    kind: 'external_file',
    runtimeId: 'whisper_cpp',
  } as const;
}

// Framing --------------------------------------------------------------------

describe('framing', () => {
  it('encodes JSON commands behind the JSON frame kind byte', () => {
    const frame = encodeJsonFrame(createHealthCommand());

    expect(frame[0]).toBe(JSON_FRAME_KIND);
    expect(readPayload(frame)).toEqual({ type: 'health' });
  });

  it('encodes audio frames at the expected wire length and decodes the envelope', () => {
    const payload = new Uint8Array(PCM_BYTES_PER_FRAME).fill(7);
    const frame = encodeAudioFrame(SESSION_ID, payload);

    expect(frame[0]).toBe(AUDIO_FRAME_KIND);
    expect(frame.byteLength).toBe(5 + SESSION_ID_BYTES + PCM_BYTES_PER_FRAME);
    expect(decodeAudioFrameEnvelope(frame.slice(FRAME_HEADER_LENGTH))).toEqual({
      frameBytes: payload,
      sessionId: SESSION_ID,
    });
  });

  it('round-trips UUID session ids and rejects non-UUID strings', () => {
    expect(bytesToSessionId(sessionIdToBytes(SESSION_ID))).toBe(SESSION_ID);
    expect(() => sessionIdToBytes('session-not-a-uuid')).toThrow(
      'Session id must be a UUID v4 string',
    );
  });

  it('rejects wrong-size payloads in encodeAudioFrame', () => {
    expect(() => encodeAudioFrame(SESSION_ID, new Uint8Array(1))).toThrow(
      `Audio frames must be ${PCM_BYTES_PER_FRAME} bytes, received 1.`,
    );
  });

  it('parses interleaved JSON and binary frames across chunk boundaries', () => {
    const parser = new FramedMessageParser(parseEventFrame);
    const jsonFrame = encodeJsonFrame(transcriptReadyPayload());
    const audioFrame = encodeAudioFrame(SESSION_ID, new Uint8Array(PCM_BYTES_PER_FRAME).fill(3));
    const combined = new Uint8Array(jsonFrame.byteLength + audioFrame.byteLength);

    combined.set(jsonFrame, 0);
    combined.set(audioFrame, jsonFrame.byteLength);

    // Split mid-frame to confirm the parser buffers across chunks.
    const first = parser.pushChunk(combined.slice(0, 17));
    const second = parser.pushChunk(combined.slice(17));
    const frames = [...first.frames, ...second.frames];

    expect(first.fatal).toBeUndefined();
    expect(second.fatal).toBeUndefined();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      envelope: { type: 'transcript_ready' },
      kind: JSON_FRAME_KIND,
    });
    expect(frames[1]).toEqual({
      frameBytes: new Uint8Array(PCM_BYTES_PER_FRAME).fill(3),
      kind: AUDIO_FRAME_KIND,
      sessionId: SESSION_ID,
    });
  });
});

// Fatal stream handling ------------------------------------------------------

describe('FramedMessageParser fatal stream handling', () => {
  function encodeFatalHeader(kind: number, declaredPayloadLength: number): Uint8Array {
    const header = new Uint8Array(FRAME_HEADER_LENGTH);
    header[0] = kind;
    new DataView(header.buffer).setUint32(1, declaredPayloadLength, true);
    return header;
  }

  it('flags a fatal result when payload length exceeds the cap', () => {
    const parser = new FramedMessageParser(parseEventFrame);
    const header = encodeFatalHeader(JSON_FRAME_KIND, 0xffffffff);

    const { fatal, frames } = parser.pushChunk(header);

    expect(frames).toEqual([]);
    expect(fatal?.message).toContain(`max ${MAX_FRAME_PAYLOAD_BYTES}`);
    expect(fatal?.message).toContain('4294967295');
  });

  it('accepts a payload length of exactly MAX_FRAME_PAYLOAD_BYTES', () => {
    // Boundary spec: <= MAX_FRAME_PAYLOAD_BYTES is accepted, matching Rust's
    // ensure!(payload_length <= MAX_FRAME_PAYLOAD) in native/src/protocol.rs.
    const parser = new FramedMessageParser(parseEventFrame);
    const header = encodeFatalHeader(JSON_FRAME_KIND, MAX_FRAME_PAYLOAD_BYTES);

    const { fatal, frames } = parser.pushChunk(header);

    // The parser buffers waiting for the (huge) body and does not flag fatal.
    expect(frames).toEqual([]);
    expect(fatal).toBeUndefined();
  });

  it('delivers every valid frame that precedes a fatal frame in the same chunk', () => {
    const parser = new FramedMessageParser(parseEventFrame);
    const first = encodeJsonFrame(transcriptReadyPayload({ text: 'first' }));
    const second = encodeJsonFrame(transcriptReadyPayload({ text: 'second' }));
    const fatalFrame = encodeFatalHeader(0xff, 0);

    const combined = new Uint8Array(first.byteLength + second.byteLength + fatalFrame.byteLength);
    combined.set(first, 0);
    combined.set(second, first.byteLength);
    combined.set(fatalFrame, first.byteLength + second.byteLength);

    const { fatal, frames } = parser.pushChunk(combined);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ envelope: { text: 'first', type: 'transcript_ready' } });
    expect(frames[1]).toMatchObject({ envelope: { text: 'second', type: 'transcript_ready' } });
    expect(fatal?.message).toBe('Unsupported sidecar frame kind: 255');
  });

  it('discards the buffered backlog after a fatal so subsequent chunks resync', () => {
    const parser = new FramedMessageParser(parseEventFrame);

    const fatalFrame = encodeFatalHeader(0xff, 0);
    const fatalResult = parser.pushChunk(fatalFrame);
    expect(fatalResult.fatal).toBeDefined();

    // A clean frame pushed after the fatal must parse as if the buffer were empty.
    const cleanFrame = encodeJsonFrame(transcriptReadyPayload({ text: 'after-recovery' }));
    const next = parser.pushChunk(cleanFrame);

    expect(next.fatal).toBeUndefined();
    expect(next.frames).toHaveLength(1);
    expect(next.frames[0]).toMatchObject({
      envelope: { text: 'after-recovery', type: 'transcript_ready' },
    });
  });

  it('reports JSON envelope parse errors as fatal without losing earlier frames', () => {
    const parser = new FramedMessageParser(parseEventFrame);
    const good = encodeJsonFrame(transcriptReadyPayload({ text: 'pre-bad-json' }));
    const badJsonBody = new TextEncoder().encode(JSON.stringify({ type: 'not_a_known_event' }));
    const badJsonFrame = new Uint8Array(FRAME_HEADER_LENGTH + badJsonBody.byteLength);
    badJsonFrame[0] = JSON_FRAME_KIND;
    new DataView(badJsonFrame.buffer).setUint32(1, badJsonBody.byteLength, true);
    badJsonFrame.set(badJsonBody, FRAME_HEADER_LENGTH);

    const combined = new Uint8Array(good.byteLength + badJsonFrame.byteLength);
    combined.set(good, 0);
    combined.set(badJsonFrame, good.byteLength);

    const { fatal, frames } = parser.pushChunk(combined);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ envelope: { text: 'pre-bad-json' } });
    expect(fatal?.message).toContain('Unsupported sidecar event type');
  });
});

// Commands -------------------------------------------------------------------

describe('command serialization', () => {
  it('serializes start_session with accelerationPreference, audioSource, and sessionId', () => {
    const frame = encodeJsonFrame(
      createStartSessionCommand({
        accelerationPreference: 'auto',
        audioSource: 'system',
        language: 'en',
        mode: 'always_on',
        modelSelection: externalModelSelection(),
        sessionStartUnixMs: 1_700_000_000_000,
        sessionId: 'session-gpu',
        speakingStyle: 'balanced',
      }),
    );
    const payload = readPayload(frame) as Record<string, unknown>;

    expect(payload.accelerationPreference).toBe('auto');
    expect(payload.audioSource).toBe('system');
    expect(payload.sessionId).toBe('session-gpu');
  });

  it('encodes session-addressed lifecycle commands with sessionId echoed in the payload', () => {
    expect(readPayload(encodeJsonFrame(createStopSessionCommand(SESSION_ID)))).toEqual({
      sessionId: SESSION_ID,
      type: 'stop_session',
    });
    expect(readPayload(encodeJsonFrame(createCancelSessionCommand(SESSION_ID)))).toEqual({
      sessionId: SESSION_ID,
      type: 'cancel_session',
    });
  });

  it('serializes context_response carrying a context window or explicit null', () => {
    const window: ContextWindow = {
      budgetChars: 512,
      sources: [{ kind: 'note_glossary', text: 'hello', truncated: false }],
      text: 'hello',
      truncated: false,
    };

    expect(readPayload(encodeJsonFrame(createContextResponseCommand('corr-1', window)))).toEqual({
      context: window,
      correlationId: 'corr-1',
      type: 'context_response',
    });
    expect(readPayload(encodeJsonFrame(createContextResponseCommand('corr-1', null)))).toEqual({
      context: null,
      correlationId: 'corr-1',
      type: 'context_response',
    });
  });
});

// Event parsing --------------------------------------------------------------

describe('event parsing', () => {
  it('parses system_info preserving compiled runtime and adapter shapes', () => {
    const runtimeCapabilities = {
      acceleratorDetails: {
        cpu: { available: true, unavailableReason: null },
        cuda: { available: true, unavailableReason: null },
      },
      availableAccelerators: ['cpu' as const, 'cuda' as const],
      supportedModelFormats: ['ggml' as const],
    };
    const familyCapabilities = {
      maxAudioDurationSecs: null,
      producesPunctuation: true,
      supportedLanguages: { kind: 'all' as const },
      supportsInitialPrompt: true,
      supportsLanguageSelection: true,
      supportsSegmentTimestamps: true,
      supportsWordTimestamps: false,
    };
    const compiledRuntime = {
      displayName: 'whisper.cpp',
      runtimeCapabilities,
      runtimeId: 'whisper_cpp' as const,
    };
    const compiledAdapter = {
      displayName: 'Whisper',
      familyCapabilities,
      familyId: 'whisper' as const,
      runtimeId: 'whisper_cpp' as const,
    };
    const event = parseEventFrame(
      JSON.stringify({
        compiledAdapters: [compiledAdapter],
        compiledRuntimes: [compiledRuntime],
        sidecarVersion: '0.0.0-test',
        systemInfo: 'AVX = 1 | CUDA = 1',
        type: 'system_info',
      }),
    );

    expect(event).toEqual({
      compiledAdapters: [compiledAdapter],
      compiledRuntimes: [compiledRuntime],
      sidecarVersion: '0.0.0-test',
      systemInfo: 'AVX = 1 | CUDA = 1',
      type: 'system_info',
    });
  });

  it('parses model_probe_result with merged capabilities and with explicit null', () => {
    const baseSelection = {
      familyId: 'whisper' as const,
      kind: 'catalog_model' as const,
      modelId: 'small',
      runtimeId: 'whisper_cpp' as const,
    };

    const ready = parseEventFrame(
      JSON.stringify({
        available: true,
        details: null,
        displayName: 'Whisper Small',
        familyId: 'whisper',
        installed: true,
        mergedCapabilities: {
          family: {
            maxAudioDurationSecs: null,
            producesPunctuation: true,
            supportedLanguages: { kind: 'english_only' },
            supportsInitialPrompt: true,
            supportsLanguageSelection: false,
            supportsSegmentTimestamps: true,
            supportsWordTimestamps: false,
          },
          familyId: 'whisper',
          runtime: {
            acceleratorDetails: { cpu: { available: true, unavailableReason: null } },
            availableAccelerators: ['cpu'],
            supportedModelFormats: ['ggml'],
          },
          runtimeId: 'whisper_cpp',
        },
        message: 'Model selection is ready.',
        modelId: 'small',
        resolvedPath: '/models/whisper-small.bin',
        runtimeId: 'whisper_cpp',
        selection: baseSelection,
        sizeBytes: 100,
        status: 'ready',
        type: 'model_probe_result',
      }),
    );
    expect(ready).toMatchObject({ available: true, status: 'ready' });

    // Rust emits explicit `null` for unset optionals (no `skip_serializing_if`),
    // so the parser trusts the wire shape verbatim instead of backfilling.
    const missing = parseEventFrame(
      JSON.stringify({
        available: false,
        details: 'not installed',
        displayName: null,
        familyId: 'whisper',
        installed: false,
        mergedCapabilities: null,
        message: 'The selected managed model is not installed or is incomplete.',
        modelId: 'small',
        resolvedPath: null,
        runtimeId: 'whisper_cpp',
        selection: baseSelection,
        sizeBytes: null,
        status: 'missing',
        type: 'model_probe_result',
      }),
    );
    expect(missing).toMatchObject({ mergedCapabilities: null, status: 'missing' });
  });

  it.each([
    ['non-object JSON', '"hello"', /Sidecar event must be a JSON object/],
    ['number JSON', '42', /Sidecar event must be a JSON object/],
    ['missing type', '{}', /Unsupported sidecar event type/],
    [
      'unknown type',
      JSON.stringify({ type: 'nonexistent_event' }),
      /Unsupported sidecar event type/,
    ],
  ] as const)('rejects malformed event (%s)', (_label, body, expectedMessage) => {
    expect(() => parseEventFrame(body)).toThrow(expectedMessage);
  });

  it.each([
    ['numeric pause', 320],
    ['null pause', null],
  ] as const)('parses transcript_ready with %s', (_label, pauseMsBeforeUtterance) => {
    const event = parseEventFrame(
      JSON.stringify(transcriptReadyPayload({ pauseMsBeforeUtterance })),
    );

    expect(event.type).toBe('transcript_ready');
    if (event.type === 'transcript_ready') {
      expect(event.pauseMsBeforeUtterance).toBe(pauseMsBeforeUtterance);
    }
  });

  it('parses transcript_ready carrying a non-empty stageResults history', () => {
    const stageResults: TranscriptReadyEvent['stageResults'] = [
      {
        durationMs: 100,
        isFinal: true,
        payload: {
          voiceActivity: {
            audioEndMs: 1100,
            audioStartMs: 100,
            maxProbability: 0.98,
            meanProbability: 0.72,
            speechEndMs: 980,
            speechStartMs: 180,
            unvoicedMs: 200,
            voicedMs: 800,
          },
        },
        revisionIn: 0,
        revisionOut: 0,
        stageId: 'engine',
        status: { kind: 'ok' },
      },
      {
        durationMs: 0,
        isFinal: true,
        revisionIn: 0,
        stageId: 'punctuation',
        status: { kind: 'skipped', reason: 'no_action' },
      },
    ];

    const event = parseEventFrame(
      JSON.stringify(transcriptReadyPayload({ pauseMsBeforeUtterance: 250, stageResults })),
    );

    expect(event).toMatchObject({
      pauseMsBeforeUtterance: 250,
      stageResults,
      type: 'transcript_ready',
    });
  });

  it.each([
    'normal',
    'catching_up',
    'falling_behind',
    'saturated',
  ] as const)('parses transcription_queue_changed at tier %s', (tier) => {
    const event = parseEventFrame(
      JSON.stringify({
        queuedUtterances: 7,
        sessionId: 'session-1',
        tier,
        type: 'transcription_queue_changed',
      }),
    );

    expect(event).toEqual({
      queuedUtterances: 7,
      sessionId: 'session-1',
      tier,
      type: 'transcription_queue_changed',
    });
  });

  it('parses session_stopped with the queue_overload reason', () => {
    expect(
      parseEventFrame(
        JSON.stringify({
          reason: 'queue_overload',
          sessionId: 'session-1',
          type: 'session_stopped',
        }),
      ),
    ).toEqual({
      reason: 'queue_overload',
      sessionId: 'session-1',
      type: 'session_stopped',
    });
  });

  it('parses context_request preserving correlation and budget', () => {
    expect(
      parseEventFrame(
        JSON.stringify({
          budgetChars: 1024,
          correlationId: 'corr-1',
          sessionId: 'session-1',
          type: 'context_request',
          utteranceId: 'utt-1',
        }),
      ),
    ).toEqual({
      budgetChars: 1024,
      correlationId: 'corr-1',
      sessionId: 'session-1',
      type: 'context_request',
      utteranceId: 'utt-1',
    });
  });
});

function readPayload(frame: Uint8Array): unknown {
  const payloadLength = new DataView(frame.buffer).getUint32(1, true);
  const payloadBytes = frame.slice(5, 5 + payloadLength);

  return JSON.parse(new TextDecoder().decode(payloadBytes));
}
