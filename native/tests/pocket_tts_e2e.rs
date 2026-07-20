#![cfg(feature = "engine-pocket-tts")]

mod common;

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use local_dictation_sidecar::adapters::pocket_tts::PocketTtsAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::engine::{EngineRegistry, ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::{Event, SourceRange, SynthesisTextChunk};
use local_dictation_sidecar::synthesis::{SynthesisCancellation, time_stretch};
use local_dictation_sidecar::synthesis_worker::{StartSynthesis, SynthesisWorker};
use serde::Serialize;

#[test]
#[ignore = "downloads the pinned Pocket TTS model"]
fn pinned_english_model_synthesizes_non_silent_pcm() {
    let model_path = common::model::require_pocket_tts_model();
    let model_dir = model_path
        .parent()
        .expect("model path should have a parent")
        .to_path_buf();
    let first = "Local speech keeps every word.";
    let second = "On this computer.";
    let source = format!("{first} {second}");
    let first_end = u32::try_from(first.len()).expect("fixture length should fit u32");
    let source_end = u32::try_from(source.len()).expect("fixture length should fit u32");
    let expected_ranges = [
        SourceRange {
            from: 0,
            to: first_end,
        },
        SourceRange {
            from: first_end + 1,
            to: source_end,
        },
    ];
    let mut worker = SynthesisWorker::spawn(Arc::new(EngineRegistry::build()));
    let started_at = Instant::now();
    worker
        .start(StartSynthesis {
            synthesis_id: 1,
            runtime_id: RuntimeId::OnnxRuntime,
            family_id: ModelFamilyId::PocketTts,
            model_path,
            voice_path: model_dir.join("embeddings/alba.safetensors"),
            speed: 1.0,
            chunks: vec![
                SynthesisTextChunk {
                    text: first.to_string(),
                    source_range: expected_ranges[0],
                },
                SynthesisTextChunk {
                    text: second.to_string(),
                    source_range: expected_ranges[1],
                },
            ],
            cancellation: SynthesisCancellation::new(),
        })
        .expect("Pocket TTS worker should start");

    let deadline = Instant::now() + Duration::from_secs(30);
    let mut sample_rate = None;
    let mut metadata = Vec::new();
    let mut audio_sequences = Vec::new();
    let mut first_audio_latency = None;
    let mut non_silent = false;
    loop {
        assert!(Instant::now() < deadline, "Pocket TTS worker timed out");
        let Some(event) = worker.poll_event() else {
            std::thread::sleep(Duration::from_millis(1));
            continue;
        };
        match event {
            Event::SynthesisStarted {
                synthesis_id: 1,
                sample_rate: rate,
            } => sample_rate = Some(rate),
            Event::SynthesisChunkMeta {
                synthesis_id: 1,
                seq,
                source_range,
                ..
            } => metadata.push((seq, source_range)),
            Event::SynthesisAudio {
                synthesis_id: 1,
                seq,
                pcm16le,
            } => {
                first_audio_latency.get_or_insert_with(|| started_at.elapsed());
                audio_sequences.push(seq);
                non_silent |= pcm16le
                    .chunks_exact(2)
                    .any(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]).unsigned_abs() > 32);
            }
            Event::SynthesisComplete { synthesis_id: 1 } => break,
            Event::SynthesisError { code, message, .. } => {
                panic!("Pocket TTS synthesis failed ({code}): {message}")
            }
            _ => {}
        }
    }

    let first_audio_latency = first_audio_latency.expect("worker should emit audio");
    eprintln!(
        "Pocket TTS first audio: {:.3}s",
        first_audio_latency.as_secs_f64()
    );
    assert_eq!(sample_rate, Some(24_000));
    assert_eq!(audio_sequences, vec![0, 1]);
    assert_eq!(
        metadata,
        vec![(0, expected_ranges[0]), (1, expected_ranges[1])]
    );
    assert!(non_silent);
    assert!(
        first_audio_latency <= Duration::from_secs(3),
        "first audio took {:.3}s",
        first_audio_latency.as_secs_f64()
    );
}

#[cfg(feature = "engine-whisper")]
#[test]
#[ignore = "downloads the pinned Pocket TTS and Whisper models"]
fn pinned_english_model_round_trips_through_whisper() {
    use local_dictation_sidecar::adapters::whisper::WhisperAdapter;
    use local_dictation_sidecar::transcription::{GpuConfig, TranscriptionRequest};

    const REFERENCE: &str = "Local speech keeps every word on this computer.";
    const MAX_WORD_ERROR_RATE: f64 = 0.35;

    let pocket_path = common::model::require_pocket_tts_model();
    let pocket_dir = pocket_path
        .parent()
        .expect("model path should have a parent");
    let mut synthesizer = PocketTtsAdapter
        .load_synthesis(&pocket_path)
        .expect("Pocket TTS should load");
    let synthesized = synthesizer
        .synthesize(
            REFERENCE,
            &pocket_dir.join("embeddings/alba.safetensors"),
            &SynthesisCancellation::new(),
        )
        .expect("Pocket TTS should synthesize");
    let audio_samples = resample_24khz_to_16khz(&synthesized.samples);

    let whisper_path = common::model::require_whisper_model();
    let mut whisper = WhisperAdapter
        .load(&whisper_path, GpuConfig { use_gpu: false })
        .expect("Whisper should load");
    let transcript = whisper
        .transcribe(&TranscriptionRequest {
            audio_samples,
            context: None,
            detailed_timestamps_enabled: false,
            gpu_config: GpuConfig { use_gpu: false },
            language: "en".to_string(),
            model_file_path: whisper_path,
        })
        .expect("Whisper should transcribe synthesized speech");
    let hypothesis = common::text::joined_text(&transcript);
    let wer = common::text::word_error_rate(REFERENCE, &hypothesis);
    eprintln!("Pocket TTS round trip: wer={wer:.3} ref={REFERENCE:?} got={hypothesis:?}");
    assert!(
        wer <= MAX_WORD_ERROR_RATE,
        "Pocket TTS round-trip WER {wer:.3} exceeded {MAX_WORD_ERROR_RATE:.3}: {hypothesis:?}"
    );
}

#[cfg(feature = "engine-whisper")]
#[test]
#[ignore = "downloads all six pinned Pocket TTS models and multilingual Whisper"]
fn pinned_multilingual_models_meet_quality_and_throughput_gates() {
    use local_dictation_sidecar::adapters::whisper::WhisperAdapter;
    use local_dictation_sidecar::transcription::{GpuConfig, TranscriptionRequest};

    const MAX_WORD_ERROR_RATE: f64 = 0.35;
    const MAX_FIRST_AUDIO_SECONDS: f64 = 3.0;
    const MIN_COMPACT_REAL_TIME_FACTOR: f64 = 2.2;
    const FIXTURES: [(&str, &str, &str, &str); 6] = [
        (
            "pocket_tts_english_2026_04_int8",
            "en",
            "Read aloud is ready.",
            "Local speech keeps every word on this computer.",
        ),
        (
            "pocket_tts_french_24l_int8",
            "fr",
            "La lecture est prête.",
            "La parole locale garde chaque mot sur cet ordinateur.",
        ),
        (
            "pocket_tts_german_int8",
            "de",
            "Vorlesen ist bereit.",
            "Lokale Sprache behält jedes Wort auf diesem Computer.",
        ),
        (
            "pocket_tts_spanish_int8",
            "es",
            "La lectura está lista.",
            "La voz local mantiene cada palabra en este ordenador.",
        ),
        (
            "pocket_tts_portuguese_int8",
            "pt",
            "A leitura está pronta.",
            "A voz local mantém cada palavra neste computador.",
        ),
        (
            "pocket_tts_italian_int8",
            "it",
            "La lettura è pronta.",
            "La voce locale conserva ogni parola su questo computer.",
        ),
    ];

    let whisper_path = common::model::require_multilingual_whisper_model();
    let mut whisper = WhisperAdapter
        .load(&whisper_path, GpuConfig { use_gpu: false })
        .expect("multilingual Whisper should load");

    for (model_id, language, latency_prompt, reference) in FIXTURES {
        let model_path = common::model::require_pocket_tts_model_by_id(model_id);
        let model_dir = model_path
            .parent()
            .expect("model path should have a parent");
        let mut synthesizer = PocketTtsAdapter
            .load_synthesis(&model_path)
            .unwrap_or_else(|error| panic!("{model_id} should load: {error}"));
        let voice_path = model_dir.join("embeddings/alba.safetensors");
        let first_audio_started_at = Instant::now();
        let first_audio = synthesizer
            .synthesize(latency_prompt, &voice_path, &SynthesisCancellation::new())
            .unwrap_or_else(|error| panic!("{model_id} latency prompt should synthesize: {error}"));
        let first_audio_seconds = first_audio_started_at.elapsed().as_secs_f64();
        assert_eq!(
            first_audio.sample_rate, 24_000,
            "{model_id} first audio rate"
        );
        assert!(
            first_audio
                .samples
                .iter()
                .any(|sample| sample.abs() > 0.001),
            "{model_id} produced silent first audio"
        );

        let synthesis_started_at = Instant::now();
        let synthesized = synthesizer
            .synthesize(reference, &voice_path, &SynthesisCancellation::new())
            .unwrap_or_else(|error| panic!("{model_id} should synthesize: {error}"));
        let synthesis_seconds = synthesis_started_at.elapsed().as_secs_f64();
        let raw_output_seconds = synthesized.samples.len() as f64 / synthesized.sample_rate as f64;
        let real_time_factor = raw_output_seconds / synthesis_seconds.max(f64::EPSILON);
        let non_silent = synthesized
            .samples
            .iter()
            .any(|sample| sample.abs() > 0.001);

        assert_eq!(synthesized.sample_rate, 24_000, "{model_id} sample rate");
        assert!(non_silent, "{model_id} produced silent audio");

        let transcript = whisper
            .transcribe(&TranscriptionRequest {
                audio_samples: resample_24khz_to_16khz(&synthesized.samples),
                context: None,
                detailed_timestamps_enabled: false,
                gpu_config: GpuConfig { use_gpu: false },
                language: language.to_string(),
                model_file_path: whisper_path.clone(),
            })
            .unwrap_or_else(|error| panic!("Whisper failed for {model_id}: {error}"));
        let hypothesis = common::text::joined_text(&transcript);
        let wer = common::text::word_error_rate(reference, &hypothesis);
        let quality_passed = wer <= MAX_WORD_ERROR_RATE;
        let latency_passed = first_audio_seconds <= MAX_FIRST_AUDIO_SECONDS;
        let throughput_passed =
            language == "fr" || real_time_factor >= MIN_COMPACT_REAL_TIME_FACTOR;

        for speed in [0.75_f32, 1.0, 2.0, 3.0] {
            let report_only = speed > 2.0;
            let output_seconds = if report_only {
                raw_output_seconds / f64::from(speed)
            } else {
                time_stretch(&synthesized.samples, speed, synthesized.sample_rate).len() as f64
                    / synthesized.sample_rate as f64
            };
            let target_seconds = raw_output_seconds / f64::from(speed);
            let duration_error = (output_seconds - target_seconds).abs() / target_seconds;
            let duration_passed = report_only || duration_error <= 0.05;
            append_quality_report(&TtsQualityMeasurement {
                first_audio_latency_seconds: first_audio_seconds,
                language,
                model_id,
                output_duration_seconds: output_seconds,
                passed: quality_passed && latency_passed && throughput_passed && duration_passed,
                platform: &format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
                real_time_factor,
                report_only,
                schema_version: 1,
                speed,
                synthesis_time_seconds: synthesis_seconds,
                wer,
            });
            if !report_only {
                assert!(
                    duration_passed,
                    "{model_id} {speed}x duration error {duration_error:.3} exceeded 5%"
                );
            }
        }

        assert!(
            quality_passed,
            "{model_id} WER {wer:.3} exceeded {MAX_WORD_ERROR_RATE:.3}: {hypothesis:?}"
        );
        assert!(
            latency_passed,
            "{model_id} first audio took {first_audio_seconds:.3}s"
        );
        assert!(
            throughput_passed,
            "{model_id} synthesized at {real_time_factor:.2}x real time, below {MIN_COMPACT_REAL_TIME_FACTOR:.1}x"
        );
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TtsQualityMeasurement<'a> {
    schema_version: u32,
    model_id: &'a str,
    language: &'a str,
    platform: &'a str,
    speed: f32,
    first_audio_latency_seconds: f64,
    synthesis_time_seconds: f64,
    real_time_factor: f64,
    output_duration_seconds: f64,
    wer: f64,
    passed: bool,
    report_only: bool,
}

fn append_quality_report(measurement: &TtsQualityMeasurement<'_>) {
    let Some(path) = std::env::var_os("TTS_QUALITY_REPORT_PATH") else {
        return;
    };
    let path = Path::new(&path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create TTS quality report directory");
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .expect("open TTS quality report");
    serde_json::to_writer(&mut file, measurement).expect("serialize TTS quality measurement");
    writeln!(file).expect("terminate TTS quality JSONL row");
}

#[cfg(feature = "engine-whisper")]
fn resample_24khz_to_16khz(samples: &[f32]) -> Vec<f32> {
    let output_len = samples.len() * 2 / 3;
    (0..output_len)
        .map(|index| {
            let position = index as f32 * 1.5;
            let left = position.floor() as usize;
            let fraction = position - left as f32;
            let a = samples.get(left).copied().unwrap_or(0.0);
            let b = samples.get(left + 1).copied().unwrap_or(a);
            a + (b - a) * fraction
        })
        .collect()
}
