#![cfg(feature = "engine-supertonic")]

mod common;

use std::time::Instant;

use local_dictation_sidecar::adapters::supertonic::SupertonicAdapter;
use local_dictation_sidecar::engine::traits::ModelFamilyAdapter;
use local_dictation_sidecar::synthesis::SynthesisCancellation;

#[test]
#[ignore = "downloads the pinned Supertonic model"]
fn pinned_model_loads_and_synthesizes_all_catalog_languages() {
    let model_path = common::model::require_supertonic_model();
    let model_dir = model_path
        .parent()
        .and_then(|directory| directory.parent())
        .expect("Supertonic primary artifact should be under the onnx directory");
    let voice_path = model_dir.join("voice_styles/F1.json");
    let mut synthesizer = SupertonicAdapter
        .load_synthesis(&model_path)
        .expect("Supertonic should load");

    let fixtures = [
        ("en", "Local speech stays on this computer."),
        ("es", "La voz local permanece en este equipo."),
        ("de", "Die lokale Stimme bleibt auf diesem Computer."),
        ("fr", "La voix locale reste sur cet ordinateur."),
        ("pt", "A voz local permanece neste computador."),
        ("it", "La voce locale resta su questo computer."),
        ("nl", "De lokale stem blijft op deze computer."),
        ("ja", "ローカル音声はこのコンピューター上に残ります。"),
    ];
    let started_at = Instant::now();
    for (language, text) in fixtures {
        let synthesized = synthesizer
            .synthesize(text, language, &voice_path, &SynthesisCancellation::new())
            .unwrap_or_else(|error| panic!("Supertonic should synthesize {language}: {error}"));
        let audio_seconds = synthesized.samples.len() as f64 / synthesized.sample_rate as f64;

        assert_eq!(synthesized.sample_rate, 44_100, "{language} sample rate");
        assert!(
            synthesized.samples.iter().all(|sample| sample.is_finite()),
            "Supertonic produced non-finite {language} audio"
        );
        assert!(
            synthesized
                .samples
                .iter()
                .any(|sample| sample.abs() > 0.001),
            "Supertonic produced silent {language} audio"
        );
        assert!(
            (0.5..=30.0).contains(&audio_seconds),
            "unexpected Supertonic {language} duration: {audio_seconds:.2}s"
        );
    }
    let elapsed = started_at.elapsed().as_secs_f64();
    assert!(
        elapsed <= 120.0,
        "Supertonic multilingual smoke took {elapsed:.2}s"
    );
}
