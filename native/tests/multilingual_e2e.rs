//! Real-model multilingual product-path quality and performance gates. The
//! committed speech is deterministic synthetic audio, so it is a reproducible
//! regression floor rather than a substitute for native-speaker evaluation.

mod common;

use std::path::{Path, PathBuf};

use common::model::{
    MULTILINGUAL_WHISPER_MODEL_ID, NEMOTRON_MODEL_ID, require_multilingual_whisper_model,
    require_nemotron_model,
};
use common::quality_report::{self, QualityMeasurement};
use common::text::{character_error_rate, word_error_rate};
use common::{audio, driver};
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::{ContextWindow, ContextWindowSource, SelectedModel};
use local_dictation_sidecar::session::SpeakingStyle;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const MAX_WORD_ERROR_RATE: f64 = 0.45;
const MAX_JAPANESE_CER: f64 = 0.45;
const MAX_REALTIME_FACTOR: f64 = 1.0;

struct Fixture {
    id: String,
    language: String,
    path: PathBuf,
    reference: String,
    anchors: Vec<String>,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MultilingualManifest {
    fixtures: Vec<ManifestFixture>,
    english_regression: EnglishRegression,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFixture {
    language: String,
    audio_path: String,
    sha256: String,
    reference: String,
    anchors: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnglishRegression {
    fixture_id: String,
}

fn fixtures() -> Vec<Fixture> {
    let manifest_path = common::fixtures_dir().join("multilingual.json");
    let manifest: MultilingualManifest = serde_json::from_slice(
        &std::fs::read(&manifest_path).expect("read multilingual fixture manifest"),
    )
    .expect("parse multilingual fixture manifest");
    let english = common::manifest::Corpus::load()
        .fixtures
        .into_iter()
        .find(|fixture| fixture.id == manifest.english_regression.fixture_id)
        .expect("English multilingual regression fixture must exist in the corpus manifest");
    let english_path = english.audio_path();
    let mut fixtures = vec![Fixture {
        id: english.id,
        language: "en".to_string(),
        path: english_path,
        reference: english.reference,
        anchors: english.anchors,
        sha256: english.source.sha256,
    }];
    fixtures.extend(manifest.fixtures.into_iter().map(|fixture| {
        Fixture {
            id: fixture
                .audio_path
                .strip_prefix("audio/")
                .unwrap_or(&fixture.audio_path)
                .strip_suffix(".wav")
                .unwrap_or(&fixture.audio_path)
                .to_string(),
            language: fixture.language,
            path: common::fixtures_dir().join(fixture.audio_path),
            reference: fixture.reference,
            anchors: fixture.anchors,
            sha256: fixture.sha256,
        }
    }));
    fixtures
}

#[test]
fn multilingual_fixtures_are_pinned_16khz_audio() {
    for fixture in fixtures() {
        let bytes = std::fs::read(&fixture.path).expect("read multilingual fixture");
        let digest = Sha256::digest(&bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(digest, fixture.sha256);
        assert!(
            !audio::decode_wav_16k_mono(&fixture.path)
                .unwrap()
                .is_empty()
        );
    }
}

struct ModelRun<'a> {
    engine: &'a str,
    model_id: &'a str,
    model_name: &'a str,
    selection: &'a str,
    transcript: &'a str,
    processing_ms: u64,
    first_partial_audio_ms: Option<u64>,
    utterance_count: Option<usize>,
    partial_count: Option<usize>,
}

fn assert_quality(run: ModelRun<'_>, fixture: &Fixture, samples: usize) {
    let processing_secs = run.processing_ms as f64 / 1_000.0;
    let audio_secs = samples as f64 / 16_000.0;
    let rtf = processing_secs / audio_secs;
    eprintln!(
        "{} {}: {}\nquality processing={processing_secs:.3}s audio={audio_secs:.3}s rtf={rtf:.3}",
        run.engine, fixture.language, run.transcript,
    );
    let (quality_metric, quality_error_rate, quality_budget, preserves_language) =
        if fixture.language == "ja" {
            let cer = character_error_rate(&fixture.reference, run.transcript);
            let japanese = run
                .transcript
                .chars()
                .filter(|character| {
                    matches!(*character, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}')
                })
                .count();
            let visible = run
                .transcript
                .chars()
                .filter(|character| !character.is_whitespace())
                .count();
            ("cer", cer, MAX_JAPANESE_CER, japanese * 2 >= visible)
        } else {
            let wer = word_error_rate(&fixture.reference, run.transcript);
            let max_wer = if fixture.language == "en" {
                0.20
            } else {
                MAX_WORD_ERROR_RATE
            };
            ("wer", wer, max_wer, true)
        };
    let normalized = run.transcript.to_lowercase();
    let anchors_present = fixture
        .anchors
        .iter()
        .all(|anchor| normalized.contains(&anchor.to_lowercase()));
    let mut measurement = QualityMeasurement::new(
        "multilingual-product-path",
        run.model_id,
        run.model_name,
        &fixture.language,
        run.selection,
        &fixture.id,
        quality_metric,
        quality_error_rate,
        quality_budget,
        (audio_secs * 1_000.0) as u64,
        run.processing_ms,
        MAX_REALTIME_FACTOR,
    );
    measurement.first_partial_audio_ms = run.first_partial_audio_ms;
    measurement.utterance_count = run.utterance_count;
    measurement.partial_count = run.partial_count;
    measurement.passed = !run.transcript.trim().is_empty()
        && rtf <= MAX_REALTIME_FACTOR
        && quality_error_rate <= quality_budget
        && preserves_language
        && anchors_present;
    quality_report::record(&measurement);

    assert!(
        !run.transcript.trim().is_empty(),
        "{} returned no {} text",
        run.engine,
        fixture.language
    );
    assert!(
        rtf <= MAX_REALTIME_FACTOR,
        "{} {} RTF {rtf:.3} exceeded {MAX_REALTIME_FACTOR}",
        run.engine,
        fixture.language
    );
    assert!(
        quality_error_rate <= quality_budget,
        "{} {} {} {quality_error_rate:.3} exceeded {quality_budget}: {}",
        run.engine,
        fixture.language,
        quality_metric.to_uppercase(),
        run.transcript,
    );
    assert!(
        preserves_language,
        "{} translated {} instead of transcribing it: {}",
        run.engine, fixture.language, run.transcript,
    );
    assert!(
        anchors_present,
        "{} {} output lost required anchors: {}",
        run.engine, fixture.language, run.transcript,
    );
}

fn whisper_transcribe(model_path: &Path, language: &str, samples: &[i16]) -> (String, u64, usize) {
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
    (outcome.text, outcome.processing_ms, outcome.utterance_count)
}

fn nemotron_transcribe(
    model_path: &Path,
    language: &str,
    samples: &[i16],
) -> (String, u64, Option<u64>, usize) {
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
    (
        outcome.final_text,
        outcome.processing_ms,
        outcome
            .partials
            .first()
            .map(|partial| partial.utterance_duration_ms),
        outcome.partials.len(),
    )
}

#[test]
#[ignore = "needs the pinned 651 MiB Nemotron and 874 MiB multilingual Whisper models"]
fn nemotron_and_whisper_transcribe_every_enabled_language_without_translation() {
    let nemotron = require_nemotron_model();
    let whisper = require_multilingual_whisper_model();

    for fixture in fixtures() {
        let samples = audio::decode_wav_16k_mono(&fixture.path).expect("decode fixture");
        let (text, processing, first_partial, partials) =
            nemotron_transcribe(&nemotron, &fixture.language, &samples);
        assert_quality(
            ModelRun {
                engine: "Nemotron",
                model_id: NEMOTRON_MODEL_ID,
                model_name: "NVIDIA Nemotron 3.5 ASR Streaming 0.6B Int8",
                selection: "manual",
                transcript: &text,
                processing_ms: processing,
                first_partial_audio_ms: first_partial,
                utterance_count: None,
                partial_count: Some(partials),
            },
            &fixture,
            samples.len(),
        );
        let (text, processing, utterances) =
            whisper_transcribe(&whisper, &fixture.language, &samples);
        assert_quality(
            ModelRun {
                engine: "Whisper",
                model_id: MULTILINGUAL_WHISPER_MODEL_ID,
                model_name: "Whisper Large V3 Turbo Q8",
                selection: "manual",
                transcript: &text,
                processing_ms: processing,
                first_partial_audio_ms: None,
                utterance_count: Some(utterances),
                partial_count: None,
            },
            &fixture,
            samples.len(),
        );

        // Automatic detection is a separate capability. Exercising every
        // language prevents a detector fixed to one language from passing.
        let (text, processing, first_partial, partials) =
            nemotron_transcribe(&nemotron, "auto", &samples);
        assert_quality(
            ModelRun {
                engine: "Nemotron auto",
                model_id: NEMOTRON_MODEL_ID,
                model_name: "NVIDIA Nemotron 3.5 ASR Streaming 0.6B Int8",
                selection: "auto",
                transcript: &text,
                processing_ms: processing,
                first_partial_audio_ms: first_partial,
                utterance_count: None,
                partial_count: Some(partials),
            },
            &fixture,
            samples.len(),
        );
        let (text, processing, utterances) = whisper_transcribe(&whisper, "auto", &samples);
        assert_quality(
            ModelRun {
                engine: "Whisper auto",
                model_id: MULTILINGUAL_WHISPER_MODEL_ID,
                model_name: "Whisper Large V3 Turbo Q8",
                selection: "auto",
                transcript: &text,
                processing_ms: processing,
                first_partial_audio_ms: None,
                utterance_count: Some(utterances),
                partial_count: None,
            },
            &fixture,
            samples.len(),
        );
    }
}
