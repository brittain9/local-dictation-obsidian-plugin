use std::fmt;
use std::io::{ErrorKind, Read, Write};

use anyhow::{Context, Result, anyhow, bail, ensure};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::audio_metadata::VoiceActivityEvidence;
use crate::catalog::{
    CatalogModel, ModelCollection, ModelFamilyDescriptor, ModelRuntimeDescriptor,
};
use crate::engine::capabilities::{
    EngineCapabilities, ModelFamilyCapabilities, ModelFamilyId, RequestWarning,
    RuntimeCapabilities, RuntimeId,
};
use crate::model_store::InstalledModelRecord;
use crate::session::SpeakingStyle;

const JSON_FRAME_KIND: u8 = 0x01;
const AUDIO_FRAME_KIND: u8 = 0x02;
const SYNTHESIS_AUDIO_FRAME_KIND: u8 = 0x03;
const FRAME_HEADER_LENGTH: usize = 5;
const MAX_FRAME_PAYLOAD: usize = 16 * 1024 * 1024;
const SESSION_ID_BYTES: usize = 16;
const SYNTHESIS_AUDIO_HEADER_BYTES: usize = 8;

#[derive(Debug)]
struct OversizedFramePayload {
    payload_length: usize,
}

impl fmt::Display for OversizedFramePayload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "frame payload exceeds maximum supported size: {} > {}",
            self.payload_length, MAX_FRAME_PAYLOAD
        )
    }
}

impl std::error::Error for OversizedFramePayload {}

pub const PCM_SAMPLE_RATE_HZ: usize = 16_000;
pub const PCM_CHANNEL_COUNT: usize = 1;
pub const PCM_SAMPLE_BYTES: usize = 2;
pub const PCM_FRAME_DURATION_MS: usize = 20;
pub const PCM_SAMPLES_PER_FRAME: usize = (PCM_SAMPLE_RATE_HZ / 1_000) * PCM_FRAME_DURATION_MS;
pub const PCM_BYTES_PER_FRAME: usize = PCM_SAMPLES_PER_FRAME * PCM_CHANNEL_COUNT * PCM_SAMPLE_BYTES;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SelectedModel {
    CatalogModel {
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        model_id: String,
    },
    ExternalFile {
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        file_path: String,
    },
}

impl SelectedModel {
    pub fn runtime_id(&self) -> RuntimeId {
        match self {
            Self::CatalogModel { runtime_id, .. } | Self::ExternalFile { runtime_id, .. } => {
                *runtime_id
            }
        }
    }

    pub fn family_id(&self) -> ModelFamilyId {
        match self {
            Self::CatalogModel { family_id, .. } | Self::ExternalFile { family_id, .. } => {
                *family_id
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ListeningMode {
    AlwaysOn,
    OneSentence,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccelerationPreference {
    #[default]
    Auto,
    CpuOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Idle,
    Listening,
    SpeechDetected,
    SpeechEnding,
    Transcribing,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStopReason {
    QueueOverload,
    SentenceComplete,
    /// The worker reported a session-scoped, non-recoverable error (e.g. model
    /// load failure or a panic before the worker session was established).
    /// The app-level session is torn down to match.
    SessionError,
    Timeout,
    UserCancel,
    UserStop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueBackpressureTier {
    Normal,
    CatchingUp,
    FallingBehind,
    Saturated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelProbeStatus {
    Invalid,
    Missing,
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelInstallState {
    Queued,
    Downloading,
    Verifying,
    Probing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub end_ms: u64,
    /// Session-stable speaker for this segment, assigned by the diarization
    /// stage. `None` when diarization is off or no turn could be attributed.
    /// 0-based; serialized as `null` rather than omitted.
    #[serde(default)]
    pub speaker: Option<u32>,
    pub start_ms: u64,
    pub text: String,
    pub timestamp_granularity: TimestampGranularity,
    pub timestamp_source: TimestampSource,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<TranscriptWord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptWord {
    pub end_ms: u64,
    pub start_ms: u64,
    pub text: String,
    pub timestamp_source: TimestampSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimestampSource {
    Engine,
    Vad,
    Interpolated,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimestampGranularity {
    Utterance,
    Segment,
    Word,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageId {
    Diarization,
    Engine,
    HallucinationFilter,
    Punctuation,
    UserRules,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StageStatus {
    Ok,
    Skipped { reason: String },
    Failed { error: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageOutcome {
    pub duration_ms: u64,
    pub is_final: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    pub revision_in: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision_out: Option<u32>,
    pub stage_id: StageId,
    pub status: StageStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStagePayload {
    pub pause_ms_before_utterance: Option<u64>,
    pub voice_activity: VoiceActivityEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContextWindowSource {
    #[serde(rename_all = "camelCase")]
    NoteGlossary { text: String, truncated: bool },
}

impl ContextWindowSource {
    pub fn text(&self) -> &str {
        match self {
            Self::NoteGlossary { text, .. } => text,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextWindow {
    pub budget_chars: u32,
    pub sources: Vec<ContextWindowSource>,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledRuntimeInfo {
    pub runtime_id: RuntimeId,
    pub display_name: String,
    pub runtime_capabilities: RuntimeCapabilities,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledAdapterInfo {
    pub runtime_id: RuntimeId,
    pub family_id: ModelFamilyId,
    pub display_name: String,
    pub family_capabilities: ModelFamilyCapabilities,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct CommandEnvelope {
    #[serde(flatten)]
    pub command: Command,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    Health,
    ProbeSystemAudio,
    StartSession {
        #[serde(default)]
        acceleration_preference: AccelerationPreference,
        #[serde(default)]
        detailed_timestamps_enabled: bool,
        #[serde(default)]
        diarization_enabled: bool,
        #[serde(default)]
        diarization_max_speakers: Option<u32>,
        #[serde(default)]
        include_system_audio: bool,
        language: String,
        mode: ListeningMode,
        model_selection: SelectedModel,
        #[serde(default)]
        model_store_path_override: Option<String>,
        session_start_unix_ms: u64,
        session_id: String,
        #[serde(default)]
        speaking_style: SpeakingStyle,
    },
    ContextResponse {
        correlation_id: Uuid,
        context: Option<ContextWindow>,
    },
    GetSystemInfo,
    GetModelStore {
        #[serde(default)]
        model_store_path_override: Option<String>,
    },
    ListModelCatalog,
    ListInstalledModels {
        #[serde(default)]
        model_store_path_override: Option<String>,
    },
    ProbeModelSelection {
        model_selection: SelectedModel,
        #[serde(default)]
        model_store_path_override: Option<String>,
    },
    RemoveModel {
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        model_id: String,
        #[serde(default)]
        model_store_path_override: Option<String>,
    },
    InstallModel {
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        install_id: String,
        model_id: String,
        #[serde(default)]
        artifact_ids: Vec<String>,
        #[serde(default)]
        model_store_path_override: Option<String>,
    },
    CancelModelInstall {
        install_id: String,
    },
    StartSynthesis {
        synthesis_id: u32,
        model_selection: SelectedModel,
        voice_id: String,
        language: String,
        speed: f32,
        chunks: Vec<SynthesisTextChunk>,
        #[serde(default)]
        model_store_path_override: Option<String>,
    },
    CancelSynthesis {
        synthesis_id: u32,
    },
    SynthesisPlaybackPosition {
        synthesis_id: u32,
        played_through_seq: u32,
    },
    StopSession {
        session_id: String,
    },
    CancelSession {
        session_id: String,
    },
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct EventEnvelope {
    #[serde(flatten)]
    pub event: Event,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    HealthOk {
        sidecar_version: String,
        status: HealthStatus,
    },
    ModelStore {
        override_path: Option<String>,
        path: String,
        using_default_path: bool,
    },
    ModelCatalog {
        catalog_version: u32,
        collections: Vec<ModelCollection>,
        runtimes: Vec<ModelRuntimeDescriptor>,
        families: Vec<ModelFamilyDescriptor>,
        models: Vec<CatalogModel>,
    },
    InstalledModels {
        models: Vec<InstalledModelRecord>,
    },
    ModelProbeResult {
        available: bool,
        details: Option<String>,
        display_name: Option<String>,
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        installed: bool,
        merged_capabilities: Option<EngineCapabilities>,
        message: String,
        model_id: Option<String>,
        resolved_path: Option<String>,
        selection: SelectedModel,
        size_bytes: Option<u64>,
        status: ModelProbeStatus,
    },
    ModelRemoved {
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        model_id: String,
        removed: bool,
    },
    ModelInstallUpdate {
        details: Option<String>,
        downloaded_bytes: Option<u64>,
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        install_id: String,
        message: Option<String>,
        model_id: String,
        state: ModelInstallState,
        total_bytes: Option<u64>,
    },
    SynthesisStarted {
        synthesis_id: u32,
        sample_rate: u32,
    },
    SynthesisChunkMeta {
        synthesis_id: u32,
        seq: u32,
        source_range: SourceRange,
        duration_ms: u64,
    },
    SynthesisComplete {
        synthesis_id: u32,
    },
    SynthesisError {
        synthesis_id: u32,
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<String>,
    },
    #[serde(skip)]
    SynthesisAudio {
        synthesis_id: u32,
        seq: u32,
        pcm16le: Vec<u8>,
    },
    SystemInfo {
        sidecar_version: String,
        compiled_runtimes: Vec<CompiledRuntimeInfo>,
        compiled_adapters: Vec<CompiledAdapterInfo>,
        system_info: String,
    },
    SystemAudioProbeResult {
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    SessionStarted {
        mode: ListeningMode,
        session_id: String,
    },
    SessionStateChanged {
        session_id: String,
        state: SessionState,
    },
    AudioLevel {
        bands: [f32; 6],
        session_id: String,
    },
    TranscriptReady {
        is_final: bool,
        pause_ms_before_utterance: Option<u64>,
        processing_duration_ms: u64,
        revision: u32,
        segments: Vec<TranscriptSegment>,
        session_id: String,
        speaker_index: Option<u32>,
        stage_results: Vec<StageOutcome>,
        text: String,
        utterance_duration_ms: u64,
        utterance_end_ms_in_session: u64,
        utterance_id: Uuid,
        utterance_index: u64,
        utterance_start_ms_in_session: u64,
        #[serde(default)]
        warnings: Vec<RequestWarning>,
    },
    TranscriptionQueueChanged {
        queued_utterances: usize,
        session_id: String,
        tier: QueueBackpressureTier,
    },
    ContextRequest {
        budget_chars: u32,
        correlation_id: Uuid,
        session_id: String,
        utterance_id: Uuid,
    },
    Warning {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<String>,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    SessionStopped {
        reason: SessionStopReason,
        session_id: String,
    },
    Error {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<String>,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub from: u32,
    pub to: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesisTextChunk {
    pub text: String,
    pub source_range: SourceRange,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IncomingFrame {
    Audio(AudioFrame),
    Command(Command),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioFrame {
    pub frame_bytes: Vec<u8>,
    pub session_id: String,
}

impl CommandEnvelope {
    pub fn parse_json(bytes: &[u8]) -> Result<Command> {
        let json_text = std::str::from_utf8(bytes).context("command frame must be valid UTF-8")?;
        let envelope: Self =
            serde_json::from_str(json_text).context("failed to deserialize command envelope")?;

        Ok(envelope.command)
    }
}

impl EventEnvelope {
    pub fn new(event: Event) -> Self {
        Self { event }
    }
}

pub fn read_frame<R: Read>(reader: &mut R) -> Result<Option<IncomingFrame>> {
    let mut header = [0_u8; FRAME_HEADER_LENGTH];
    let read_count = read_exact_or_eof(reader, &mut header)?;

    if read_count == 0 {
        return Ok(None);
    }

    let frame_kind = header[0];
    let payload_length = u32::from_le_bytes([header[1], header[2], header[3], header[4]]) as usize;
    if payload_length > MAX_FRAME_PAYLOAD {
        return Err(OversizedFramePayload { payload_length }.into());
    }
    let mut payload = vec![0_u8; payload_length];
    reader
        .read_exact(&mut payload)
        .context("failed to read frame payload")?;

    match frame_kind {
        JSON_FRAME_KIND => Ok(Some(IncomingFrame::Command(CommandEnvelope::parse_json(
            &payload,
        )?))),
        AUDIO_FRAME_KIND => Ok(Some(IncomingFrame::Audio(decode_audio_frame_envelope(
            &payload,
        )?))),
        _ => Err(anyhow!("unsupported frame kind {frame_kind}")),
    }
}

pub fn is_fatal_frame_error(error: &anyhow::Error) -> bool {
    error.downcast_ref::<OversizedFramePayload>().is_some()
}

pub fn encode_audio_frame_envelope(session_id: &str, frame_bytes: &[u8]) -> Result<Vec<u8>> {
    ensure!(
        frame_bytes.len() == PCM_BYTES_PER_FRAME,
        "audio frames must be {PCM_BYTES_PER_FRAME} bytes, received {}",
        frame_bytes.len()
    );
    let uuid = Uuid::parse_str(session_id).context("session id must be a UUID string")?;
    ensure!(
        uuid.get_version_num() == 4,
        "session id must be a UUID v4 string"
    );

    let mut envelope = Vec::with_capacity(SESSION_ID_BYTES + frame_bytes.len());
    envelope.extend_from_slice(uuid.as_bytes());
    envelope.extend_from_slice(frame_bytes);
    Ok(envelope)
}

pub fn decode_audio_frame_envelope(payload: &[u8]) -> Result<AudioFrame> {
    ensure!(
        payload.len() == SESSION_ID_BYTES + PCM_BYTES_PER_FRAME,
        "audio frame envelopes must be {} bytes, received {}",
        SESSION_ID_BYTES + PCM_BYTES_PER_FRAME,
        payload.len()
    );
    let session_id = Uuid::from_slice(&payload[..SESSION_ID_BYTES])
        .context("audio frame session id bytes must be a UUID")?;
    ensure!(
        session_id.get_version_num() == 4,
        "audio frame session id must be UUID v4"
    );

    Ok(AudioFrame {
        frame_bytes: payload[SESSION_ID_BYTES..].to_vec(),
        session_id: session_id.to_string(),
    })
}

pub fn write_event_frame<W: Write>(writer: &mut W, event: &Event) -> Result<()> {
    ensure!(
        !matches!(event, Event::SynthesisAudio { .. }),
        "binary synthesis audio must use write_synthesis_audio_frame"
    );
    let payload = serde_json::to_vec(&EventEnvelope::new(event.clone()))
        .context("failed to serialize event envelope")?;
    write_frame(writer, JSON_FRAME_KIND, &payload)
}

pub fn write_synthesis_audio_frame<W: Write>(
    writer: &mut W,
    synthesis_id: u32,
    seq: u32,
    pcm16le: &[u8],
) -> Result<()> {
    ensure!(
        pcm16le.len().is_multiple_of(2),
        "PCM16LE payload length must be even"
    );
    let mut payload = Vec::with_capacity(SYNTHESIS_AUDIO_HEADER_BYTES + pcm16le.len());
    payload.extend_from_slice(&synthesis_id.to_le_bytes());
    payload.extend_from_slice(&seq.to_le_bytes());
    payload.extend_from_slice(pcm16le);
    write_frame(writer, SYNTHESIS_AUDIO_FRAME_KIND, &payload)
}

fn write_frame<W: Write>(writer: &mut W, frame_kind: u8, payload: &[u8]) -> Result<()> {
    let payload_length = u32::try_from(payload.len())
        .map_err(|_| anyhow!("payload exceeds maximum frame length"))?;
    let mut header = [0_u8; FRAME_HEADER_LENGTH];

    header[0] = frame_kind;
    header[1..].copy_from_slice(&payload_length.to_le_bytes());

    writer
        .write_all(&header)
        .context("failed to write frame header")?;
    writer
        .write_all(payload)
        .context("failed to write frame payload")?;
    writer.flush().context("failed to flush frame payload")?;

    Ok(())
}

/// Collect system info from all compiled engines into a single string.
pub fn system_info_string() -> String {
    #[allow(unused_mut)]
    let mut parts: Vec<String> = Vec::new();

    #[cfg(feature = "engine-whisper")]
    parts.push(format!("whisper.cpp: {}", whisper_rs::print_system_info()));

    #[cfg(feature = "engine-cohere-transcribe")]
    parts.push("cohere-transcribe: enabled".to_string());

    #[cfg(feature = "engine-moonshine")]
    parts.push("moonshine: enabled".to_string());

    #[cfg(feature = "engine-nemotron-asr")]
    parts.push("nemotron-asr: enabled".to_string());

    parts.join(" | ")
}

fn read_exact_or_eof<R: Read>(reader: &mut R, buffer: &mut [u8]) -> Result<usize> {
    let mut total_read = 0;

    while total_read < buffer.len() {
        match reader.read(&mut buffer[total_read..]) {
            Ok(0) if total_read == 0 => return Ok(0),
            Ok(0) => bail!("unexpected EOF while reading frame header"),
            Ok(read_count) => total_read += read_count,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(error).context("failed to read frame header"),
        }
    }

    Ok(total_read)
}

#[cfg(test)]
mod tests {
    use super::{
        AUDIO_FRAME_KIND, AccelerationPreference, AudioFrame, Command, Event, EventEnvelope,
        FRAME_HEADER_LENGTH, IncomingFrame, JSON_FRAME_KIND, ListeningMode, MAX_FRAME_PAYLOAD,
        ModelInstallState, ModelProbeStatus, PCM_BYTES_PER_FRAME, QueueBackpressureTier,
        SYNTHESIS_AUDIO_FRAME_KIND, SelectedModel, SessionStopReason, SourceRange, SpeakingStyle,
        TimestampGranularity, TimestampSource, TranscriptSegment, TranscriptWord,
        encode_audio_frame_envelope, read_frame, write_event_frame, write_frame,
        write_synthesis_audio_frame,
    };
    use crate::engine::capabilities::{ModelFamilyId, RuntimeId};
    use uuid::Uuid;

    #[test]
    fn command_frame_round_trip_preserves_start_session_shape() {
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "start_session",
            "sessionId": "session-1",
            "mode": "always_on",
            "modelSelection": {
                "kind": "external_file",
                "runtimeId": "whisper_cpp",
                "familyId": "whisper",
                "filePath": "/tmp/model.bin"
            },
            "language": "en",
            "sessionStartUnixMs": 1_700_000_000_000_u64,
            "includeSystemAudio": true
        }))
        .expect("payload should serialize");
        let mut framed = Vec::new();
        write_frame(&mut framed, JSON_FRAME_KIND, &payload).expect("frame should write");

        let parsed = read_frame(&mut framed.as_slice())
            .expect("frame should parse")
            .expect("frame should exist");

        assert_eq!(
            parsed,
            IncomingFrame::Command(Command::StartSession {
                acceleration_preference: AccelerationPreference::Auto,
                detailed_timestamps_enabled: false,
                diarization_enabled: false,
                diarization_max_speakers: None,
                include_system_audio: true,
                language: "en".to_string(),
                mode: ListeningMode::AlwaysOn,
                model_selection: SelectedModel::ExternalFile {
                    runtime_id: RuntimeId::WhisperCpp,
                    family_id: ModelFamilyId::Whisper,
                    file_path: "/tmp/model.bin".to_string(),
                },
                model_store_path_override: None,
                session_start_unix_ms: 1_700_000_000_000,
                session_id: "session-1".to_string(),
                speaking_style: SpeakingStyle::Balanced,
            })
        );
    }

    #[test]
    fn start_session_unknown_fields_are_ignored() {
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "start_session",
            "sessionId": "session-extra",
            "mode": "always_on",
            "modelSelection": {
                "kind": "external_file",
                "runtimeId": "whisper_cpp",
                "familyId": "whisper",
                "filePath": "/tmp/model.bin"
            },
            "language": "en",
            "sessionStartUnixMs": 1_700_000_000_000_u64,
            "unknownFutureField": { "anything": true }
        }))
        .expect("payload should serialize");
        let mut framed = Vec::new();
        write_frame(&mut framed, JSON_FRAME_KIND, &payload).expect("frame should write");

        let parsed = read_frame(&mut framed.as_slice())
            .expect("frame should parse")
            .expect("frame should exist");

        assert!(matches!(
            parsed,
            IncomingFrame::Command(Command::StartSession { .. })
        ));
    }

    #[test]
    fn start_session_speaker_limit_round_trips() {
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "start_session",
            "sessionId": "session-speakers",
            "mode": "always_on",
            "modelSelection": {
                "kind": "external_file",
                "runtimeId": "whisper_cpp",
                "familyId": "whisper",
                "filePath": "/tmp/model.bin"
            },
            "language": "en",
            "sessionStartUnixMs": 1_700_000_000_000_u64,
            "detailedTimestampsEnabled": true,
            "diarizationEnabled": true,
            "diarizationMaxSpeakers": 2
        }))
        .expect("payload should serialize");
        let mut framed = Vec::new();
        write_frame(&mut framed, JSON_FRAME_KIND, &payload).expect("frame should write");

        let parsed = read_frame(&mut framed.as_slice())
            .expect("frame should parse")
            .expect("frame should exist");
        let IncomingFrame::Command(Command::StartSession {
            detailed_timestamps_enabled,
            diarization_enabled,
            diarization_max_speakers,
            ..
        }) = parsed
        else {
            panic!("expected start session command");
        };

        assert!(detailed_timestamps_enabled);
        assert!(diarization_enabled);
        assert_eq!(diarization_max_speakers, Some(2));
    }

    #[test]
    fn probe_system_audio_command_round_trips() {
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "probe_system_audio"
        }))
        .expect("payload should serialize");
        let mut framed = Vec::new();
        write_frame(&mut framed, JSON_FRAME_KIND, &payload).expect("frame should write");

        let parsed = read_frame(&mut framed.as_slice())
            .expect("frame should parse")
            .expect("frame should exist");

        assert_eq!(parsed, IncomingFrame::Command(Command::ProbeSystemAudio));
    }

    #[test]
    fn start_synthesis_command_round_trips_source_ranges() {
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "start_synthesis",
            "synthesisId": 7,
            "modelSelection": {
                "kind": "catalog_model",
                "runtimeId": "onnx_runtime",
                "familyId": "pocket_tts",
                "modelId": "pocket_tts_english_2026_04_int8"
            },
            "voiceId": "alba",
            "language": "en",
            "speed": 1.25,
            "chunks": [{
                "text": "Read this sentence.",
                "sourceRange": { "from": 10, "to": 29 }
            }]
        }))
        .unwrap();
        let mut framed = Vec::new();
        write_frame(&mut framed, JSON_FRAME_KIND, &payload).unwrap();
        let IncomingFrame::Command(Command::StartSynthesis {
            chunks,
            language,
            speed,
            ..
        }) = read_frame(&mut framed.as_slice()).unwrap().unwrap()
        else {
            panic!("expected start_synthesis");
        };
        assert_eq!(speed, 1.25);
        assert_eq!(language, "en");
        assert_eq!(chunks[0].source_range, SourceRange { from: 10, to: 29 });
    }

    #[test]
    fn synthesis_audio_frame_uses_binary_kind_and_little_endian_header() {
        let mut framed = Vec::new();
        write_synthesis_audio_frame(&mut framed, 0x0102_0304, 9, &[0x01, 0x80]).unwrap();
        assert_eq!(framed[0], SYNTHESIS_AUDIO_FRAME_KIND);
        assert_eq!(u32::from_le_bytes(framed[1..5].try_into().unwrap()), 10);
        assert_eq!(&framed[5..9], &0x0102_0304_u32.to_le_bytes());
        assert_eq!(&framed[9..13], &9_u32.to_le_bytes());
        assert_eq!(&framed[13..], &[0x01, 0x80]);
    }

    #[test]
    fn audio_level_event_serializes_for_ribbon_metering() {
        let event = Event::AudioLevel {
            bands: [0.0, 0.1, 0.2, 0.3, 0.4, 1.0],
            session_id: "session-1".to_string(),
        };
        let mut framed = Vec::new();
        write_event_frame(&mut framed, &event).expect("event should write");
        let payload = &framed[FRAME_HEADER_LENGTH..];
        let parsed: EventEnvelope = serde_json::from_slice(payload).expect("event should parse");

        assert_eq!(parsed.event, event);
    }

    #[test]
    fn system_audio_probe_result_omits_success_error_fields() {
        let event = Event::SystemAudioProbeResult {
            ok: true,
            code: None,
            message: None,
        };
        let mut framed = Vec::new();
        write_event_frame(&mut framed, &event).expect("event should write");
        let payload = &framed[FRAME_HEADER_LENGTH..];
        let parsed: serde_json::Value =
            serde_json::from_slice(payload).expect("event should parse");

        assert_eq!(
            parsed,
            serde_json::json!({
                "type": "system_audio_probe_result",
                "ok": true
            })
        );
    }

    #[test]
    fn speaking_style_round_trips_for_all_three_values() {
        for (wire, expected) in [
            ("responsive", SpeakingStyle::Responsive),
            ("balanced", SpeakingStyle::Balanced),
            ("patient", SpeakingStyle::Patient),
        ] {
            let payload = serde_json::to_vec(&serde_json::json!({
                "type": "start_session",
                "sessionId": "session-style",
                "mode": "always_on",
                "modelSelection": {
                    "kind": "external_file",
                    "runtimeId": "whisper_cpp",
                    "familyId": "whisper",
                    "filePath": "/tmp/model.bin"
                },
                "language": "en",
                "sessionStartUnixMs": 1_700_000_000_000_u64,
                "speakingStyle": wire,
            }))
            .expect("payload should serialize");
            let mut framed = Vec::new();
            write_frame(&mut framed, JSON_FRAME_KIND, &payload).expect("frame should write");

            let parsed = read_frame(&mut framed.as_slice())
                .expect("frame should parse")
                .expect("frame should exist");

            let IncomingFrame::Command(Command::StartSession { speaking_style, .. }) = parsed
            else {
                panic!("expected StartSession for wire={wire}");
            };
            assert_eq!(speaking_style, expected, "wire={wire}");
        }
    }

    #[test]
    fn get_system_info_round_trip() {
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "get_system_info"
        }))
        .expect("payload should serialize");
        let mut framed = Vec::new();
        write_frame(&mut framed, JSON_FRAME_KIND, &payload).expect("frame should write");

        let parsed = read_frame(&mut framed.as_slice())
            .expect("frame should parse")
            .expect("frame should exist");

        assert_eq!(parsed, IncomingFrame::Command(Command::GetSystemInfo));
    }

    #[test]
    fn event_frame_round_trip_preserves_model_store_shape() {
        let event = Event::ModelStore {
            override_path: None,
            path: "/tmp/models".to_string(),
            using_default_path: true,
        };
        let mut framed = Vec::new();
        write_event_frame(&mut framed, &event).expect("frame should write");
        let payload_length =
            u32::from_le_bytes([framed[1], framed[2], framed[3], framed[4]]) as usize;
        let payload = &framed[FRAME_HEADER_LENGTH..FRAME_HEADER_LENGTH + payload_length];
        let parsed: EventEnvelope = serde_json::from_slice(payload).expect("event should parse");

        assert_eq!(parsed.event, event);
    }

    #[test]
    fn audio_frame_round_trip_preserves_payload() {
        let payload = vec![7_u8; PCM_BYTES_PER_FRAME];
        let session_id = "123e4567-e89b-42d3-a456-426614174000";
        let envelope =
            encode_audio_frame_envelope(session_id, &payload).expect("envelope should encode");
        let mut framed = Vec::new();
        write_frame(&mut framed, AUDIO_FRAME_KIND, &envelope).expect("frame should write");

        let parsed = read_frame(&mut framed.as_slice())
            .expect("frame should parse")
            .expect("frame should exist");

        assert_eq!(
            parsed,
            IncomingFrame::Audio(AudioFrame {
                frame_bytes: payload,
                session_id: session_id.to_string(),
            })
        );
    }

    #[test]
    fn transcription_queue_changed_event_round_trips_with_tier_strings() {
        for (tier, expected) in [
            (QueueBackpressureTier::Normal, "normal"),
            (QueueBackpressureTier::CatchingUp, "catching_up"),
            (QueueBackpressureTier::FallingBehind, "falling_behind"),
            (QueueBackpressureTier::Saturated, "saturated"),
        ] {
            let event = Event::TranscriptionQueueChanged {
                queued_utterances: 5,
                session_id: "session-1".to_string(),
                tier,
            };
            let json = serde_json::to_value(&event).expect("event should serialize");
            assert_eq!(json["type"], "transcription_queue_changed");
            assert_eq!(json["tier"], expected);
            let round_tripped: Event =
                serde_json::from_value(json).expect("event should parse back");
            assert_eq!(round_tripped, event);
        }
    }

    #[test]
    fn session_stopped_serializes_queue_overload_reason() {
        let event = Event::SessionStopped {
            reason: SessionStopReason::QueueOverload,
            session_id: "session-1".to_string(),
        };
        let json = serde_json::to_value(&event).expect("event should serialize");
        assert_eq!(json["reason"], "queue_overload");
        let round_tripped: Event = serde_json::from_value(json).expect("event should parse back");
        assert_eq!(round_tripped, event);
    }

    #[test]
    fn transcript_ready_serializes_pause_ms_before_utterance() {
        let utterance_id = Uuid::new_v4();
        let make_event = |pause: Option<u64>| Event::TranscriptReady {
            is_final: true,
            pause_ms_before_utterance: pause,
            processing_duration_ms: 12,
            revision: 0,
            segments: Vec::new(),
            session_id: "session-1".to_string(),
            speaker_index: None,
            stage_results: Vec::new(),
            text: "hello".to_string(),
            utterance_duration_ms: 1000,
            utterance_end_ms_in_session: 1100,
            utterance_id,
            utterance_index: 0,
            utterance_start_ms_in_session: 100,
            warnings: Vec::new(),
        };

        let with_value = make_event(Some(750));
        let json = serde_json::to_value(&with_value).expect("event should serialize");
        assert_eq!(json["pauseMsBeforeUtterance"], 750);
        let round_tripped: Event = serde_json::from_value(json).expect("event should parse back");
        assert_eq!(round_tripped, with_value);

        let with_null = make_event(None);
        let json = serde_json::to_value(&with_null).expect("event should serialize");
        assert!(
            json["pauseMsBeforeUtterance"].is_null(),
            "None must serialize as JSON null, not be omitted: {json}"
        );
        let round_tripped: Event = serde_json::from_value(json).expect("event should parse back");
        assert_eq!(round_tripped, with_null);
    }

    #[test]
    fn transcript_segment_serializes_word_timing_and_omits_an_empty_alignment() {
        let mut segment = TranscriptSegment {
            end_ms: 900,
            speaker: None,
            start_ms: 100,
            text: "hello".to_string(),
            timestamp_granularity: TimestampGranularity::Segment,
            timestamp_source: TimestampSource::Engine,
            words: vec![TranscriptWord {
                end_ms: 900,
                start_ms: 100,
                text: "hello".to_string(),
                timestamp_source: TimestampSource::Engine,
            }],
        };

        let json = serde_json::to_value(&segment).expect("segment should serialize");
        assert_eq!(json["words"][0]["startMs"], 100);
        assert_eq!(json["words"][0]["timestampSource"], "engine");

        segment.words.clear();
        let json = serde_json::to_value(&segment).expect("segment should serialize");
        assert!(json.get("words").is_none());
    }

    #[test]
    fn oversized_frame_payload_is_rejected_before_allocation() {
        let mut framed = Vec::new();
        framed.push(JSON_FRAME_KIND);
        framed.extend_from_slice(&((MAX_FRAME_PAYLOAD + 1) as u32).to_le_bytes());

        let error = read_frame(&mut framed.as_slice()).expect_err("frame should be rejected");

        assert!(
            error
                .to_string()
                .contains("frame payload exceeds maximum supported size")
        );
    }

    // The TypeScript side declares these fields as `T | null` (non-optional) /
    // non-optional `Vec` and trusts the wire format. Omitting a field would
    // surface as `undefined` in JS and bypass `!== null` checks downstream
    // (NaN math, broken iterators). Pin the contract: optional becomes null,
    // empty vec becomes `[]`.

    #[test]
    fn transcript_ready_serializes_empty_warnings_as_empty_array() {
        let event = Event::TranscriptReady {
            is_final: true,
            pause_ms_before_utterance: None,
            processing_duration_ms: 12,
            revision: 0,
            segments: Vec::new(),
            session_id: "session-1".to_string(),
            speaker_index: None,
            stage_results: Vec::new(),
            text: "hello".to_string(),
            utterance_duration_ms: 1000,
            utterance_end_ms_in_session: 1100,
            utterance_id: Uuid::new_v4(),
            utterance_index: 0,
            utterance_start_ms_in_session: 100,
            warnings: Vec::new(),
        };
        let json = serde_json::to_value(&event).expect("event should serialize");

        assert_eq!(json["warnings"], serde_json::json!([]));
    }

    #[test]
    fn model_install_update_serializes_none_optionals_as_null() {
        let event = Event::ModelInstallUpdate {
            details: None,
            downloaded_bytes: None,
            runtime_id: RuntimeId::WhisperCpp,
            family_id: ModelFamilyId::Whisper,
            install_id: "install-1".to_string(),
            message: None,
            model_id: "small".to_string(),
            state: ModelInstallState::Queued,
            total_bytes: None,
        };
        let json = serde_json::to_value(&event).expect("event should serialize");

        for field in ["details", "downloadedBytes", "message", "totalBytes"] {
            assert!(
                json[field].is_null(),
                "{field} must serialize as JSON null, not be omitted: {json}"
            );
        }
    }

    #[test]
    fn model_probe_result_serializes_none_optionals_as_null() {
        let event = Event::ModelProbeResult {
            available: false,
            details: None,
            display_name: None,
            runtime_id: RuntimeId::WhisperCpp,
            family_id: ModelFamilyId::Whisper,
            installed: false,
            merged_capabilities: None,
            message: "missing".to_string(),
            model_id: None,
            resolved_path: None,
            selection: SelectedModel::ExternalFile {
                runtime_id: RuntimeId::WhisperCpp,
                family_id: ModelFamilyId::Whisper,
                file_path: "/tmp/m.bin".to_string(),
            },
            size_bytes: None,
            status: ModelProbeStatus::Missing,
        };
        let json = serde_json::to_value(&event).expect("event should serialize");

        for field in [
            "details",
            "displayName",
            "mergedCapabilities",
            "modelId",
            "resolvedPath",
            "sizeBytes",
        ] {
            assert!(
                json[field].is_null(),
                "{field} must serialize as JSON null, not be omitted: {json}"
            );
        }
    }

    #[test]
    fn model_store_serializes_none_override_as_null() {
        let event = Event::ModelStore {
            override_path: None,
            path: "/tmp/models".to_string(),
            using_default_path: true,
        };
        let json = serde_json::to_value(&event).expect("event should serialize");

        assert!(json["overridePath"].is_null());
    }
}
