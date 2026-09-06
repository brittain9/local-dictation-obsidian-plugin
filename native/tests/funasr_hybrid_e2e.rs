//! Real-model acceptance test for Chinese live dictation.
//!
//! This verifies the product's important distinction: Paraformer may provide
//! provisional streaming text, but the committed utterance is replaced by the
//! higher-quality full-utterance SenseVoiceSmall output.

mod common;

use common::model::require_funasr_hybrid_model;
use common::{audio, driver, fixtures_dir};
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::SelectedModel;

const EXPECTED_FINAL: &str = "我觉得这毫无道理，显然不公平。";

fn selection(encoder: &std::path::Path) -> SelectedModel {
    SelectedModel::ExternalFile {
        runtime_id: RuntimeId::FunasrLlamaCpp,
        family_id: ModelFamilyId::FunasrHybrid,
        file_path: encoder.display().to_string(),
    }
}

#[test]
#[ignore = "needs the 470 MiB pinned FunASR hybrid model and Linux helper"]
fn chinese_streaming_draft_is_replaced_by_sensevoice_final() {
    let encoder = require_funasr_hybrid_model();
    let fixture = fixtures_dir().join("audio/zh-fleurs-1577.wav");
    let samples = audio::decode_wav_16k_mono(&fixture)
        .unwrap_or_else(|error| panic!("decoding {}: {error}", fixture.display()));
    let frames = audio::fixture_frames_with_trailing_silence(&samples);

    let outcome = driver::stream_in_process_language(selection(&encoder), &frames, "zh");

    assert!(outcome.stopped, "session should stop after finalization");
    assert!(outcome.errors.is_empty(), "errors: {:?}", outcome.errors);
    assert!(
        !outcome.partials.is_empty(),
        "expected Paraformer to emit at least one provisional revision"
    );
    let final_revision = outcome
        .final_revision
        .expect("SenseVoice must publish a final revision");
    assert!(
        final_revision > outcome.partials.last().unwrap().revision,
        "final revision must replace the most recent provisional revision"
    );
    assert_eq!(outcome.final_text, EXPECTED_FINAL);
    assert!(
        outcome.final_text.contains('，') && outcome.final_text.ends_with('。'),
        "SenseVoice final should retain Chinese punctuation: {}",
        outcome.final_text
    );
}
