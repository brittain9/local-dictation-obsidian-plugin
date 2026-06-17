//! End-to-end transcription accuracy suite (in-process).
//!
//! Runs every fixture in the reference corpus through the full in-process
//! pipeline — VAD, worker thread, and real whisper inference — and asserts the
//! output against the corpus's per-fixture quality budget (Word Error Rate and
//! must-appear anchor words). This is the quality gate the user described:
//! known audio in, known text expected.
//!
//! `#[ignore]`d because it needs a whisper model and is comparatively slow. Run:
//!
//! ```sh
//! cargo test --manifest-path native/Cargo.toml --test transcription_e2e -- --ignored --nocapture
//! ```

mod common;

use common::{audio, driver, manifest::Corpus, model, score, text};
use local_dictation_sidecar::session::SpeakingStyle;

/// Samples per millisecond at the sidecar's 16 kHz rate (16000 / 1000).
const SAMPLES_PER_MS: usize = 16;

#[test]
#[ignore = "needs a whisper model + real inference; run with --ignored"]
fn every_fixture_transcribes_within_quality_budget() {
    let model_path = model::require_whisper_model();
    let corpus = Corpus::load();
    assert!(
        !corpus.fixtures.is_empty(),
        "the reference corpus must declare at least one fixture"
    );

    let mut failures = Vec::new();

    for fixture in &corpus.fixtures {
        let samples = audio::decode_wav_16k_mono(&fixture.audio_path())
            .unwrap_or_else(|error| panic!("decoding fixture {}: {error}", fixture.id));
        let frames = audio::fixture_frames_with_trailing_silence(&samples);

        let outcome = driver::transcribe_in_process(&model_path, &frames, SpeakingStyle::Patient);

        let wer = text::word_error_rate(&fixture.reference, &outcome.text);
        let audio_ms = (samples.len() / SAMPLES_PER_MS).max(1) as f64;
        let real_time_factor = outcome.processing_ms as f64 / audio_ms;

        eprintln!(
            "[{}] wer={:.3} (budget {:.3}) rtf={:.2} utterances={} stopped={}\n    ref: {}\n    got: {}",
            fixture.id,
            wer,
            fixture.max_wer,
            real_time_factor,
            outcome.utterance_count,
            outcome.stopped,
            fixture.reference,
            outcome.text,
        );

        failures.extend(score::budget_failures(fixture, &outcome));
    }

    assert!(
        failures.is_empty(),
        "transcription quality failures:\n  {}",
        failures.join("\n  ")
    );
}
