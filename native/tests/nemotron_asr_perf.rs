//! Opt-in single-process Nemotron Stage A wall-time/RSS benchmark target.
//!
//! Build this test in release mode, then run the test executable directly
//! under the platform RSS tool so Cargo's own memory is excluded.

mod common;

use std::time::Instant;

use common::manifest::Corpus;
use common::model::require_nemotron_model;
use common::text::word_error_rate;
use local_dictation_sidecar::adapters::nemotron_asr::NemotronAsrAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::transcription::GpuConfig;

#[test]
#[ignore = "needs the 651 MiB pinned Nemotron 3.5 ASR export"]
fn nemotron_load_and_transcribe_librispeech_fixture() {
    let encoder = require_nemotron_model();
    let fixture = Corpus::load()
        .fixtures
        .into_iter()
        .find(|fixture| fixture.id == "7021-79740-0000")
        .unwrap();
    let samples = common::audio::decode_wav_16k_mono(&fixture.audio_path()).unwrap();

    let started = Instant::now();
    let mut model = NemotronAsrAdapter
        .load_streaming(&encoder, GpuConfig { use_gpu: false })
        .unwrap();
    model.accept_audio(&samples).unwrap();
    let output = model.finalize_utterance().unwrap();
    let wall = started.elapsed();
    let text = output
        .segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let wer = word_error_rate(&fixture.reference, &text);

    eprintln!("Nemotron load+transcribe wall: {wall:?}\nWER: {wer:.3}\n{text}");
    assert!(
        wer <= fixture.max_wer,
        "WER {wer:.3} exceeded {}",
        fixture.max_wer
    );
}
