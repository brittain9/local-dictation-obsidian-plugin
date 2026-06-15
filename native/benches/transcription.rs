//! End-to-end transcription benchmark (Criterion).
//!
//! Measures the cost of transcribing a fixture clip through the full in-process
//! pipeline. This establishes the performance arm of the sidecar quality suite;
//! pair it with the accuracy suite in `tests/transcription_e2e.rs`.
//!
//! It reuses the same harness as the tests (via a `#[path]` include) so audio
//! handling, model acquisition, and the driver stay DRY. When no whisper model
//! is available (e.g. offline), the benchmark skips cleanly rather than failing —
//! it is opt-in infrastructure, not a gate.
//!
//! Run with: `cargo bench --manifest-path native/Cargo.toml --bench transcription`

use std::time::Duration;

use criterion::{Criterion, criterion_group, criterion_main};

#[path = "../tests/common/mod.rs"]
mod common;

use common::{audio, driver, manifest::Corpus, model};
use local_dictation_sidecar::session::SpeakingStyle;

fn transcription_benchmark(criterion: &mut Criterion) {
    let model_path = match model::resolve_whisper_model() {
        Ok(path) => path,
        Err(reason) => {
            eprintln!("skipping transcription benchmark (no model): {reason}");
            return;
        }
    };

    let corpus = Corpus::load();
    let fixture = corpus
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "jfk")
        .expect("corpus must contain the 'jfk' fixture");
    let samples = audio::decode_wav_16k_mono(&fixture.audio_path()).expect("decode jfk fixture");
    let frames = audio::fixture_frames_with_trailing_silence(&samples);

    // Warm up once: surfaces a broken pipeline before measuring, and primes
    // any OS-level file cache for the model.
    let warmup = driver::transcribe_in_process(&model_path, &frames, SpeakingStyle::Patient);
    assert!(
        warmup.stopped && !warmup.text.trim().is_empty(),
        "benchmark warmup produced no transcript; refusing to report meaningless timings"
    );

    // Each iteration is a full cold session: build state, load the model, run
    // VAD + inference to completion. Sample size and time are tuned for a
    // multi-second-per-iteration workload.
    let mut group = criterion.benchmark_group("transcription");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(60));
    group.bench_function("jfk_cold_session", |bencher| {
        bencher
            .iter(|| driver::transcribe_in_process(&model_path, &frames, SpeakingStyle::Patient));
    });
    group.finish();
}

criterion_group!(benches, transcription_benchmark);
criterion_main!(benches);
