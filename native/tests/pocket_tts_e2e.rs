#![cfg(feature = "engine-pocket-tts")]

mod common;

use local_dictation_sidecar::adapters::pocket_tts::PocketTtsAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::synthesis::SynthesisCancellation;

#[test]
#[ignore = "downloads the pinned Pocket TTS model"]
fn pinned_english_model_synthesizes_non_silent_pcm() {
    let model_path = common::model::require_pocket_tts_model();
    let model_dir = model_path
        .parent()
        .expect("model path should have a parent");
    let mut model = PocketTtsAdapter
        .load_synthesis(&model_path)
        .expect("Pocket TTS should load");
    let output = model
        .synthesize(
            "Local speech keeps every word on this computer.",
            &model_dir.join("embeddings/alba.safetensors"),
            &SynthesisCancellation::new(),
        )
        .expect("Pocket TTS should synthesize");

    assert_eq!(output.sample_rate, 24_000);
    assert!(output.samples.len() > output.sample_rate as usize / 2);
    assert!(output.samples.iter().any(|sample| sample.abs() > 0.001));
    assert!(output.samples.iter().all(|sample| sample.is_finite()));
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
