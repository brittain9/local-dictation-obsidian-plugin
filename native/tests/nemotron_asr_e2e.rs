//! Real-model Nemotron 3.5 ASR streaming and worker-path acceptance tests.
//!
//! Run with the pinned export from the bundled catalog:
//! `STT_TEST_NEMOTRON_DIR=/path/to/model cargo test --manifest-path native/Cargo.toml \
//!   --no-default-features --features engine-nemotron-asr --test nemotron_asr_e2e \
//!   -- --ignored --nocapture`

mod common;

use common::manifest::Corpus;
use common::model::require_nemotron_model;
use common::quality_report::{self, QualityMeasurement};
use common::text::{joined_text, missing_anchors, word_error_rate};
use common::{audio, driver};
use local_dictation_sidecar::adapters::nemotron_asr::NemotronAsrAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::SelectedModel;
use local_dictation_sidecar::transcription::GpuConfig;

fn selection(encoder: &std::path::Path) -> SelectedModel {
    SelectedModel::ExternalFile {
        runtime_id: RuntimeId::OnnxRuntime,
        family_id: ModelFamilyId::NemotronAsr,
        file_path: encoder.display().to_string(),
    }
}

fn libri_fixture() -> common::manifest::Fixture {
    Corpus::load()
        .fixtures
        .into_iter()
        .find(|fixture| fixture.id == "7021-79740-0000")
        .unwrap()
}

/// Tight quality budgets for the pinned int8 export, far below the corpus-wide
/// `max_wer`. The int8 runtime legitimately differs from the float32 NeMo
/// oracle at token level (measured at pinning: one word, "in habits" vs
/// "inhabits", direct WER 0.000 against the LibriSpeech reference and 0.08
/// against the oracle), so exact golden-text equality is not a valid gate;
/// these budgets catch quantization, frontend, or runtime drift instead.
const DIRECT_DECODE_MAX_WER: f64 = 0.10;
const ORACLE_DRIFT_MAX_WER: f64 = 0.15;
// The pinned M2 Pro worker-path result is 0.115. Keep a narrow 0.12 gate so
// the documented known-good result passes without weakening the 0.10 direct
// decoder or 0.15 oracle-drift gates.
const WORKER_MAX_WER: f64 = 0.12;
const WORKER_MAX_REAL_TIME_FACTOR: f64 = 1.0;
// Driver-reported utterance duration includes the bounded 300 ms VAD pre-roll.
// Preserve the 2 s useful-speech budget while accounting for retained context.
const WORKER_MAX_FIRST_PARTIAL_AUDIO_MS: u64 = 2_300;

fn pinned_oracle_text() -> String {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/nemotron/golden-560ms.json");
    let golden: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    golden["streaming"]["text"].as_str().unwrap().to_string()
}

#[test]
#[ignore = "needs the 651 MiB pinned Nemotron 3.5 ASR export"]
fn nemotron_runs_through_vad_worker_and_revision_protocol() {
    let encoder = require_nemotron_model();
    let fixture = libri_fixture();
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
        outcome.partials[0].utterance_duration_ms <= WORKER_MAX_FIRST_PARTIAL_AUDIO_MS,
        "first useful partial arrived after {} ms of audio, exceeding the {} ms budget (2 s speech + 300 ms onset pre-roll)",
        outcome.partials[0].utterance_duration_ms,
        WORKER_MAX_FIRST_PARTIAL_AUDIO_MS
    );
    assert!(
        outcome
            .partials
            .windows(2)
            .all(|pair| pair[1].revision > pair[0].revision),
        "partial revisions must be strictly increasing"
    );
    assert!(
        outcome
            .partials
            .windows(2)
            .all(|pair| pair[1].text.starts_with(&pair[0].text)),
        "worker-published partials must preserve their committed prefix: {:?}",
        outcome.partials
    );
    let final_revision = outcome
        .final_revision
        .expect("worker path must publish a final revision");
    assert!(
        final_revision > outcome.partials.last().unwrap().revision,
        "final revision {final_revision} must follow the last partial revision {}",
        outcome.partials.last().unwrap().revision
    );
    assert!(
        outcome
            .partials
            .last()
            .is_some_and(|partial| outcome.final_text.starts_with(&partial.text)),
        "worker final must preserve the last committed partial: {:?} -> {:?}",
        outcome.partials.last(),
        outcome.final_text
    );
    let wer = word_error_rate(&fixture.reference, &outcome.final_text);
    eprintln!(
        "Nemotron worker final: {}\nWER: {wer:.3}",
        outcome.final_text
    );
    assert!(
        outcome.final_text.starts_with("To such persons"),
        "Nemotron worker path clipped the fixture's opening words: {}",
        outcome.final_text,
    );
    assert!(
        wer <= WORKER_MAX_WER,
        "WER {wer:.3} exceeded the Nemotron worker-path budget {WORKER_MAX_WER}",
    );
    let missing = missing_anchors(&outcome.final_text, &fixture.anchors);
    assert!(missing.is_empty(), "missing anchor words: {missing:?}");

    let audio_duration_ms = (samples.len() as u64 * 1_000) / 16_000;
    let real_time_factor = outcome.processing_ms as f64 / audio_duration_ms.max(1) as f64;
    assert!(
        real_time_factor <= WORKER_MAX_REAL_TIME_FACTOR,
        "worker RTF {real_time_factor:.3} exceeded {WORKER_MAX_REAL_TIME_FACTOR:.3}",
    );
    quality_report::record(&QualityMeasurement {
        suite: "nemotron-streaming-product-path",
        model_id: common::model::NEMOTRON_MODEL_ID,
        model_name: "NVIDIA Nemotron 3.5 ASR Streaming 0.6B Int8",
        language: "en",
        selection: "manual",
        fixture_id: &fixture.id,
        quality_metric: "wer",
        quality_error_rate: wer,
        quality_budget: WORKER_MAX_WER,
        audio_duration_ms,
        processing_duration_ms: outcome.processing_ms,
        real_time_factor,
        real_time_factor_budget: WORKER_MAX_REAL_TIME_FACTOR,
        first_partial_audio_ms: outcome
            .partials
            .first()
            .map(|partial| partial.utterance_duration_ms),
        first_partial_audio_budget_ms: Some(WORKER_MAX_FIRST_PARTIAL_AUDIO_MS),
        utterance_count: None,
        partial_count: Some(outcome.partials.len()),
        passed: true,
    });
}

#[test]
#[ignore = "needs the 651 MiB pinned Nemotron 3.5 ASR export"]
fn nemotron_partials_preserve_prefix_and_final_matches_one_shot() {
    let encoder = require_nemotron_model();
    let fixture = libri_fixture();
    let samples = audio::decode_wav_16k_mono(&fixture.audio_path()).unwrap();

    let mut streaming = NemotronAsrAdapter
        .load_streaming(&encoder, GpuConfig { use_gpu: false })
        .unwrap();
    let mut partials = Vec::new();
    for chunk in samples.chunks(8_000) {
        streaming.accept_audio(chunk).unwrap();
        let text = joined_text(&streaming.partial().unwrap());
        if !text.is_empty() && partials.last() != Some(&text) {
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

    let mut one_shot = NemotronAsrAdapter
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
        "Nemotron RNNT partials must preserve their committed prefix: {partials:?}"
    );
    assert_eq!(streaming_final, one_shot_final);
    let wer = word_error_rate(&fixture.reference, &final_text);
    let oracle_wer = word_error_rate(&pinned_oracle_text(), &final_text);
    eprintln!("Nemotron final: {final_text}\nWER: {wer:.3}, oracle WER: {oracle_wer:.3}");
    assert!(
        wer <= DIRECT_DECODE_MAX_WER,
        "WER {wer:.3} exceeded the pinned-export budget {DIRECT_DECODE_MAX_WER}"
    );
    assert!(
        oracle_wer <= ORACLE_DRIFT_MAX_WER,
        "drift from the pinned NeMo oracle: WER {oracle_wer:.3} exceeded {ORACLE_DRIFT_MAX_WER}"
    );
    let missing = missing_anchors(&final_text, &fixture.anchors);
    assert!(missing.is_empty(), "missing anchor words: {missing:?}");
}

#[test]
#[ignore = "needs the 651 MiB pinned Nemotron 3.5 ASR export"]
fn nemotron_silence_produces_no_text() {
    let encoder = require_nemotron_model();
    let mut model = NemotronAsrAdapter
        .load_streaming(&encoder, GpuConfig { use_gpu: false })
        .unwrap();
    model.accept_audio(&vec![0_i16; 3 * 16_000]).unwrap();
    assert!(joined_text(&model.finalize_utterance().unwrap()).is_empty());
}
