#![cfg(feature = "engine-pocket-tts")]

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use local_dictation_sidecar::adapters::pocket_tts::PocketTtsAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::engine::{EngineRegistry, ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::{Event, SourceRange, SynthesisTextChunk};
use local_dictation_sidecar::synthesis::SynthesisCancellation;
use local_dictation_sidecar::synthesis_worker::{StartSynthesis, SynthesisWorker};

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
