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
    AccelerationPreference, AudioFrame, Command, Event, ListeningMode, SelectedModel,
    encode_audio_frame_envelope,
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
    /// Sum of engine `processingDurationMs` across utterances (for RTF).
    pub processing_ms: u64,
    /// Whether the session reached `session_stopped` before the timeout.
    pub stopped: bool,
    /// Any `error` events, formatted `code: message`.
    pub errors: Vec<String>,
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
    run_in_process(model_path, frames, style, false)
}

/// Like [`transcribe_in_process`] but with diarization on, so each utterance in
/// the returned outcome carries the speaker index the worker assigned.
pub fn diarize_in_process(
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
) -> TranscriptionOutcome {
    run_in_process(model_path, frames, style, true)
}

fn run_in_process(
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
    diarization_enabled: bool,
) -> TranscriptionOutcome {
    let catalog = ModelCatalog::load_bundled().expect("bundled catalog should load");
    let mut app = AppState::new("e2e-test", catalog);
    let session_id = Uuid::new_v4().to_string();
    let mut outcome = TranscriptionOutcome::default();

    let (_flow, events) = app.handle_command(start_session_command(
        &session_id,
        model_path,
        style,
        diarization_enabled,
    ));
    apply_events(&mut app, events, &mut outcome);

    for frame in frames {
        let events = app.handle_audio_frame(AudioFrame {
            frame_bytes: frame.clone(),
            session_id: session_id.clone(),
        });
        apply_events(&mut app, events, &mut outcome);
        // Pump async worker output between frames so the engine's context
        // request is answered promptly and the worker queue never wedges.
        let drained = app.drain_pending_outputs();
        apply_events(&mut app, drained, &mut outcome);
    }

    let (_flow, events) = app.handle_command(Command::StopSession {
        session_id: session_id.clone(),
    });
    apply_events(&mut app, events, &mut outcome);

    let deadline = Instant::now() + DRIVE_TIMEOUT;
    while !outcome.stopped && Instant::now() < deadline {
        let events = app.drain_pending_outputs();
        if events.is_empty() {
            thread::sleep(POLL_INTERVAL);
            continue;
        }
        apply_events(&mut app, events, &mut outcome);
    }

    outcome
}

fn apply_events(app: &mut AppState, events: Vec<Event>, outcome: &mut TranscriptionOutcome) {
    for event in events {
        match event {
            Event::ContextRequest { correlation_id, .. } => {
                // Answer with no context; we only need the worker to proceed.
                let (_flow, more) = app.handle_command(Command::ContextResponse {
                    correlation_id,
                    context: None,
                });
                apply_events(app, more, outcome);
            }
            Event::TranscriptReady {
                text,
                processing_duration_ms,
                speaker_index,
                ..
            } => {
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

fn start_session_command(
    session_id: &str,
    model_path: &Path,
    style: SpeakingStyle,
    diarization_enabled: bool,
) -> Command {
    Command::StartSession {
        acceleration_preference: AccelerationPreference::CpuOnly,
        diarization_enabled,
        include_system_audio: false,
        language: "en".to_string(),
        mode: ListeningMode::AlwaysOn,
        model_selection: SelectedModel::ExternalFile {
            runtime_id: RuntimeId::WhisperCpp,
            family_id: ModelFamilyId::Whisper,
            file_path: model_path.display().to_string(),
        },
        model_store_path_override: None,
        session_start_unix_ms: SESSION_START_UNIX_MS,
        session_id: session_id.to_string(),
        speaking_style: style,
    }
}

// ---------------------------------------------------------------------------
// Subprocess (wire-protocol) driver
// ---------------------------------------------------------------------------

/// Drive a clip through the actual sidecar binary over its stdin/stdout wire
/// protocol. `bin` is typically `env!("CARGO_BIN_EXE_local-dictation-sidecar")`.
pub fn transcribe_via_process(
    bin: &str,
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
) -> TranscriptionOutcome {
    let session_id = Uuid::new_v4().to_string();
    let mut child = ProcessCommand::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
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

    write_command_frame(
        &mut stdin,
        &start_session_json(&session_id, model_path, style),
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
    model_path: &Path,
    style: SpeakingStyle,
) -> serde_json::Value {
    serde_json::json!({
        "type": "start_session",
        "sessionId": session_id,
        "mode": "always_on",
        "language": "en",
        "accelerationPreference": "cpu_only",
        "speakingStyle": speaking_style_wire(style),
        "modelSelection": {
            "kind": "external_file",
            "runtimeId": "whisper_cpp",
            "familyId": "whisper",
            "filePath": model_path.display().to_string(),
        },
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

fn write_command_frame(writer: &mut impl Write, command: &serde_json::Value) {
    let payload = serde_json::to_vec(command).expect("serialize command");
    write_frame(writer, JSON_FRAME_KIND, &payload);
}

fn write_audio_frame(writer: &mut impl Write, session_id: &str, frame_bytes: &[u8]) {
    let envelope =
        encode_audio_frame_envelope(session_id, frame_bytes).expect("audio frame should encode");
    write_frame(writer, AUDIO_FRAME_KIND, &envelope);
}

fn read_event_frame(reader: &mut impl Read) -> Option<serde_json::Value> {
    let mut header = [0_u8; FRAME_HEADER_LEN];
    read_exact_or_eof(reader, &mut header)?;
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

fn wait_with_timeout(child: &mut Child, timeout: Duration) -> Option<std::process::ExitStatus> {
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
