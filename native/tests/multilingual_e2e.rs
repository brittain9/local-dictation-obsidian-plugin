//! Real-model multilingual product-path quality and performance gates. The
//! committed speech is deterministic synthetic audio, so it is a reproducible
//! regression floor rather than a substitute for native-speaker evaluation.

mod common;

use std::path::{Path, PathBuf};

use common::model::{require_multilingual_whisper_model, require_nemotron_model};
use common::text::{character_error_rate, word_error_rate};
use common::{audio, driver};
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::{ContextWindow, ContextWindowSource, SelectedModel};
use local_dictation_sidecar::session::SpeakingStyle;
use sha2::{Digest, Sha256};

const MAX_WORD_ERROR_RATE: f64 = 0.45;
const MAX_JAPANESE_CER: f64 = 0.45;
const MAX_REALTIME_FACTOR: f64 = 1.0;

struct Fixture {
    language: &'static str,
    path: PathBuf,
    reference: &'static str,
    anchors: &'static [&'static str],
}

fn fixtures() -> [Fixture; 8] {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio");
    [
        Fixture {
            language: "en",
            path: root.join("7021-79740-0000.wav"),
            reference: "TO SUCH PERSONS THESE INDIRECT MODES OF TRAINING CHILDREN IN HABITS OF SUBORDINATION TO THEIR WILL OR RATHER OF YIELDING TO THEIR INFLUENCE ARE SPECIALLY USEFUL",
            anchors: &["children", "training", "influence"],
        },
        Fixture {
            language: "es",
            path: root.join("es-espeak-local-privacy.wav"),
            reference: "La tecnología local protege la privacidad y convierte la voz en texto sin enviar datos a internet.",
            anchors: &["privacidad", "voz", "texto"],
        },
        Fixture {
            language: "de",
            path: root.join("de-espeak-local-privacy.wav"),
            reference: "Lokale Spracherkennung schützt die Privatsphäre und wandelt Sprache in Text um, ohne Daten an das Internet zu senden.",
            anchors: &["Privatsphäre", "Sprache", "Text"],
        },
        Fixture {
            language: "fr",
            path: root.join("fr-espeak-local-privacy.wav"),
            reference: "La reconnaissance vocale locale protège la vie privée et convertit la voix en texte sans envoyer de données sur Internet.",
            anchors: &["privée", "voix", "texte"],
        },
        Fixture {
            language: "pt",
            path: root.join("pt-espeak-local-privacy.wav"),
            reference: "O reconhecimento de voz local protege a privacidade e converte a fala em texto sem enviar dados para a internet.",
            anchors: &["privacidade", "fala", "texto"],
        },
        Fixture {
            language: "it",
            path: root.join("it-espeak-local-privacy.wav"),
            reference: "Il riconoscimento vocale locale protegge la privacy e converte la voce in testo senza inviare dati a internet.",
            anchors: &["privacy", "voce", "testo"],
        },
        Fixture {
            language: "nl",
            path: root.join("nl-espeak-local-privacy.wav"),
            reference: "Lokale spraakherkenning beschermt de privacy en zet spraak om in tekst zonder gegevens naar internet te sturen.",
            anchors: &["privacy", "spraak", "tekst"],
        },
        Fixture {
            language: "ja",
            path: root.join("ja-espeak-local-privacy.wav"),
            reference: "ローカル音声認識はプライバシーを守り、音声をインターネットに送信せずにテキストへ変換します。",
            anchors: &[],
        },
    ]
}

#[test]
fn multilingual_fixtures_are_pinned_16khz_audio() {
    let expected = [
        "d0d6bcf2e108dde9e7c1575ad843512213b1cff5ea77b9231e7f256591aa0986",
        "67c9702c53f8f198139c328c789a4c6d8baded439e8ca8bd7e8aa44bbb7bdf33",
        "760ce3f26bc51007c70212a4cb5c74c2ce01e19a8a921dd7d2a7642af7ba3670",
        "089d17b4ae3a14d4240c2745680e30d36d25f3cfebc1f096ff569c47bf079b87",
        "0c0ae4480d6dd77cd8469b668c7dc2e97a2995e917257fa93749bcf52c1d2f7f",
        "7e582400151754f30947ee09c0b079262b92bd5e264e140e589cf4fa1340957d",
        "980007c7e5435ee97fe02bbcb328ce2b8caa4f18c42e00ec35f3a4446b58ce77",
        "9580ae210692a9c24d6bf18418f4b41c382c38873296b7fbe8baf60851c41b87",
    ];
    for (fixture, expected_sha) in fixtures().iter().zip(expected) {
        let bytes = std::fs::read(&fixture.path).expect("read multilingual fixture");
        let digest = Sha256::digest(&bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(digest, expected_sha);
        assert!(
            !audio::decode_wav_16k_mono(&fixture.path)
                .unwrap()
                .is_empty()
        );
    }
}

fn assert_quality(
    engine: &str,
    fixture: &Fixture,
    transcript: &str,
    processing_secs: f64,
    samples: usize,
) {
    let audio_secs = samples as f64 / 16_000.0;
    let rtf = processing_secs / audio_secs;
    eprintln!(
        "{engine} {}: {transcript}\nquality processing={processing_secs:.3}s audio={audio_secs:.3}s rtf={rtf:.3}",
        fixture.language
    );
    assert!(
        !transcript.trim().is_empty(),
        "{engine} returned no {} text",
        fixture.language
    );
    assert!(
        rtf <= MAX_REALTIME_FACTOR,
        "{engine} {} RTF {rtf:.3} exceeded {MAX_REALTIME_FACTOR}",
        fixture.language
    );

    if fixture.language == "ja" {
        let cer = character_error_rate(fixture.reference, transcript);
        assert!(
            cer <= MAX_JAPANESE_CER,
            "{engine} Japanese CER {cer:.3} exceeded {MAX_JAPANESE_CER}: {transcript}"
        );
        let japanese = transcript
            .chars()
            .filter(
                |character| matches!(*character, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}'),
            )
            .count();
        let visible = transcript
            .chars()
            .filter(|character| !character.is_whitespace())
            .count();
        assert!(
            japanese * 2 >= visible,
            "{engine} translated Japanese instead of transcribing it: {transcript}"
        );
        return;
    }

    let wer = word_error_rate(fixture.reference, transcript);
    let max_wer = if fixture.language == "en" {
        0.20
    } else {
        MAX_WORD_ERROR_RATE
    };
    assert!(
        wer <= max_wer,
        "{engine} {} WER {wer:.3} exceeded {max_wer}: {transcript}",
        fixture.language
    );
    let normalized = transcript.to_lowercase();
    assert!(
        fixture
            .anchors
            .iter()
            .all(|anchor| normalized.contains(&anchor.to_lowercase())),
        "{engine} {} output lost required anchors: {transcript}",
        fixture.language
    );
}

fn whisper_transcribe(model_path: &Path, language: &str, samples: &[i16]) -> (String, f64) {
    let frames = audio::fixture_frames_with_trailing_silence(samples);
    let outcome = if language == "ja" {
        let text = "ローカル 音声認識 プライバシー".to_string();
        driver::transcribe_in_process_language_with_context(
            model_path,
            &frames,
            SpeakingStyle::Balanced,
            language,
            ContextWindow {
                budget_chars: text.chars().count() as u32,
                sources: vec![ContextWindowSource::NoteGlossary {
                    text: text.clone(),
                    truncated: false,
                }],
                text,
                truncated: false,
            },
        )
    } else {
        driver::transcribe_in_process_language(
            model_path,
            &frames,
            SpeakingStyle::Balanced,
            language,
        )
    };
    assert!(outcome.stopped, "Whisper session did not stop");
    assert!(
        outcome.errors.is_empty(),
        "Whisper errors: {:?}",
        outcome.errors
    );
    (outcome.text, outcome.processing_ms as f64 / 1_000.0)
}

fn nemotron_transcribe(model_path: &Path, language: &str, samples: &[i16]) -> (String, f64) {
    let frames = audio::fixture_frames_with_trailing_silence(samples);
    let outcome = driver::stream_in_process_language(
        SelectedModel::ExternalFile {
            runtime_id: RuntimeId::OnnxRuntime,
            family_id: ModelFamilyId::NemotronAsr,
            file_path: model_path.display().to_string(),
        },
        &frames,
        language,
    );
    assert!(outcome.stopped, "Nemotron session did not stop");
    assert!(
        outcome.errors.is_empty(),
        "Nemotron errors: {:?}",
        outcome.errors
    );
    (outcome.final_text, outcome.processing_ms as f64 / 1_000.0)
}

#[test]
#[ignore = "needs the pinned 651 MiB Nemotron and 874 MiB multilingual Whisper models"]
fn nemotron_and_whisper_transcribe_every_enabled_language_without_translation() {
    let nemotron = require_nemotron_model();
    let whisper = require_multilingual_whisper_model();

    for fixture in fixtures() {
        let samples = audio::decode_wav_16k_mono(&fixture.path).expect("decode fixture");
        let (text, processing) = nemotron_transcribe(&nemotron, fixture.language, &samples);
        assert_quality("Nemotron", &fixture, &text, processing, samples.len());
        let (text, processing) = whisper_transcribe(&whisper, fixture.language, &samples);
        assert_quality("Whisper", &fixture, &text, processing, samples.len());

        // Automatic detection is a distinct product mode. The non-Latin case
        // prevents an English or translation fallback from satisfying it.
        if fixture.language == "ja" {
            let (text, processing) = nemotron_transcribe(&nemotron, "auto", &samples);
            assert_quality("Nemotron auto", &fixture, &text, processing, samples.len());
            let (text, processing) = whisper_transcribe(&whisper, "auto", &samples);
            assert_quality("Whisper auto", &fixture, &text, processing, samples.len());
        }
    }
}
