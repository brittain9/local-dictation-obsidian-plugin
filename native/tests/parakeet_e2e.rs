//! Real-model Parakeet Unified smoke and streaming-consistency tests.
//!
//! Run with a model installed from the bundled catalog:
//! `STT_TEST_PARAKEET_DIR=/path/to/parakeet cargo test --manifest-path native/Cargo.toml \
//!   --features engine-parakeet-unified --test parakeet_e2e -- --ignored --nocapture`

mod common;

use common::manifest::Corpus;
use common::model::require_parakeet_model;
use common::text::{missing_anchors, word_error_rate};
use common::{audio, driver};
use local_dictation_sidecar::adapters::parakeet_unified::ParakeetUnifiedAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::SelectedModel;
use local_dictation_sidecar::transcription::{EngineTranscriptOutput, GpuConfig};

fn joined_text(output: &EngineTranscriptOutput) -> String {
    output
        .segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn selection(encoder: &std::path::Path) -> SelectedModel {
    SelectedModel::ExternalFile {
        runtime_id: RuntimeId::OnnxRuntime,
        family_id: ModelFamilyId::ParakeetUnified,
        file_path: encoder.display().to_string(),
    }
}

#[test]
#[ignore = "needs the 632 MiB Parakeet Unified model; run with --ignored"]
fn parakeet_runs_through_vad_worker_and_revision_protocol() {
    let encoder = require_parakeet_model();
    let fixture = Corpus::load()
        .fixtures
        .into_iter()
        .find(|fixture| fixture.id == "7021-79740-0000")
        .unwrap();
    let samples = audio::decode_wav_16k_mono(&fixture.audio_path()).unwrap();
    let frames = audio::fixture_frames_with_trailing_silence(&samples);

    let outcome = driver::stream_in_process(selection(&encoder), &frames);
    assert!(outcome.stopped, "session should stop after the final");
    assert!(outcome.errors.is_empty(), "errors: {:?}", outcome.errors);
    assert!(
        !outcome.partials.is_empty(),
        "expected live partial revisions"
    );
    assert!(
        outcome
            .partials
            .windows(2)
            .all(|pair| pair[1].revision > pair[0].revision),
        "partial revisions must be strictly increasing"
    );
    let wer = word_error_rate(&fixture.reference, &outcome.final_text);
    eprintln!(
        "Parakeet worker final: {}\nWER: {wer:.3}",
        outcome.final_text
    );
    assert!(
        wer <= fixture.max_wer,
        "WER {wer:.3} exceeded {}",
        fixture.max_wer
    );
    let missing = missing_anchors(&outcome.final_text, &fixture.anchors);
    assert!(missing.is_empty(), "missing anchor words: {missing:?}");
}

#[test]
#[ignore = "needs the 632 MiB Parakeet Unified model; run with --ignored"]
fn parakeet_streams_stable_partials_and_matches_one_shot_final() {
    let encoder = require_parakeet_model();
    let samples =
        audio::decode_wav_16k_mono(&common::fixtures_dir().join("audio/7021-79740-0000.wav"))
            .unwrap();

    let mut streaming = ParakeetUnifiedAdapter
        .load_streaming(&encoder, GpuConfig { use_gpu: false })
        .unwrap();
    let mut partials = Vec::new();
    for chunk in samples.chunks(8_000) {
        streaming.accept_audio(chunk).unwrap();
        let text = joined_text(&streaming.partial().unwrap());
        if partials.last() != Some(&text) && !text.is_empty() {
            partials.push(text);
        }
    }
    let streaming_final = streaming.finalize_utterance().unwrap();
    let final_text = joined_text(&streaming_final);
    assert!(
        joined_text(&streaming.partial().unwrap()).is_empty(),
        "finalization must reset the open utterance"
    );

    streaming.accept_audio(&samples).unwrap();
    let reused_final = streaming.finalize_utterance().unwrap();
    assert_eq!(
        streaming_final, reused_final,
        "a finalized model must be reusable for the next utterance"
    );

    let mut one_shot = ParakeetUnifiedAdapter
        .load_streaming(&encoder, GpuConfig { use_gpu: false })
        .unwrap();
    one_shot.accept_audio(&samples).unwrap();
    let one_shot_final = one_shot.finalize_utterance().unwrap();

    assert!(
        !partials.is_empty(),
        "expected at least one non-empty partial"
    );
    assert!(
        partials
            .windows(2)
            .all(|pair| pair[1].starts_with(&pair[0])),
        "Parakeet RNNT partials must preserve their committed prefix: {partials:?}"
    );
    assert_eq!(streaming_final, one_shot_final);
    let fixture = Corpus::load()
        .fixtures
        .into_iter()
        .find(|fixture| fixture.id == "7021-79740-0000")
        .unwrap();
    let wer = word_error_rate(&fixture.reference, &final_text);
    eprintln!("Parakeet final: {final_text}\nWER: {wer:.3}");
    assert!(
        wer <= fixture.max_wer,
        "WER {wer:.3} exceeded {}",
        fixture.max_wer
    );
    let missing = missing_anchors(&final_text, &fixture.anchors);
    assert!(missing.is_empty(), "missing anchor words: {missing:?}");
}

#[test]
#[ignore = "needs the 632 MiB Parakeet Unified model; run with --ignored"]
fn parakeet_silence_produces_no_text() {
    let encoder = require_parakeet_model();
    let mut model = ParakeetUnifiedAdapter
        .load_streaming(&encoder, GpuConfig { use_gpu: false })
        .unwrap();
    model.accept_audio(&vec![0_i16; 3 * 16_000]).unwrap();
    assert!(joined_text(&model.finalize_utterance().unwrap()).is_empty());
}
