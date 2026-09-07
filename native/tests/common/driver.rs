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

use std::io::{BufRead, Read, Write};
use std::path::Path;
use std::process::{Child, Command as ProcessCommand, Stdio};
use std::sync::{Arc, Mutex, mpsc};
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
    )
}

/// Like [`transcribe_in_process`] but with diarization on, so each utterance in
/// the returned outcome carries the speaker index the worker assigned.
pub fn diarize_in_process(
    model_path: &Path,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
) -> TranscriptionOutcome {
    run_in_process(whisper_selection(model_path), frames, style, true, "en")
}

fn run_in_process(
    model_selection: SelectedModel,
    frames: &[Vec<u8>],
    style: SpeakingStyle,
    diarization_enabled: bool,
    language: &str,
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
    apply_events(&mut app, events, &mut outcome);
    if !outcome.errors.is_empty() {
        return outcome;
    }

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
        if !outcome.errors.is_empty() {
            return outcome;
        }
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
        force_continuous_transcription: false,
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
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("failed to spawn sidecar {bin}: {error}"));

    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    // Captured rather than inherited so that a child that dies before reading a
    // single frame can still explain itself in the failure message.
    let captured_stderr = CapturedStderr::default();
    let stderr_collector = {
        let captured = captured_stderr.clone();
        thread::spawn(move || collect_stderr(stderr, captured))
    };

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
    // Every write is a place the child may already be dead, and a dead child
    // shows up here only as `BrokenPipe`. Feeding stops at the first such error
    // so the run ends on the child's own diagnosis rather than on a cascade of
    // broken-pipe panics from the frames that follow.
    let mut outcome = TranscriptionOutcome::default();
    let mut send_failure = None;

    let start = start_session_json(&session_id, &model_selection, style, diarization_enabled);
    if let Err(error) = write_command_frame(&mut stdin, &start) {
        send_failure = Some(format!("start_session: {error}"));
    }
    if send_failure.is_none() {
        for (index, frame) in frames.iter().enumerate() {
            if let Err(error) = write_audio_frame(&mut stdin, &session_id, frame) {
                send_failure = Some(format!("audio frame {index}: {error}"));
                break;
            }
        }
    }
    if send_failure.is_none()
        && let Err(error) = write_command_frame(
            &mut stdin,
            &serde_json::json!({ "type": "stop_session", "sessionId": session_id }),
        )
    {
        send_failure = Some(format!("stop_session: {error}"));
    }
    if send_failure.is_none()
        && let Err(error) = stdin.flush()
    {
        send_failure = Some(format!("flush: {error}"));
    }

    if send_failure.is_none() {
        let deadline = Instant::now() + DRIVE_TIMEOUT;
        while !outcome.stopped && Instant::now() < deadline {
            match event_rx.recv_timeout(POLL_INTERVAL) {
                Ok(event) => apply_json_event(&mut stdin, &event, &mut outcome),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    let _ = write_command_frame(&mut stdin, &serde_json::json!({ "type": "shutdown" }));
    stdin.flush().ok();
    drop(stdin);
    let _ = reader.join();
    let fate = reap(&mut child, Duration::from_secs(10));
    let _ = stderr_collector.join();

    // Report the child's fate through the outcome rather than a panic, so
    // scoring stays the single judge of a run while still explaining *why* a
    // transcript came back empty. `describe_exit` names the signal, which is
    // the only trace a native crash leaves.
    if send_failure.is_some() || (!fate.is_clean_exit() && !outcome.stopped) {
        let fate = fate.describe();
        let stderr = captured_stderr.snapshot();
        let stderr = if stderr.trim().is_empty() {
            "<child printed nothing to stderr>".to_string()
        } else {
            stderr
        };
        let while_sending = send_failure
            .map(|failure| format!(" while sending {failure}"))
            .unwrap_or_default();
        outcome.errors.push(format!(
            "sidecar {fate}{while_sending}\n--- child stderr ---\n{stderr}--- end child stderr ---"
        ));
    }

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
                // A write failure here means the child is gone; the drive loop
                // ends on the resulting stdout disconnect and the caller reports
                // the child's fate.
                let _ = write_command_frame(
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

fn write_frame(writer: &mut impl Write, kind: u8, payload: &[u8]) -> std::io::Result<()> {
    let len = u32::try_from(payload.len()).expect("frame payload fits in u32");
    let mut header = [0_u8; FRAME_HEADER_LEN];
    header[0] = kind;
    header[1..].copy_from_slice(&len.to_le_bytes());
    writer.write_all(&header)?;
    writer.write_all(payload)
}

pub fn write_command_frame(
    writer: &mut impl Write,
    command: &serde_json::Value,
) -> std::io::Result<()> {
    let payload = serde_json::to_vec(command).expect("serialize command");
    write_frame(writer, JSON_FRAME_KIND, &payload)
}

fn write_audio_frame(
    writer: &mut impl Write,
    session_id: &str,
    frame_bytes: &[u8],
) -> std::io::Result<()> {
    let envelope =
        encode_audio_frame_envelope(session_id, frame_bytes).expect("audio frame should encode");
    write_frame(writer, AUDIO_FRAME_KIND, &envelope)
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

/// Everything the child wrote to stderr, shared between the collector thread
/// and the driver so a failure report can quote it.
#[derive(Clone, Default)]
struct CapturedStderr(Arc<Mutex<String>>);

impl CapturedStderr {
    fn snapshot(&self) -> String {
        self.0.lock().map(|text| text.clone()).unwrap_or_default()
    }
}

/// Reads the child's stderr to completion, echoing each line so `--nocapture`
/// still shows it live while also retaining it for a failure report.
fn collect_stderr(stderr: std::process::ChildStderr, captured: CapturedStderr) {
    let reader = std::io::BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        eprintln!("[sidecar stderr] {line}");
        if let Ok(mut text) = captured.0.lock() {
            text.push_str(&line);
            text.push('\n');
        }
    }
}

/// Why the spawned sidecar is no longer running.
enum ChildFate {
    Exited(std::process::ExitStatus),
    /// Still alive at the deadline, so the parent killed it. Distinguished from
    /// `Exited` because the resulting status is the parent's own SIGKILL and
    /// says nothing about the child.
    Hung,
    Unreapable(std::io::Error),
}

impl ChildFate {
    fn is_clean_exit(&self) -> bool {
        matches!(self, Self::Exited(status) if status.success())
    }

    fn describe(&self) -> String {
        match self {
            Self::Exited(status) => describe_exit(*status),
            Self::Hung => {
                "was still running at the shutdown deadline (parent killed it)".to_string()
            }
            Self::Unreapable(error) => format!("could not be reaped: {error}"),
        }
    }
}

fn reap(child: &mut Child, timeout: Duration) -> ChildFate {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return ChildFate::Exited(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return ChildFate::Hung;
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => return ChildFate::Unreapable(error),
        }
    }
}

/// Spells out how a process ended.
///
/// A dead child surfaces in the parent only as `BrokenPipe` on the next write,
/// which says nothing about *why* it died. On Unix a native crash (SIGSEGV,
/// SIGABRT) leaves no exit code at all — only a signal, which `ExitStatus`'s
/// own `Display` renders opaquely — so the signal is named here.
fn describe_exit(status: std::process::ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            let name = match signal {
                2 => "SIGINT",
                4 => "SIGILL",
                6 => "SIGABRT",
                7 => "SIGBUS",
                8 => "SIGFPE",
                9 => "SIGKILL",
                11 => "SIGSEGV",
                13 => "SIGPIPE",
                15 => "SIGTERM",
                _ => "unknown signal",
            };
            let core = if status.core_dumped() {
                " (core dumped)"
            } else {
                ""
            };
            return format!("was killed by signal {signal} {name}{core}");
        }
    }
    match status.code() {
        Some(code) => format!("exited with code {code}"),
        None => format!("ended with status {status}"),
    }
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
