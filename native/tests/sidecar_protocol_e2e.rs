//! End-to-end transcription through the real binary's stdin/stdout wire protocol.
//!
//! Where `transcription_e2e` drives the library in-process, this spawns the
//! actual compiled sidecar and speaks the length-prefixed binary frame protocol
//! the TypeScript plugin uses: a `start_session` command, audio frames, a
//! `context_response`, `stop_session`, then reads back event frames. It is the
//! faithful "full sidecar" contract guard — if framing, command/event JSON, or
//! the process loop regress, this fails even when the in-process path passes.
//!
//! `#[ignore]`d (needs the model + spawns a process). Run:
//!
//! ```sh
//! cargo test --manifest-path native/Cargo.toml --test sidecar_protocol_e2e -- --ignored --nocapture
//! ```

mod common;

use common::{audio, driver, manifest::Corpus, model, score, text};
use local_dictation_sidecar::session::SpeakingStyle;

/// Path to the freshly built sidecar binary, provided by Cargo to integration
/// tests. Spawning this exercises the exact executable end users run.
const SIDECAR_BIN: &str = env!("CARGO_BIN_EXE_local-dictation-sidecar");

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
