//! Adapter-level streaming performance harness (Moonshine). `#[ignore]`d: needs
//! a model download + real inference. Run:
//! cargo test --manifest-path native/Cargo.toml --test streaming_perf -- --ignored --nocapture

#![cfg(feature = "engine-moonshine")]

mod common;

use std::time::Instant;

use common::model::{MoonshineTier, require_moonshine_model};
use local_dictation_sidecar::adapters::moonshine::MoonshineAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::transcription::GpuConfig;

/// 16 kHz mono. One cadence chunk matches the worker's partial cadence.
const CADENCE_SAMPLES: usize = 8_000;

/// Build about 50 seconds of continuous speech without adding an audio asset.
fn long_utterance_samples() -> Vec<i16> {
    let clips = [
        "audio/7021-79740-0000.wav",
        "audio/3575-170457-0051.wav",
        "audio/1580-141084-0047.wav",
        "audio/4446-2271-0004.wav",
        "audio/5683-32866-0024.wav",
    ];
    let mut samples = Vec::new();
    while samples.len() < 50 * 16_000 {
        for clip in clips {
            let path = common::fixtures_dir().join(clip);
            samples.extend(common::audio::decode_wav_16k_mono(&path).unwrap());
            if samples.len() >= 50 * 16_000 {
                break;
            }
        }
    }
    samples
}

#[test]
#[ignore = "needs Moonshine model + real inference; run with --ignored"]
fn partial_cost_does_not_scale_with_utterance_length() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    let mut model = MoonshineAdapter
        .load_streaming(frontend.as_path(), GpuConfig::default())
        .unwrap();

    let samples = long_utterance_samples();
    let mut per_partial_ms: Vec<u128> = Vec::new();
    let mut cumulative = 0usize;

    for chunk in samples.chunks(CADENCE_SAMPLES) {
        model.accept_audio(chunk).unwrap();
        cumulative += chunk.len();
        let started = Instant::now();
        let partial = model.partial().unwrap();
        let elapsed = started.elapsed().as_millis();
        per_partial_ms.push(elapsed);
        let tokens = partial
            .diagnostics
            .first()
            .and_then(|diagnostics| diagnostics.token_count)
            .unwrap_or(0);
        eprintln!(
            "[perf] t={:>4.1}s partial_ms={elapsed:>5} tokens={tokens}",
            cumulative as f64 / 16_000.0
        );
    }

    let mid = per_partial_ms.len() / 2;
    let avg = |slice: &[u128]| slice.iter().sum::<u128>() as f64 / slice.len().max(1) as f64;
    let first_half = avg(&per_partial_ms[..mid]);
    let second_half = avg(&per_partial_ms[mid..]);
    let ratio = second_half / first_half.max(1.0);
    eprintln!(
        "[perf] first_half_avg_ms={first_half:.1} \
         second_half_avg_ms={second_half:.1} ratio={ratio:.2}"
    );

    assert!(
        ratio < 3.0,
        "per-partial engine time scales with utterance length (ratio {ratio:.2} >= 3.0): \
         partial decode is not incremental"
    );
}
