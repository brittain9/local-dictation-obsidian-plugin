import type {
  InstalledModelRecord,
  ModelCatalogRecord,
  ModelFamilyCapabilitiesRecord,
  ModelFamilyId,
  ModelInstallUpdateRecord,
  ModelProbeResultRecord,
  ModelRemovedRecord,
  ModelStoreRecord,
  RequestWarning,
  RuntimeCapabilitiesRecord,
  RuntimeId,
  SelectedModel,
} from '../models/model-management-types';
import type { StageOutcome, UtteranceId } from '../session/session-journal';
import { PCM_BYTES_PER_FRAME } from '../shared/pcm-format';
import { isRecord } from '../shared/type-guards';

export const JSON_FRAME_KIND = 0x01;
export const AUDIO_FRAME_KIND = 0x02;
export const FRAME_HEADER_LENGTH = 5;
export const SESSION_ID_BYTES = 16;
// Must match `MAX_FRAME_PAYLOAD` in native/src/protocol.rs. Symmetric caps stop a
// corrupted length header (or a misbehaving sidecar) from triggering a multi-GiB
// allocation that would OOM the Obsidian renderer.
export const MAX_FRAME_PAYLOAD_BYTES = 16 * 1024 * 1024;

export type AccelerationPreference = 'auto' | 'cpu_only';
export type SpeakingStyle = 'responsive' | 'balanced' | 'patient';

export const LISTENING_MODES = ['always_on', 'one_sentence'] as const;
export type ListeningMode = (typeof LISTENING_MODES)[number];

export const SESSION_STATES = [
  'error',
  'idle',
  'listening',
  'speech_detected',
  'speech_ending',
  'transcribing',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const SESSION_STOP_REASONS = [
  'queue_overload',
  'sentence_complete',
  'timeout',
  'user_cancel',
  'user_stop',
] as const;
export type SessionStopReason = (typeof SESSION_STOP_REASONS)[number];

export const QUEUE_BACKPRESSURE_TIERS = [
  'normal',
  'catching_up',
  'falling_behind',
  'saturated',
] as const;
export type QueueBackpressureTier = (typeof QUEUE_BACKPRESSURE_TIERS)[number];

export interface TranscriptSegment {
  endMs: number;
  startMs: number;
  text: string;
  timestampGranularity: TimestampGranularity;
  timestampSource: TimestampSource;
}

export const TIMESTAMP_SOURCES = ['engine', 'interpolated', 'none', 'vad'] as const;
export type TimestampSource = (typeof TIMESTAMP_SOURCES)[number];

export const TIMESTAMP_GRANULARITIES = ['segment', 'utterance', 'word'] as const;
export type TimestampGranularity = (typeof TIMESTAMP_GRANULARITIES)[number];

export type ContextWindowSource =
  | {
      kind: 'note_glossary';
      text: string;
      truncated: boolean;
    }
  | {
      kind: 'note_text';
      text: string;
      truncated: boolean;
    }
  | {
      kind: 'prior_utterance';
      text: string;
      truncated: boolean;
    };

export interface ContextWindow {
  budgetChars: number;
  sources: readonly ContextWindowSource[];
  text: string;
  truncated: boolean;
}

export interface CompiledRuntimeInfo {
  displayName: string;
  runtimeCapabilities: RuntimeCapabilitiesRecord;
  runtimeId: RuntimeId;
}

export interface CompiledAdapterInfo {
  displayName: string;
  familyCapabilities: ModelFamilyCapabilitiesRecord;
  familyId: ModelFamilyId;
  runtimeId: RuntimeId;
}

interface EnvelopeBase<TType extends string> {
  type: TType;
}

export interface HealthCommand extends EnvelopeBase<'health'> {}

export interface StartSessionCommand extends EnvelopeBase<'start_session'> {
  accelerationPreference: AccelerationPreference;
  language: 'en';
  mode: ListeningMode;
  modelSelection: SelectedModel;
  modelStorePathOverride?: string;
  sessionStartUnixMs: number;
  sessionId: string;
  speakingStyle: SpeakingStyle;
}

export interface ContextResponseCommand extends EnvelopeBase<'context_response'> {
  context: ContextWindow | null;
  correlationId: string;
}

export interface GetModelStoreCommand extends EnvelopeBase<'get_model_store'> {
  modelStorePathOverride?: string;
}

export interface ListModelCatalogCommand extends EnvelopeBase<'list_model_catalog'> {}

export interface ListInstalledModelsCommand extends EnvelopeBase<'list_installed_models'> {
  modelStorePathOverride?: string;
}

export interface ProbeModelSelectionCommand extends EnvelopeBase<'probe_model_selection'> {
  modelSelection: SelectedModel;
  modelStorePathOverride?: string;
}

export interface RemoveModelCommand extends EnvelopeBase<'remove_model'> {
  familyId: ModelFamilyId;
  modelId: string;
  modelStorePathOverride?: string;
  runtimeId: RuntimeId;
}

export interface InstallModelCommand extends EnvelopeBase<'install_model'> {
  familyId: ModelFamilyId;
  installId: string;
  modelId: string;
  modelStorePathOverride?: string;
  runtimeId: RuntimeId;
}

export interface CancelModelInstallCommand extends EnvelopeBase<'cancel_model_install'> {
  installId: string;
}

export interface StopSessionCommand extends EnvelopeBase<'stop_session'> {
  sessionId: string;
}

export interface CancelSessionCommand extends EnvelopeBase<'cancel_session'> {
  sessionId: string;
}

export interface ShutdownCommand extends EnvelopeBase<'shutdown'> {}

export interface GetSystemInfoCommand extends EnvelopeBase<'get_system_info'> {}

export type SidecarCommand =
  | CancelModelInstallCommand
  | CancelSessionCommand
  | ContextResponseCommand
  | GetModelStoreCommand
  | GetSystemInfoCommand
  | HealthCommand
  | InstallModelCommand
  | ListInstalledModelsCommand
  | ListModelCatalogCommand
  | ProbeModelSelectionCommand
  | RemoveModelCommand
  | ShutdownCommand
  | StartSessionCommand
  | StopSessionCommand;

export interface HealthOkEvent extends EnvelopeBase<'health_ok'> {
  sidecarVersion: string;
  status: 'ready';
}

export interface SystemInfoEvent extends EnvelopeBase<'system_info'> {
  compiledAdapters: CompiledAdapterInfo[];
  compiledRuntimes: CompiledRuntimeInfo[];
  sidecarVersion: string;
  systemInfo: string;
}

export interface ModelStoreEvent extends EnvelopeBase<'model_store'>, ModelStoreRecord {}

export interface ModelCatalogEvent extends EnvelopeBase<'model_catalog'>, ModelCatalogRecord {}

export interface InstalledModelsEvent extends EnvelopeBase<'installed_models'> {
  models: InstalledModelRecord[];
}

export interface ModelProbeResultEvent
  extends EnvelopeBase<'model_probe_result'>,
    ModelProbeResultRecord {}

export interface ModelRemovedEvent extends EnvelopeBase<'model_removed'>, ModelRemovedRecord {}

export interface ModelInstallUpdateEvent
  extends EnvelopeBase<'model_install_update'>,
    ModelInstallUpdateRecord {}

export interface SessionStartedEvent extends EnvelopeBase<'session_started'> {
  mode: ListeningMode;
  sessionId: string;
}

export interface SessionStateChangedEvent extends EnvelopeBase<'session_state_changed'> {
  sessionId: string;
  state: SessionState;
}

export interface TranscriptReadyEvent extends EnvelopeBase<'transcript_ready'> {
  isFinal: boolean;
  pauseMsBeforeUtterance: number | null;
  processingDurationMs: number;
  revision: number;
  segments: TranscriptSegment[];
  sessionId: string;
  stageResults: StageOutcome[];
  text: string;
  utteranceDurationMs: number;
  utteranceEndMsInSession: number;
  utteranceId: UtteranceId;
  utteranceIndex: number;
  utteranceStartMsInSession: number;
  warnings: RequestWarning[];
}

export interface TranscriptionQueueChangedEvent
  extends EnvelopeBase<'transcription_queue_changed'> {
  queuedUtterances: number;
  sessionId: string;
  tier: QueueBackpressureTier;
}

export interface ContextRequestEvent extends EnvelopeBase<'context_request'> {
  budgetChars: number;
  correlationId: string;
  sessionId: string;
  utteranceId: UtteranceId;
}

export interface WarningEvent extends EnvelopeBase<'warning'> {
  code: string;
  details?: string;
  message: string;
  sessionId?: string;
}

export interface SessionStoppedEvent extends EnvelopeBase<'session_stopped'> {
  reason: SessionStopReason;
  sessionId: string;
}

export interface ErrorEvent extends EnvelopeBase<'error'> {
  code: string;
  details?: string;
  message: string;
  sessionId?: string;
}

export type SidecarEvent =
  | ContextRequestEvent
  | ErrorEvent
  | HealthOkEvent
  | InstalledModelsEvent
  | ModelCatalogEvent
  | ModelInstallUpdateEvent
  | ModelProbeResultEvent
  | ModelRemovedEvent
  | ModelStoreEvent
  | SessionStartedEvent
  | SessionStateChangedEvent
  | SessionStoppedEvent
  | SystemInfoEvent
  | TranscriptionQueueChangedEvent
  | TranscriptReadyEvent
  | WarningEvent;

export function createHealthCommand(): HealthCommand {
  return createEnvelope('health');
}

export function createGetSystemInfoCommand(): GetSystemInfoCommand {
  return createEnvelope('get_system_info');
}

export function createStartSessionCommand(
  payload: Omit<StartSessionCommand, 'type'>,
): StartSessionCommand {
  return {
    ...createEnvelope('start_session'),
    ...payload,
  };
}

export function createGetModelStoreCommand(modelStorePathOverride?: string): GetModelStoreCommand {
  return {
    ...createEnvelope('get_model_store'),
    ...(modelStorePathOverride !== undefined ? { modelStorePathOverride } : {}),
  };
}

export function createListModelCatalogCommand(): ListModelCatalogCommand {
  return createEnvelope('list_model_catalog');
}

export function createListInstalledModelsCommand(
  modelStorePathOverride?: string,
): ListInstalledModelsCommand {
  return {
    ...createEnvelope('list_installed_models'),
    ...(modelStorePathOverride !== undefined ? { modelStorePathOverride } : {}),
  };
}

export function createProbeModelSelectionCommand(
  payload: Omit<ProbeModelSelectionCommand, 'type'>,
): ProbeModelSelectionCommand {
  return {
    ...createEnvelope('probe_model_selection'),
    ...payload,
  };
}

export function createRemoveModelCommand(
  payload: Omit<RemoveModelCommand, 'type'>,
): RemoveModelCommand {
  return {
    ...createEnvelope('remove_model'),
    ...payload,
  };
}

export function createInstallModelCommand(
  payload: Omit<InstallModelCommand, 'type'>,
): InstallModelCommand {
  return {
    ...createEnvelope('install_model'),
    ...payload,
  };
}

export function createCancelModelInstallCommand(installId: string): CancelModelInstallCommand {
  return {
    ...createEnvelope('cancel_model_install'),
    installId,
  };
}

export function createStopSessionCommand(sessionId: string): StopSessionCommand {
  return {
    ...createEnvelope('stop_session'),
    sessionId,
  };
}

export function createCancelSessionCommand(sessionId: string): CancelSessionCommand {
  return {
    ...createEnvelope('cancel_session'),
    sessionId,
  };
}

export function createShutdownCommand(): ShutdownCommand {
  return createEnvelope('shutdown');
}

export function createContextResponseCommand(
  correlationId: string,
  context: ContextWindow | null,
): ContextResponseCommand {
  return {
    ...createEnvelope('context_response'),
    context,
    correlationId,
  };
}

export function encodeJsonFrame(envelope: SidecarCommand | SidecarEvent): Uint8Array {
  return encodeFrame(JSON_FRAME_KIND, textEncoder.encode(JSON.stringify(envelope)));
}

export function encodeAudioFrame(sessionId: string, frameBytes: Uint8Array): Uint8Array {
  if (frameBytes.byteLength !== PCM_BYTES_PER_FRAME) {
    throw new Error(
      `Audio frames must be ${PCM_BYTES_PER_FRAME} bytes, received ${frameBytes.byteLength}.`,
    );
  }

  const envelope = new Uint8Array(SESSION_ID_BYTES + frameBytes.byteLength);
  envelope.set(sessionIdToBytes(sessionId), 0);
  envelope.set(frameBytes, SESSION_ID_BYTES);

  return encodeFrame(AUDIO_FRAME_KIND, envelope);
}

export function sessionIdToBytes(sessionId: string): Uint8Array {
  return Buffer.from(normalizeSessionId(sessionId), 'hex');
}

export function bytesToSessionId(bytes: Uint8Array): string {
  if (bytes.byteLength !== SESSION_ID_BYTES) {
    throw new Error(`Session ids must be ${SESSION_ID_BYTES} bytes, received ${bytes.byteLength}.`);
  }

  const hex = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function decodeAudioFrameEnvelope(payload: Uint8Array): {
  frameBytes: Uint8Array;
  sessionId: string;
} {
  if (payload.byteLength !== SESSION_ID_BYTES + PCM_BYTES_PER_FRAME) {
    throw new Error(
      `Audio frame envelopes must be ${SESSION_ID_BYTES + PCM_BYTES_PER_FRAME} bytes, received ${payload.byteLength}.`,
    );
  }

  return {
    frameBytes: payload.slice(SESSION_ID_BYTES),
    sessionId: bytesToSessionId(payload.slice(0, SESSION_ID_BYTES)),
  };
}

export interface JsonFrame<TEnvelope> {
  envelope: TEnvelope;
  kind: typeof JSON_FRAME_KIND;
}

export interface AudioFrame {
  frameBytes: Uint8Array<ArrayBufferLike>;
  kind: typeof AUDIO_FRAME_KIND;
  sessionId: string;
}

export type ParsedFrame<TEnvelope> = AudioFrame | JsonFrame<TEnvelope>;

const SIDECAR_EVENT_TYPE_FLAGS = {
  context_request: 1,
  error: 1,
  health_ok: 1,
  installed_models: 1,
  model_catalog: 1,
  model_install_update: 1,
  model_probe_result: 1,
  model_removed: 1,
  model_store: 1,
  session_started: 1,
  session_state_changed: 1,
  session_stopped: 1,
  system_info: 1,
  transcript_ready: 1,
  transcription_queue_changed: 1,
  warning: 1,
} as const satisfies Record<SidecarEvent['type'], 1>;

const SIDECAR_EVENT_TYPES: ReadonlySet<SidecarEvent['type']> = new Set(
  Object.keys(SIDECAR_EVENT_TYPE_FLAGS) as SidecarEvent['type'][],
);

function isKnownEventType(value: unknown): value is SidecarEvent['type'] {
  return typeof value === 'string' && SIDECAR_EVENT_TYPES.has(value as SidecarEvent['type']);
}

export interface PushChunkResult<TEnvelope> {
  fatal: Error | undefined;
  frames: ParsedFrame<TEnvelope>[];
}

export class FramedMessageParser<TEnvelope> {
  private buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  constructor(private readonly parseJsonEnvelope: (jsonText: string) => TEnvelope) {}

  reset(): void {
    this.buffered = new Uint8Array(0);
  }

  pushChunk(chunk: Uint8Array<ArrayBufferLike>): PushChunkResult<TEnvelope> {
    this.buffered = concatBytes(this.buffered, chunk);

    const frames: ParsedFrame<TEnvelope>[] = [];
    let offset = 0;
    let fatal: Error | undefined;

    while (this.buffered.byteLength - offset >= FRAME_HEADER_LENGTH) {
      const kind = this.buffered[offset];

      if (kind === undefined) {
        break;
      }

      const payloadLength = readUint32LE(this.buffered, offset + 1);

      // Cap before slicing: a corrupted 4-byte length header can otherwise
      // drive an allocation up to ~4 GiB while the parser waits for bytes
      // that will never arrive.
      if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
        fatal = new Error(
          `Sidecar frame payload exceeds limit: ${payloadLength} bytes (max ${MAX_FRAME_PAYLOAD_BYTES}).`,
        );
        break;
      }

      const frameLength = FRAME_HEADER_LENGTH + payloadLength;

      if (this.buffered.byteLength - offset < frameLength) {
        break;
      }

      const payload = this.buffered.slice(offset + FRAME_HEADER_LENGTH, offset + frameLength);

      try {
        if (kind === JSON_FRAME_KIND) {
          frames.push({
            envelope: this.parseJsonEnvelope(textDecoder.decode(payload)),
            kind,
          });
        } else if (kind === AUDIO_FRAME_KIND) {
          const { frameBytes, sessionId } = decodeAudioFrameEnvelope(payload);
          frames.push({
            frameBytes,
            kind,
            sessionId,
          });
        } else {
          throw new Error(`Unsupported sidecar frame kind: ${kind}`);
        }
      } catch (error) {
        fatal =
          error instanceof Error
            ? error
            : new Error(`Failed to parse sidecar frame: ${String(error)}`);
        break;
      }

      offset += frameLength;
    }

    // On fatal, the buffer is unrecoverable: payload-length corruption or an
    // unknown frame kind leaves us with no resynchronization point. Drop the
    // backlog so the caller can restart the stream from a known state.
    this.buffered = fatal ? new Uint8Array(0) : this.buffered.slice(offset);
    return { fatal, frames };
  }
}

export function parseEventFrame(jsonText: string): SidecarEvent {
  const parsedValue: unknown = JSON.parse(jsonText);

  if (!isRecord(parsedValue)) {
    throw new Error(`Sidecar event must be a JSON object, received: ${jsonText.slice(0, 200)}`);
  }

  if (!isKnownEventType(parsedValue.type)) {
    throw new Error(`Unsupported sidecar event type: ${String(parsedValue.type)}`);
  }

  return parsedValue as unknown as SidecarEvent;
}

function createEnvelope<TType extends SidecarCommand['type']>(
  type: TType,
): Extract<SidecarCommand, { type: TType }> {
  return { type } as Extract<SidecarCommand, { type: TType }>;
}

function encodeFrame(kind: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER_LENGTH + payload.byteLength);
  const view = new DataView(frame.buffer);

  frame[0] = kind;
  view.setUint32(1, payload.byteLength, true);
  frame.set(payload, FRAME_HEADER_LENGTH);

  return frame;
}

function concatBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  const concatenated = new Uint8Array(left.byteLength + right.byteLength);
  concatenated.set(left, 0);
  concatenated.set(right, left.byteLength);
  return concatenated;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) {
    throw new Error('Frame length header is truncated.');
  }

  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.toLowerCase();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

  if (!uuidPattern.test(normalized)) {
    throw new Error(`Session id must be a UUID v4 string: ${sessionId}`);
  }

  return normalized.replaceAll('-', '');
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
