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

use std::hint::black_box;
use std::time::Duration;

use criterion::{Criterion, criterion_group, criterion_main};

#[path = "../tests/common/mod.rs"]
mod common;

#[cfg(feature = "engine-whisper")]
use common::driver;
#[cfg(feature = "engine-nemotron-asr")]
use common::text::joined_text;
use common::{audio, manifest::Corpus, model};
#[cfg(feature = "engine-nemotron-asr")]
use local_dictation_sidecar::adapters::nemotron_asr::NemotronAsrAdapter;
#[cfg(feature = "engine-nemotron-asr")]
use local_dictation_sidecar::engine::traits::{ModelFamilyAdapter, StreamingModel};
#[cfg(feature = "engine-whisper")]
use local_dictation_sidecar::session::SpeakingStyle;
#[cfg(feature = "engine-nemotron-asr")]
use local_dictation_sidecar::transcription::{EngineTranscriptOutput, GpuConfig};

#[cfg(feature = "engine-whisper")]
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

#[cfg(feature = "engine-nemotron-asr")]
fn nemotron_benchmark(criterion: &mut Criterion) {
    let model_path = match model::resolve_nemotron_model() {
        Ok(path) => path,
        Err(reason) => {
            eprintln!("skipping Nemotron benchmark (no model): {reason}");
            return;
        }
    };
    let fixture = Corpus::load()
        .fixtures
        .into_iter()
        .find(|fixture| fixture.id == "7021-79740-0000")
        .expect("corpus must contain the pinned Nemotron fixture");
    let samples =
        audio::decode_wav_16k_mono(&fixture.audio_path()).expect("decode pinned Nemotron fixture");
    let mut model = NemotronAsrAdapter
        .load_streaming(&model_path, GpuConfig { use_gpu: false })
        .expect("load pinned Nemotron model");

    let warmup = transcribe_nemotron(model.as_mut(), &samples);
    let warmup_text = joined_text(&warmup);
    let warmup_wer = common::text::word_error_rate(&fixture.reference, &warmup_text);
    assert!(
        warmup_wer <= 0.10,
        "benchmark warmup WER {warmup_wer:.3} exceeded the cross-platform quality gate"
    );

    let mut group = criterion.benchmark_group("nemotron_asr");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));
    group.bench_function("librispeech_warm_streaming", |bencher| {
        bencher.iter(|| black_box(transcribe_nemotron(model.as_mut(), black_box(&samples))));
    });
    group.finish();
}

#[cfg(feature = "engine-nemotron-asr")]
fn transcribe_nemotron(model: &mut dyn StreamingModel, samples: &[i16]) -> EngineTranscriptOutput {
    for chunk in samples.chunks(8_000) {
        model.accept_audio(chunk).expect("accept benchmark audio");
        black_box(model.partial().expect("decode benchmark partial"));
    }
    model
        .finalize_utterance()
        .expect("finalize benchmark utterance")
}

fn all_benchmarks(criterion: &mut Criterion) {
    #[cfg(feature = "engine-whisper")]
    transcription_benchmark(criterion);
    #[cfg(feature = "engine-nemotron-asr")]
    nemotron_benchmark(criterion);
}

criterion_group!(benches, all_benchmarks);
criterion_main!(benches);
