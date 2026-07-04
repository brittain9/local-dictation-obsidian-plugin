//! Sidecar-level Moonshine streaming quality suite. `#[ignore]`d: needs model
//! downloads and real inference. Run:
//! cargo test --manifest-path native/Cargo.toml --features engine-moonshine \
//!   --test streaming_e2e -- --ignored --nocapture

mod common;

use common::model::{MoonshineTier, require_moonshine_model};
use common::{audio, driver};
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::SelectedModel;

fn moonshine_selection(frontend: &std::path::Path) -> SelectedModel {
    SelectedModel::ExternalFile {
        runtime_id: RuntimeId::OnnxRuntime,
        family_id: ModelFamilyId::Moonshine,
        file_path: frontend.display().to_string(),
    }
}

#[test]
#[ignore = "needs Moonshine model + real inference; run with --ignored"]
fn streaming_emits_partials_then_a_final() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    let samples =
        audio::decode_wav_16k_mono(&common::fixtures_dir().join("audio/7021-79740-0000.wav"))
            .unwrap();
    let frames = audio::fixture_frames_with_trailing_silence(&samples);

    let outcome = driver::stream_in_process(moonshine_selection(&frontend), &frames);

    assert!(outcome.stopped, "session should stop");
    assert!(outcome.errors.is_empty(), "errors: {:?}", outcome.errors);
    assert!(
        !outcome.partials.is_empty(),
        "expected at least one partial"
    );
    assert!(
        !outcome.final_text.trim().is_empty(),
        "expected a final transcript"
    );
    let revisions: Vec<u32> = outcome
        .partials
        .iter()
        .map(|partial| partial.revision)
        .collect();
    assert!(
        revisions.windows(2).all(|pair| pair[1] > pair[0]),
        "revisions must increase: {revisions:?}"
    );
}
