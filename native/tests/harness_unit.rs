//! Fast, hermetic unit tests for the e2e harness itself and the fixture corpus.
//!
//! These need no whisper model and no inference, so they are NOT `#[ignore]`d —
//! they run in the normal `cargo test` / CI path and guard the scoring logic and
//! the committed fixtures (format + integrity) that the heavier suites rely on.

mod common;

use common::{audio, manifest::Corpus, model, text};
use local_dictation_sidecar::protocol::{PCM_BYTES_PER_FRAME, PCM_SAMPLES_PER_FRAME};

#[test]
fn normalize_lowercases_and_strips_punctuation() {
    assert_eq!(
        text::normalize("Hello, World!  It's   fine."),
        vec!["hello", "world", "it", "s", "fine"]
    );
}

#[test]
fn scoring_preserves_unicode_and_supports_unspaced_scripts() {
    assert_eq!(
        text::normalize("Tecnología y privacidad."),
        vec!["tecnología", "y", "privacidad"]
    );
    assert_eq!(text::character_error_rate("音声認識。", "音声認識"), 0.0);
    assert!((text::character_error_rate("音声認識", "音声翻訳") - 0.5).abs() < 1e-9);
}

#[test]
fn word_error_rate_scores_edits_against_reference_length() {
    assert_eq!(text::word_error_rate("a b c", "a b c"), 0.0);
    // One substitution out of three reference words.
    assert!((text::word_error_rate("a b c", "a x c") - 1.0 / 3.0).abs() < 1e-9);
    // Punctuation/case are normalized away before scoring.
    assert_eq!(text::word_error_rate("Hello, world.", "hello world"), 0.0);
}

#[test]
fn word_error_rate_handles_empty_reference() {
    assert_eq!(text::word_error_rate("", ""), 0.0);
    assert_eq!(text::word_error_rate("", "unexpected"), 1.0);
    assert_eq!(text::word_error_rate("expected", ""), 1.0);
}

#[test]
fn missing_anchors_reports_only_absent_words() {
    let anchors = vec!["country".to_string(), "moon".to_string()];
    let missing = text::missing_anchors("ask what you can do for your Country", &anchors);
    assert_eq!(missing, vec!["moon".to_string()]);
}

#[test]
fn corpus_loads_with_at_least_one_fixture() {
    let corpus = Corpus::load();
    assert!(
        !corpus.fixtures.is_empty(),
        "the reference corpus must declare at least one fixture"
    );
}

#[test]
fn every_fixture_matches_its_declared_format_and_hash() {
    let corpus = Corpus::load();

    for fixture in &corpus.fixtures {
        let path = fixture.audio_path();

        // Declared format must be the sidecar's native PCM format.
        assert_eq!(
            (
                fixture.format.sample_rate_hz,
                fixture.format.channels,
                fixture.format.bits_per_sample
            ),
            (16_000, 1, 16),
            "fixture {} declares a non-native format",
            fixture.id
        );

        // The committed bytes must match the manifest's recorded sha256.
        let digest = model::file_sha256(&path)
            .unwrap_or_else(|error| panic!("hashing fixture {}: {error}", fixture.id));
        assert!(
            digest.eq_ignore_ascii_case(&fixture.source.sha256),
            "fixture {} sha256 drifted from the manifest (got {digest})",
            fixture.id
        );

        // And it must actually decode as 16 kHz mono 16-bit PCM with content.
        let samples = audio::decode_wav_16k_mono(&path)
            .unwrap_or_else(|error| panic!("decoding fixture {}: {error}", fixture.id));
        assert!(
            !samples.is_empty(),
            "fixture {} decoded to zero samples",
            fixture.id
        );
    }
}

#[test]
fn framing_emits_full_fixed_size_frames() {
    let corpus = Corpus::load();
    let fixture = &corpus.fixtures[0];
    let samples = audio::decode_wav_16k_mono(&fixture.audio_path())
        .unwrap_or_else(|error| panic!("decoding fixture {}: {error}", fixture.id));

    let frames = audio::samples_to_frames(&samples);
    assert_eq!(frames.len(), samples.len().div_ceil(PCM_SAMPLES_PER_FRAME));
    assert!(
        frames
            .iter()
            .all(|frame| frame.len() == PCM_BYTES_PER_FRAME),
        "every emitted frame must be exactly {PCM_BYTES_PER_FRAME} bytes"
    );
}
