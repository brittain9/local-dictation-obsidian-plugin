//! End-to-end transcription through the real binary's stdin/stdout wire protocol.
//!
//! Where `transcription_e2e` drives the library in-process, this spawns the
//! actual compiled sidecar and speaks the length-prefixed binary frame protocol
//! the TypeScript plugin uses: a `start_session` command, audio frames, a
//! `context_response`, `stop_session`, then reads back event frames. It is the
//! faithful "full sidecar" contract guard — if framing, command/event JSON, or
//! the process loop regress, this fails even when the in-process path passes.
//!
//! The model-free `get_system_info` smoke runs in the normal suite. The real
//! transcription test is `#[ignore]`d because it needs a model. Run it with:
//!
//! ```sh
//! cargo test --manifest-path native/Cargo.toml --test sidecar_protocol_e2e -- --ignored --nocapture
//! ```

mod common;

use std::io::Write;
use std::process::{Child, Command as ProcessCommand, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use common::{audio, driver, manifest::Corpus, model, score, text};
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::Event;
use local_dictation_sidecar::session::SpeakingStyle;
use serde_json::json;

/// Path to the freshly built sidecar binary, provided by Cargo to integration
/// tests. Spawning this exercises the exact executable end users run.
const SIDECAR_BIN: &str = env!("CARGO_BIN_EXE_local-dictation-sidecar");
const SMOKE_TIMEOUT: Duration = Duration::from_secs(10);

#[test]
#[cfg(feature = "engine-whisper")]
fn get_system_info_round_trips_through_the_real_binary() {
    let mut child = ChildGuard::spawn();
    let mut stdin = child
        .child
        .stdin
        .take()
        .expect("sidecar stdin should be piped");
    let stdout = child
        .child
        .stdout
        .take()
        .expect("sidecar stdout should be piped");
    let (event_tx, event_rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut stdout = stdout;
        let _ = event_tx.send(driver::read_event_frame(&mut stdout));
    });

    driver::write_command_frame(&mut stdin, &json!({ "type": "get_system_info" }));
    stdin.flush().expect("get_system_info should flush");

    let event_json = event_rx
        .recv_timeout(SMOKE_TIMEOUT)
        .expect("sidecar should answer get_system_info before the timeout")
        .expect("sidecar should return a valid length-prefixed JSON event");
    let event: Event =
        serde_json::from_value(event_json).expect("system_info event should deserialize");
    let Event::SystemInfo {
        sidecar_version,
        compiled_runtimes,
        compiled_adapters,
        system_info,
    } = event
    else {
        panic!("expected system_info event");
    };

    assert_eq!(sidecar_version, env!("CARGO_PKG_VERSION"));
    assert!(!system_info.trim().is_empty());
    assert!(
        compiled_runtimes
            .iter()
            .any(|runtime| runtime.runtime_id == RuntimeId::WhisperCpp),
        "real binary should report the compiled whisper.cpp runtime",
    );
    let whisper = compiled_adapters
        .iter()
        .find(|adapter| {
            adapter.runtime_id == RuntimeId::WhisperCpp
                && adapter.family_id == ModelFamilyId::Whisper
        })
        .expect("real binary should report the compiled Whisper adapter");
    assert!(
        whisper.family_capabilities.supports_word_timestamps,
        "real Whisper adapter should advertise word timing",
    );

    driver::write_command_frame(&mut stdin, &json!({ "type": "shutdown" }));
    stdin.flush().expect("shutdown should flush");
    drop(stdin);

    let status = driver::wait_with_timeout(&mut child.child, SMOKE_TIMEOUT)
        .expect("sidecar should exit after shutdown before the timeout");
    assert!(status.success(), "sidecar exited unsuccessfully: {status}");
    reader.join().expect("event reader should not panic");
}

#[test]
#[ignore = "spawns the built binary + real inference; run with --ignored"]
fn jfk_transcribes_through_the_wire_protocol() {
    let model_path = model::require_whisper_model();
    let corpus = Corpus::load();
    let fixture = corpus
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "jfk")
        .expect("corpus must contain the 'jfk' fixture");

    let samples = audio::decode_wav_16k_mono(&fixture.audio_path())
        .unwrap_or_else(|error| panic!("decoding fixture {}: {error}", fixture.id));
    let frames = audio::fixture_frames_with_trailing_silence(&samples);

    let outcome =
        driver::transcribe_via_process(SIDECAR_BIN, &model_path, &frames, SpeakingStyle::Patient);

    let wer = text::word_error_rate(&fixture.reference, &outcome.text);
    eprintln!(
        "[wire jfk] wer={:.3} (budget {:.3}) stopped={} utterances={}\n    got: {}",
        wer, fixture.max_wer, outcome.stopped, outcome.utterance_count, outcome.text,
    );

    let failures = score::budget_failures(fixture, &outcome);
    assert!(
        failures.is_empty(),
        "transcription over the wire did not meet budget:\n  {}\n  got: {}",
        failures.join("\n  "),
        outcome.text,
    );
}

struct ChildGuard {
    child: Child,
}

impl ChildGuard {
    fn spawn() -> Self {
        let child = ProcessCommand::new(SIDECAR_BIN)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|error| panic!("failed to spawn sidecar {SIDECAR_BIN}: {error}"));
        Self { child }
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}
