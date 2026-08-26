//! Sidecar-level Moonshine streaming quality suite. `#[ignore]`d: needs model
//! downloads and real inference. Run:
//! cargo test --manifest-path native/Cargo.toml --features engine-moonshine \
//!   --test streaming_e2e -- --ignored --nocapture

mod common;

use std::collections::HashSet;

use common::manifest::Corpus;
use common::model::{MoonshineTier, require_moonshine_model};
use common::text::{missing_anchors, word_error_rate};
use common::{audio, driver};
#[cfg(feature = "engine-moonshine")]
use local_dictation_sidecar::adapters::moonshine::MoonshineAdapter;
#[cfg(feature = "engine-moonshine")]
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::SelectedModel;
#[cfg(feature = "engine-moonshine")]
use local_dictation_sidecar::transcription::GpuConfig;

const MAX_PARTIAL_BACKTRACK_WORDS: usize = 12;

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

#[test]
fn streaming_budgets_cover_the_corpus() {
    let corpus_ids: HashSet<String> = Corpus::load()
        .fixtures
        .into_iter()
        .map(|fixture| fixture.id)
        .collect();
    let budgets = common::StreamingBudgets::load();
    let budget_ids: HashSet<String> = budgets
        .fixtures
        .iter()
        .map(|fixture| fixture.id.clone())
        .collect();

    assert_eq!(budget_ids, corpus_ids);
    for (tier, budget) in &budgets.tiers {
        assert!(
            (0.0..1.0).contains(&budget.default_max_wer),
            "{tier} default WER must be non-vacuous"
        );
    }
}

fn tier_key(tier: MoonshineTier) -> &'static str {
    match tier {
        MoonshineTier::Tiny => "tiny",
        MoonshineTier::Small => "small",
    }
}

fn partial_stability_failures(
    fixture_id: &str,
    partials: &[driver::StreamingRevision],
) -> Vec<String> {
    let mut failures = Vec::new();
    for pair in partials.windows(2) {
        let earlier: Vec<&str> = pair[0].text.split_whitespace().collect();
        let later: Vec<&str> = pair[1].text.split_whitespace().collect();
        let committed = earlier.len().saturating_sub(MAX_PARTIAL_BACKTRACK_WORDS);
        if later.len() < committed || earlier[..committed] != later[..committed] {
            failures.push(format!(
                "{fixture_id}: partial revision {} changed committed prefix at revision {}",
                pair[0].revision, pair[1].revision
            ));
        }
    }
    failures
}

fn run_quality_for_tier(tier: MoonshineTier) {
    let frontend = require_moonshine_model(tier);
    let corpus = Corpus::load();
    let budgets = common::StreamingBudgets::load();
    let tier_key = tier_key(tier);
    let mut failures = Vec::new();

    for fixture in &corpus.fixtures {
        let samples = audio::decode_wav_16k_mono(&fixture.audio_path()).unwrap();
        let frames = audio::fixture_frames_with_trailing_silence(&samples);
        let outcome = driver::stream_in_process(moonshine_selection(&frontend), &frames);
        let max_wer = budgets.max_wer(tier_key, &fixture.id);
        let wer = word_error_rate(&fixture.reference, &outcome.final_text);
        eprintln!(
            "[{tier:?}][{}] wer={wer:.3} (budget {max_wer:.3})\n  ref: {}\n  got: {}",
            fixture.id, fixture.reference, outcome.final_text
        );

        if !outcome.stopped {
            failures.push(format!("{}: session did not stop", fixture.id));
        }
        if !outcome.errors.is_empty() {
            failures.push(format!("{}: errors: {:?}", fixture.id, outcome.errors));
        }
        if outcome.final_text.trim().is_empty() {
            failures.push(format!("{}: empty final transcript", fixture.id));
        }
        if wer > max_wer {
            failures.push(format!(
                "{}: WER {wer:.3} exceeded {max_wer:.3}",
                fixture.id
            ));
        }
        let missing = missing_anchors(&outcome.final_text, &budgets.fixture(&fixture.id).anchors);
        if !missing.is_empty() {
            failures.push(format!("{}: missing anchors {missing:?}", fixture.id));
        }
        failures.extend(partial_stability_failures(&fixture.id, &outcome.partials));
    }

    assert!(
        failures.is_empty(),
        "streaming quality failures:\n  {}",
        failures.join("\n  ")
    );
}

#[test]
#[ignore = "needs Moonshine tiny model; run with --ignored"]
fn streaming_quality_tiny_within_budget() {
    run_quality_for_tier(MoonshineTier::Tiny);
}

#[test]
#[ignore = "needs Moonshine small model; run with --ignored"]
fn streaming_quality_small_within_budget() {
    run_quality_for_tier(MoonshineTier::Small);
}

#[cfg(feature = "engine-moonshine")]
#[test]
#[ignore = "needs Moonshine tiny model; run with --ignored"]
fn streaming_final_equals_one_shot_across_corpus_and_reaches_eos() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);

    for fixture in &Corpus::load().fixtures {
        let samples = audio::decode_wav_16k_mono(&fixture.audio_path()).unwrap();
        let mut chunked = MoonshineAdapter
            .load_streaming(frontend.as_path(), GpuConfig { use_gpu: false })
            .unwrap();
        for chunk in samples.chunks(8_000) {
            chunked.accept_audio(chunk).unwrap();
            chunked.partial().unwrap();
        }
        let chunked_final = chunked.finalize_utterance().unwrap();

        let mut one_shot = MoonshineAdapter
            .load_streaming(frontend.as_path(), GpuConfig { use_gpu: false })
            .unwrap();
        one_shot.accept_audio(&samples).unwrap();
        let one_shot_final = one_shot.finalize_utterance().unwrap();

        assert_eq!(
            chunked_final, one_shot_final,
            "final output changed after partials for fixture {}",
            fixture.id
        );
        assert_eq!(
            chunked_final
                .diagnostics
                .first()
                .and_then(|diagnostics| diagnostics.decode_reached_eos),
            Some(true),
            "final decode did not reach EOS for fixture {}",
            fixture.id
        );
    }
}

#[test]
#[ignore = "needs Moonshine tiny model; run with --ignored"]
fn streaming_silence_produces_no_transcript() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    let silence = vec![0_i16; 16_000 * 3];
    let outcome = driver::stream_in_process(
        moonshine_selection(&frontend),
        &audio::fixture_frames_with_trailing_silence(&silence),
    );
    assert!(outcome.errors.is_empty(), "errors: {:?}", outcome.errors);
    assert!(
        outcome.final_text.trim().is_empty(),
        "silence hallucinated: {:?}",
        outcome.final_text
    );
}
