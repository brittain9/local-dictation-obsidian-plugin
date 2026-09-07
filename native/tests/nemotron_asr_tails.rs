//! Regression coverage for arbitrary VAD utterance lengths: every finalize
//! tail size must stream without graph-shape rejections and the model must
//! stay reusable afterwards.

mod common;

use common::model::require_nemotron_model;
use local_dictation_sidecar::adapters::nemotron_asr::NemotronAsrAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::transcription::GpuConfig;

const FRAME_SHIFT_SAMPLES: usize = 160;

#[test]
#[ignore = "needs the 651 MiB pinned Nemotron 3.5 ASR export"]
fn every_finalize_tail_length_streams_without_shape_errors() {
    let encoder = require_nemotron_model();
    let mut model = NemotronAsrAdapter
        .load_streaming(&encoder, GpuConfig::default())
        .unwrap();

    // 1..=130 feature frames covers sub-window utterances, both sides of the
    // 56-frame chunk shift, the 56..=64 double-decode finalize range, and
    // multi-chunk utterances. Low-level noise keeps VAD-realistic energy.
    let mut failures = Vec::new();
    for frames in 1..=130 {
        let samples: Vec<i16> = (0..frames * FRAME_SHIFT_SAMPLES)
            .map(|index| ((index % 13) as i16 - 6) * 8)
            .collect();
        model.accept_audio(&samples).unwrap();
        if let Err(error) = model.finalize_utterance() {
            failures.push(format!(
                "{frames} frames: {} {}",
                error.message,
                error.details.clone().unwrap_or_default()
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "finalize failed for {} tail lengths:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
