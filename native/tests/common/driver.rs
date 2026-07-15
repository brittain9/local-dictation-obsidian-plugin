//! Drives audio through the full sidecar and collects the resulting transcript.
//!
//! Two drivers, one shared [`TranscriptionOutcome`]:
//!
//! * [`transcribe_in_process`] replicates `main.rs`'s command/audio dispatch loop
//!   against the public [`AppState`] API. Fast to iterate, and exercises the real
//!   VAD, worker thread, and whisper inference — everything except stdio framing.
//! * [`transcribe_via_process`] spawns the actual compiled binary and speaks the
//!   length-prefixed stdin/stdout wire protocol the TypeScript plugin uses. The
//!   faithful "full sidecar" contract guard.
//!
//! Both feed a clip's frames, answer the engine's context request with no
//! context, request a stop, and gather every `transcript_ready` until the
//! session stops.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command as ProcessCommand, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use local_dictation_sidecar::app::AppState;
use local_dictation_sidecar::catalog::ModelCatalog;
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::{
    AccelerationPreference, AudioFrame, Command, ContextWindow, Event, ListeningMode,
    SelectedModel, encode_audio_frame_envelope,
};
use local_dictation_sidecar::session::SpeakingStyle;
use uuid::Uuid;

/// Frame kinds from the wire protocol (`protocol.rs`). Redeclared here so the
/// subprocess driver tests the byte-level contract independently of internals.
const JSON_FRAME_KIND: u8 = 0x01;
const AUDIO_FRAME_KIND: u8 = 0x02;
const FRAME_HEADER_LEN: usize = 5;

/// Upper bound on how long to wait for a clip to fully transcribe and stop.
/// Tiny-model CPU inference on a ~11 s clip is a few seconds; this is generous
/// headroom for slow/loaded CI hosts.
const DRIVE_TIMEOUT: Duration = Duration::from_secs(180);
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const STREAMING_CADENCE_FRAMES: usize = 25;
const STREAMING_CADENCE_DELAY: Duration = Duration::from_millis(500);

const SESSION_START_UNIX_MS: u64 = 1_700_000_000_000;

/// What the sidecar produced for one driven clip.
#[derive(Debug, Default, Clone)]
pub struct TranscriptionOutcome {
    /// All final transcripts, trimmed and joined with single spaces.
    pub text: String,
    /// How many non-empty `transcript_ready` events were emitted.
    pub utterance_count: usize,
    /// The speaker index attached to each non-empty utterance, in order. `None`
    /// when diarization is disabled or the embedding step did not assign one.
    /// Parallel to the utterances counted by `utterance_count`.
    pub speakers: Vec<Option<u32>>,
    /// Per-utterance `(speaker, text)` in arrival order, so a diarization probe
    /// can print which words each predicted speaker was credited with.
    pub utterances: Vec<(Option<u32>, String)>,
    /// Per-*segment* `(speaker, text)` flattened across all utterances, in order.
    /// Segment-level attribution is the point of turn diarization: one VAD
    /// utterance can carry several speaker-labelled segments.
    pub labeled_segments: Vec<(Option<u32>, String)>,
    /// Sum of engine `processingDurationMs` across utterances (for RTF).
    pub processing_ms: u64,
    /// Whether the session reached `session_stopped` before the timeout.
    pub stopped: bool,
    /// Any `error` events, formatted `code: message`.
    pub errors: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct StreamingRevision {
    pub revision: u32,
    pub text: String,
    pub processing_ms: u64,
    pub utterance_duration_ms: u64,
}

#[derive(Debug, Default, Clone)]
pub struct StreamingOutcome {
    pub partials: Vec<StreamingRevision>,
    pub final_text: String,
    pub final_revision: Option<u32>,
    pub processing_ms: u64,
    pub errors: Vec<String>,
    pub stopped: bool,
}

// ---------------------------------------------------------------------------
// In-process driver
// ---------------------------------------------------------------------------

/// Drive a clip through an in-process [`AppState`], CPU-only for determinism,
/// with speaker diarization disabled (the transcription-accuracy path).
pub fn transcribe_in_process(
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
) -> TranscriptionOutcome {
    transcribe_in_process_language(model_path, frames, style, "en")
}

pub fn transcribe_in_process_language(
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
    language: &str,
) -> TranscriptionOutcome {
    run_in_process(
        whisper_selection(model_path),
        frames,
        style,
        false,
        language,
        None,
    )
}

pub fn transcribe_in_process_language_with_context(
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
    language: &str,
    context: ContextWindow,
) -> TranscriptionOutcome {
    run_in_process(
        whisper_selection(model_path),
        frames,
        style,
        false,
        language,
        Some(context),
    )
}

/// Like [`transcribe_in_process`] but with diarization on, so each utterance in
/// the returned outcome carries the speaker index the worker assigned.
pub fn diarize_in_process(
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
) -> TranscriptionOutcome {
    run_in_process(
        whisper_selection(model_path),
        frames,
        style,
        true,
        "en",
        None,
    )
}

fn run_in_process(
    model_selection: SelectedModel,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
    diarization_enabled: bool,
    language: &str,
    context: Option<ContextWindow>,
) -> TranscriptionOutcome {
    let catalog = ModelCatalog::load_bundled().expect("bundled catalog should load");
    let mut app = AppState::new("e2e-test", catalog);
    let session_id = Uuid::new_v4().to_string();
    let mut outcome = TranscriptionOutcome::default();

    let (_flow, events) = app.handle_command(start_session_command(
        &session_id,
        model_selection,
        style,
        diarization_enabled,
        language,
    ));
    apply_events(&mut app, events, &mut outcome, context.as_ref());
    if !outcome.errors.is_empty() {
        return outcome;
    }

    for frame in frames {
        let events = app.handle_audio_frame(AudioFrame {
            frame_bytes: frame.clone(),
            session_id: session_id.clone(),
        });
        apply_events(&mut app, events, &mut outcome, context.as_ref());
        // Pump async worker output between frames so the engine's context
        // request is answered promptly and the worker queue never wedges.
        let drained = app.drain_pending_outputs();
        apply_events(&mut app, drained, &mut outcome, context.as_ref());
        if !outcome.errors.is_empty() {
            return outcome;
        }
    }

    let (_flow, events) = app.handle_command(Command::StopSession {
        session_id: session_id.clone(),
    });
    apply_events(&mut app, events, &mut outcome, context.as_ref());

    let deadline = Instant::now() + DRIVE_TIMEOUT;
    while !outcome.stopped && Instant::now() < deadline {
        let events = app.drain_pending_outputs();
        if events.is_empty() {
            thread::sleep(POLL_INTERVAL);
            continue;
        }
        apply_events(&mut app, events, &mut outcome, context.as_ref());
    }

    outcome
}

pub fn stream_in_process(model: SelectedModel, frames: &[Vec<u8>]) -> StreamingOutcome {
    stream_in_process_language(model, frames, "en")
}

pub fn stream_in_process_language(
    model: SelectedModel,
    frames: &[Vec<u8>],
    language: &str,
) -> StreamingOutcome {
    let catalog = ModelCatalog::load_bundled().expect("bundled catalog should load");
    let mut app = AppState::new("streaming-e2e", catalog);
    let session_id = Uuid::new_v4().to_string();
    let mut outcome = StreamingOutcome::default();

    let (_flow, events) = app.handle_command(start_session_command(
        &session_id,
        model,
        SpeakingStyle::Patient,
        false,
        language,
    ));
    apply_streaming_events(&mut app, events, &mut outcome);
    if !outcome.errors.is_empty() {
        return outcome;
    }

    let mut cadence_has_audio = false;
    for (index, frame) in frames.iter().enumerate() {
        let events = app.handle_audio_frame(AudioFrame {
            frame_bytes: frame.clone(),
            session_id: session_id.clone(),
        });
        apply_streaming_events(&mut app, events, &mut outcome);
        let drained = app.drain_pending_outputs();
        apply_streaming_events(&mut app, drained, &mut outcome);
        if !outcome.errors.is_empty() {
            return outcome;
        }

        cadence_has_audio |= frame.iter().any(|byte| *byte != 0);
        if (index + 1) % STREAMING_CADENCE_FRAMES == 0 {
            if cadence_has_audio {
                thread::sleep(STREAMING_CADENCE_DELAY);
            }
            cadence_has_audio = false;
        }
    }

    let (_flow, events) = app.handle_command(Command::StopSession {
        session_id: session_id.clone(),
    });
    apply_streaming_events(&mut app, events, &mut outcome);

    let deadline = Instant::now() + DRIVE_TIMEOUT;
    while !outcome.stopped && Instant::now() < deadline {
        let events = app.drain_pending_outputs();
        if events.is_empty() {
            thread::sleep(POLL_INTERVAL);
            continue;
        }
        apply_streaming_events(&mut app, events, &mut outcome);
    }

    outcome
}

fn apply_events(
    app: &mut AppState,
    events: Vec<Event>,
    outcome: &mut TranscriptionOutcome,
    context: Option<&ContextWindow>,
) {
    for event in events {
        match event {
            Event::ContextRequest { correlation_id, .. } => {
                // Answer with no context; we only need the worker to proceed.
                let (_flow, more) = app.handle_command(Command::ContextResponse {
                    correlation_id,
                    context: context.cloned(),
                });
                apply_events(app, more, outcome, context);
            }
            Event::TranscriptReady {
                text,
                processing_duration_ms,
                speaker_index,
                segments,
                ..
            } => {
                for segment in &segments {
                    let trimmed = segment.text.trim();
                    if !trimmed.is_empty() {
                        outcome
                            .labeled_segments
                            .push((segment.speaker, trimmed.to_string()));
                    }
                }
                push_transcript(outcome, &text, speaker_index);
                outcome.processing_ms += processing_duration_ms;
            }
            Event::SessionStopped { .. } => outcome.stopped = true,
            Event::Error { code, message, .. } => {
                outcome.errors.push(format!("{code}: {message}"));
            }
            _ => {}
        }
    }
}

fn apply_streaming_events(app: &mut AppState, events: Vec<Event>, outcome: &mut StreamingOutcome) {
    for event in events {
        match event {
            Event::ContextRequest { correlation_id, .. } => {
                let (_flow, more) = app.handle_command(Command::ContextResponse {
                    correlation_id,
                    context: None,
                });
                apply_streaming_events(app, more, outcome);
            }
            Event::TranscriptReady {
                is_final,
                processing_duration_ms,
                revision,
                text,
                utterance_duration_ms,
                ..
            } => {
                let text = text.trim().to_string();
                outcome.processing_ms += processing_duration_ms;
                if is_final {
                    outcome.final_revision = Some(revision);
                    if !text.is_empty() {
                        outcome.final_text = text;
                    }
                } else {
                    outcome.partials.push(StreamingRevision {
                        revision,
                        text,
                        processing_ms: processing_duration_ms,
                        utterance_duration_ms,
                    });
                }
            }
            Event::SessionStopped { .. } => outcome.stopped = true,
            Event::Error { code, message, .. } => {
                outcome.errors.push(format!("{code}: {message}"));
            }
            _ => {}
        }
    }
}

fn start_session_command(
    session_id: &str,
    model_selection: SelectedModel,
    style: SpeakingStyle,
    diarization_enabled: bool,
    language: &str,
) -> Command {
    Command::StartSession {
        acceleration_preference: AccelerationPreference::CpuOnly,
        detailed_timestamps_enabled: false,
        diarization_enabled,
        diarization_max_speakers: None,
        include_system_audio: false,
        language: language.to_string(),
        mode: ListeningMode::AlwaysOn,
        model_selection,
        model_store_path_override: None,
        session_start_unix_ms: SESSION_START_UNIX_MS,
        session_id: session_id.to_string(),
        speaking_style: style,
    }
}

fn whisper_selection(model_path: &Path) -> SelectedModel {
    SelectedModel::ExternalFile {
        runtime_id: RuntimeId::WhisperCpp,
        family_id: ModelFamilyId::Whisper,
        file_path: model_path.display().to_string(),
    }
}

// ---------------------------------------------------------------------------
// Subprocess (wire-protocol) driver
// ---------------------------------------------------------------------------

/// Drive a clip through the actual sidecar binary over its stdin/stdout wire
/// protocol with diarization disabled. `bin` is typically
/// `env!("CARGO_BIN_EXE_local-dictation-sidecar")`.
pub fn transcribe_via_process(
    bin: &str,
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
) -> TranscriptionOutcome {
    run_via_process(bin, model_path, frames, style, false)
}

/// Like [`transcribe_via_process`] but enables diarization on the framed
/// `start_session` command and collects segment-level speaker labels from the
/// serialized `transcript_ready` events.
pub fn diarize_via_process(
    bin: &str,
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
) -> TranscriptionOutcome {
    run_via_process(bin, model_path, frames, style, true)
}

fn run_via_process(
    bin: &str,
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
    diarization_enabled: bool,
) -> TranscriptionOutcome {
    let session_id = Uuid::new_v4().to_string();
    let mut child = ProcessCommand::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap_or_else(|error| panic!("failed to spawn sidecar {bin}: {error}"));

    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");

    // Reader thread: continuously parse event frames so the child never blocks
    // writing to a full stdout pipe while we are still feeding it input.
    let (event_tx, event_rx) = mpsc::channel::<serde_json::Value>();
    let reader = thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        while let Some(event) = read_event_frame(&mut reader) {
            if event_tx.send(event).is_err() {
                break;
            }
        }
    });

    let model_selection = whisper_selection(model_path);
    write_command_frame(
        &mut stdin,
        &start_session_json(&session_id, &model_selection, style, diarization_enabled),
    );
    for frame in frames {
        write_audio_frame(&mut stdin, &session_id, frame);
    }
    write_command_frame(
        &mut stdin,
        &serde_json::json!({ "type": "stop_session", "sessionId": session_id }),
    );
    stdin.flush().ok();

    let mut outcome = TranscriptionOutcome::default();
    let deadline = Instant::now() + DRIVE_TIMEOUT;
    while !outcome.stopped && Instant::now() < deadline {
        match event_rx.recv_timeout(POLL_INTERVAL) {
            Ok(event) => apply_json_event(&mut stdin, &event, &mut outcome),
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    write_command_frame(&mut stdin, &serde_json::json!({ "type": "shutdown" }));
    stdin.flush().ok();
    drop(stdin);
    let _ = reader.join();
    let _ = wait_with_timeout(&mut child, Duration::from_secs(10));

    outcome
}

fn apply_json_event(
    stdin: &mut impl Write,
    event: &serde_json::Value,
    outcome: &mut TranscriptionOutcome,
) {
    match event.get("type").and_then(serde_json::Value::as_str) {
        Some("context_request") => {
            if let Some(correlation_id) = event.get("correlationId").and_then(|v| v.as_str()) {
                write_command_frame(
                    stdin,
                    &serde_json::json!({
                        "type": "context_response",
                        "correlationId": correlation_id,
                        "context": null,
                    }),
                );
                stdin.flush().ok();
            }
        }
        Some("transcript_ready") => {
            if let Some(segments) = event.get("segments").and_then(serde_json::Value::as_array) {
                for segment in segments {
                    let Some(text) = segment.get("text").and_then(serde_json::Value::as_str) else {
                        continue;
                    };
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let speaker = segment
                        .get("speaker")
                        .and_then(serde_json::Value::as_u64)
                        .map(|index| index as u32);
                    outcome
                        .labeled_segments
                        .push((speaker, trimmed.to_string()));
                }
            }
            if let Some(text) = event.get("text").and_then(|v| v.as_str()) {
                let speaker_index = event
                    .get("speakerIndex")
                    .and_then(serde_json::Value::as_u64)
                    .map(|index| index as u32);
                push_transcript(outcome, text, speaker_index);
            }
            outcome.processing_ms += event
                .get("processingDurationMs")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
        }
        Some("session_stopped") => outcome.stopped = true,
        Some("error") => {
            let code = event.get("code").and_then(|v| v.as_str()).unwrap_or("");
            let message = event.get("message").and_then(|v| v.as_str()).unwrap_or("");
            outcome.errors.push(format!("{code}: {message}"));
        }
        _ => {}
    }
}

fn start_session_json(
    session_id: &str,
    model_selection: &SelectedModel,
    style: SpeakingStyle,
    diarization_enabled: bool,
) -> serde_json::Value {
    serde_json::json!({
        "type": "start_session",
        "sessionId": session_id,
        "mode": "always_on",
        "language": "en",
        "accelerationPreference": "cpu_only",
        "diarizationEnabled": diarization_enabled,
        "speakingStyle": speaking_style_wire(style),
        "modelSelection": model_selection,
        "sessionStartUnixMs": SESSION_START_UNIX_MS,
    })
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

fn push_transcript(outcome: &mut TranscriptionOutcome, text: &str, speaker_index: Option<u32>) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    if !outcome.text.is_empty() {
        outcome.text.push(' ');
    }
    outcome.text.push_str(trimmed);
    outcome.utterance_count += 1;
    outcome.speakers.push(speaker_index);
    outcome
        .utterances
        .push((speaker_index, trimmed.to_string()));
}

fn speaking_style_wire(style: SpeakingStyle) -> &'static str {
    match style {
        SpeakingStyle::Responsive => "responsive",
        SpeakingStyle::Balanced => "balanced",
        SpeakingStyle::Patient => "patient",
    }
}

fn write_frame(writer: &mut impl Write, kind: u8, payload: &[u8]) {
    let len = u32::try_from(payload.len()).expect("frame payload fits in u32");
    let mut header = [0_u8; FRAME_HEADER_LEN];
    header[0] = kind;
    header[1..].copy_from_slice(&len.to_le_bytes());
    writer.write_all(&header).expect("write frame header");
    writer.write_all(payload).expect("write frame payload");
}

pub fn write_command_frame(writer: &mut impl Write, command: &serde_json::Value) {
    let payload = serde_json::to_vec(command).expect("serialize command");
    write_frame(writer, JSON_FRAME_KIND, &payload);
}

fn write_audio_frame(writer: &mut impl Write, session_id: &str, frame_bytes: &[u8]) {
    let envelope =
        encode_audio_frame_envelope(session_id, frame_bytes).expect("audio frame should encode");
    write_frame(writer, AUDIO_FRAME_KIND, &envelope);
}

pub fn read_event_frame(reader: &mut impl Read) -> Option<serde_json::Value> {
    let mut header = [0_u8; FRAME_HEADER_LEN];
    read_exact_or_eof(reader, &mut header)?;
    if header[0] != JSON_FRAME_KIND {
        return None;
    }
    let len = u32::from_le_bytes([header[1], header[2], header[3], header[4]]) as usize;
    let mut payload = vec![0_u8; len];
    reader.read_exact(&mut payload).ok()?;
    // Events are always JSON frames; a malformed one yields None and ends the read.
    serde_json::from_slice(&payload).ok()
}

fn read_exact_or_eof(reader: &mut impl Read, buffer: &mut [u8]) -> Option<()> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => return None,
            Ok(count) => filled += count,
            Err(ref error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return None,
        }
    }
    Some(())
}

pub fn wait_with_timeout(child: &mut Child, timeout: Duration) -> Option<std::process::ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return child.wait().ok();
                }
                thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return None,
        }
    }
}
