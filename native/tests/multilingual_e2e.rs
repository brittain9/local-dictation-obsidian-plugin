//! Real-model multilingual product-path quality and performance gates. The
//! committed speech is pinned human read speech, so it is a reproducible
//! regression floor rather than a substitute for broader native-speaker evaluation.

mod common;

use std::path::{Path, PathBuf};

use common::model::{
    MULTILINGUAL_WHISPER_MODEL_ID, NEMOTRON_MODEL_ID, require_multilingual_whisper_model,
    require_nemotron_model,
};
use common::quality_report::{self, QualityMeasurement};
use common::text::{self, character_error_rate, word_error_rate};
use common::{audio, driver};
use local_dictation_sidecar::catalog::ModelCatalog;
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::SelectedModel;
use local_dictation_sidecar::session::SpeakingStyle;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const MAX_WORD_ERROR_RATE: f64 = 0.45;
/// English rides the long-standing regression corpus, so it gets a stricter
/// budget than the newly verified languages.
const MAX_ENGLISH_WORD_ERROR_RATE: f64 = 0.20;
const MAX_JAPANESE_CER: f64 = 0.45;
const NEMOTRON_MAX_REALTIME_FACTOR: f64 = 1.0;
/// Whisper Large V3 Turbo is catalogued as a GPU-oriented accuracy model. The
/// hosted CPU runner is deliberately retained as a portable correctness path,
/// with a fixed wall-time ceiling that catches regressions without pretending
/// its CPU RTF is representative of accelerated desktop inference.
const WHISPER_MANUAL_MAX_PROCESSING_MS: u64 = 45_000;
/// Automatic detection performs a language-identification pass before
/// transcription. Keep that additional work explicit instead of applying the
/// manual-selection ceiling to two inference passes.
const WHISPER_AUTO_MAX_PROCESSING_MS: u64 = 75_000;

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

/// Coverage differs per model — Serbian ships on Whisper only — so the corpus
/// is filtered by what the catalog says the model under test can transcribe
/// rather than by a list restated here.
fn covers_language(model_id: &str, language: &str) -> bool {
    ModelCatalog::load_bundled()
        .expect("bundled catalog should load")
        .models
        .iter()
        .find(|model| model.model_id == model_id)
        .unwrap_or_else(|| panic!("{model_id} must be cataloged"))
        .language_tags
        .iter()
        .any(|tag| tag == language)
}

#[test]
fn multilingual_fixtures_are_pinned_16khz_audio() {
    for fixture in fixtures() {
        assert!(
            !fixture.anchors.is_empty(),
            "{} must define quality anchors",
            fixture.language,
        );
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

#[test]
fn quality_assessment_accumulates_session_and_performance_failures() {
    let fixture = Fixture {
        id: "fixture".to_string(),
        language: "en".to_string(),
        path: PathBuf::new(),
        reference: "local speech".to_string(),
        anchors: vec!["speech".to_string()],
        sha256: String::new(),
    };
    let result = TranscriptionRun {
        text: "local speech".to_string(),
        processing_ms: WHISPER_MANUAL_MAX_PROCESSING_MS + 1,
        first_partial_audio_ms: None,
        utterance_count: Some(1),
        partial_count: None,
        stopped: false,
        errors: vec!["worker failed".to_string()],
    };
    let failures = assess_quality(
        ModelRun {
            engine: "Whisper",
            model_id: MULTILINGUAL_WHISPER_MODEL_ID,
            model_name: "Whisper Large V3 Turbo Q8",
            selection: "manual",
            result: &result,
            performance_budget: PerformanceBudget::ProcessingDurationMs(
                WHISPER_MANUAL_MAX_PROCESSING_MS,
            ),
        },
        &fixture,
        10 * 16_000,
    );

    assert_eq!(failures.len(), 3, "unexpected failures: {failures:?}");
    assert!(
        failures
            .iter()
            .any(|failure| failure.contains("worker failed"))
    );
    assert!(
        failures
            .iter()
            .any(|failure| failure.contains("session did not stop"))
    );
    assert!(
        failures
            .iter()
            .any(|failure| failure.contains("CPU regression ceiling"))
    );
}

struct ModelRun<'a> {
    engine: &'a str,
    model_id: &'a str,
    model_name: &'a str,
    selection: &'a str,
    result: &'a TranscriptionRun,
    performance_budget: PerformanceBudget,
}

struct TranscriptionRun {
    text: String,
    processing_ms: u64,
    first_partial_audio_ms: Option<u64>,
    utterance_count: Option<usize>,
    partial_count: Option<usize>,
    stopped: bool,
    errors: Vec<String>,
}

#[derive(Clone, Copy)]
enum PerformanceBudget {
    RealTimeFactor(f64),
    ProcessingDurationMs(u64),
}

impl PerformanceBudget {
    fn real_time_factor(self, audio_ms: u64) -> f64 {
        match self {
            Self::RealTimeFactor(budget) => budget,
            Self::ProcessingDurationMs(budget) => budget as f64 / audio_ms.max(1) as f64,
        }
    }
}

fn assess_quality(run: ModelRun<'_>, fixture: &Fixture, samples: usize) -> Vec<String> {
    let processing_secs = run.result.processing_ms as f64 / 1_000.0;
    let audio_secs = samples as f64 / 16_000.0;
    let audio_ms = (audio_secs * 1_000.0) as u64;
    let rtf = processing_secs / audio_secs;
    let rtf_budget = run.performance_budget.real_time_factor(audio_ms);
    eprintln!(
        "{} {}: {}\nquality processing={processing_secs:.3}s audio={audio_secs:.3}s rtf={rtf:.3}",
        run.engine, fixture.language, run.result.text,
    );
    // Serbian may come back in either script; both are correct Serbian, so the
    // hypothesis is transliterated to match the Latin reference before scoring.
    let scored_text = if fixture.language == "sr" {
        text::to_serbian_latin(&run.result.text)
    } else {
        run.result.text.clone()
    };
    let (quality_metric, quality_error_rate, quality_budget, preserves_language) =
        if fixture.language == "ja" {
            let cer = character_error_rate(&fixture.reference, &run.result.text);
            let japanese = run
                .result
                .text
                .chars()
                .filter(|character| {
                    matches!(*character, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}')
                })
                .count();
            let visible = run
                .result
                .text
                .chars()
                .filter(|character| !character.is_whitespace())
                .count();
            ("cer", cer, MAX_JAPANESE_CER, japanese * 2 >= visible)
        } else {
            let wer = word_error_rate(&fixture.reference, &scored_text);
            let max_wer = if fixture.language == "en" {
                MAX_ENGLISH_WORD_ERROR_RATE
            } else {
                MAX_WORD_ERROR_RATE
            };
            ("wer", wer, max_wer, true)
        };
    let normalized = scored_text.to_lowercase();
    let anchors_present = fixture
        .anchors
        .iter()
        .all(|anchor| normalized.contains(&anchor.to_lowercase()));
    let mut failures = run
        .result
        .errors
        .iter()
        .map(|error| format!("{} {} error: {error}", run.engine, fixture.language))
        .collect::<Vec<_>>();
    if !run.result.stopped {
        failures.push(format!(
            "{} {} session did not stop",
            run.engine, fixture.language
        ));
    }
    if run.result.text.trim().is_empty() {
        failures.push(format!(
            "{} returned no {} text",
            run.engine, fixture.language
        ));
    }
    if rtf > rtf_budget {
        failures.push(match run.performance_budget {
            PerformanceBudget::RealTimeFactor(budget) => format!(
                "{} {} RTF {rtf:.3} exceeded {budget:.3}",
                run.engine, fixture.language
            ),
            PerformanceBudget::ProcessingDurationMs(budget) => format!(
                "{} {} processing {:.3}s exceeded the {:.3}s CPU regression ceiling (RTF {rtf:.3})",
                run.engine,
                fixture.language,
                processing_secs,
                budget as f64 / 1_000.0,
            ),
        });
    }
    if quality_error_rate > quality_budget {
        failures.push(format!(
            "{} {} {} {quality_error_rate:.3} exceeded {quality_budget}: {}",
            run.engine,
            fixture.language,
            quality_metric.to_uppercase(),
            run.result.text,
        ));
    }
    if !preserves_language {
        failures.push(format!(
            "{} translated {} instead of transcribing it: {}",
            run.engine, fixture.language, run.result.text,
        ));
    }
    if !anchors_present {
        failures.push(format!(
            "{} {} output lost required anchors: {}",
            run.engine, fixture.language, run.result.text,
        ));
    }

    quality_report::record(&QualityMeasurement {
        suite: "multilingual-product-path",
        model_id: run.model_id,
        model_name: run.model_name,
        language: &fixture.language,
        selection: run.selection,
        fixture_id: &fixture.id,
        quality_metric,
        quality_error_rate,
        quality_budget,
        audio_duration_ms: audio_ms,
        processing_duration_ms: run.result.processing_ms,
        real_time_factor: rtf,
        real_time_factor_budget: rtf_budget,
        first_partial_audio_ms: run.result.first_partial_audio_ms,
        first_partial_audio_budget_ms: None,
        utterance_count: run.result.utterance_count,
        partial_count: run.result.partial_count,
        passed: failures.is_empty(),
    });

    failures
}

fn whisper_transcribe(model_path: &Path, language: &str, samples: &[i16]) -> TranscriptionRun {
    let frames = audio::fixture_frames_with_trailing_silence(samples);
    let outcome = driver::transcribe_in_process_language(
        model_path,
        &frames,
        SpeakingStyle::Balanced,
        language,
    );
    TranscriptionRun {
        text: outcome.text,
        processing_ms: outcome.processing_ms,
        first_partial_audio_ms: None,
        utterance_count: Some(outcome.utterance_count),
        partial_count: None,
        stopped: outcome.stopped,
        errors: outcome.errors,
    }
}

fn nemotron_transcribe(model_path: &Path, language: &str, samples: &[i16]) -> TranscriptionRun {
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
    TranscriptionRun {
        text: outcome.final_text,
        processing_ms: outcome.processing_ms,
        first_partial_audio_ms: outcome
            .partials
            .first()
            .map(|partial| partial.utterance_duration_ms),
        utterance_count: None,
        partial_count: Some(outcome.partials.len()),
        stopped: outcome.stopped,
        errors: outcome.errors,
    }
}

#[test]
#[ignore = "needs the pinned 651 MiB Nemotron and 874 MiB multilingual Whisper models"]
fn nemotron_and_whisper_transcribe_every_enabled_language_without_translation() {
    let nemotron = require_nemotron_model();
    let whisper = require_multilingual_whisper_model();
    let mut failures = Vec::new();

    for fixture in fixtures() {
        let samples = audio::decode_wav_16k_mono(&fixture.path).expect("decode fixture");
        let nemotron_covers = covers_language(NEMOTRON_MODEL_ID, &fixture.language);
        if nemotron_covers {
            let result = nemotron_transcribe(&nemotron, &fixture.language, &samples);
            failures.extend(assess_quality(
                ModelRun {
                    engine: "Nemotron",
                    model_id: NEMOTRON_MODEL_ID,
                    model_name: "NVIDIA Nemotron 3.5 ASR Streaming 0.6B Int8",
                    selection: "manual",
                    result: &result,
                    performance_budget: PerformanceBudget::RealTimeFactor(
                        NEMOTRON_MAX_REALTIME_FACTOR,
                    ),
                },
                &fixture,
                samples.len(),
            ));
        }
        let result = whisper_transcribe(&whisper, &fixture.language, &samples);
        failures.extend(assess_quality(
            ModelRun {
                engine: "Whisper",
                model_id: MULTILINGUAL_WHISPER_MODEL_ID,
                model_name: "Whisper Large V3 Turbo Q8",
                selection: "manual",
                result: &result,
                performance_budget: PerformanceBudget::ProcessingDurationMs(
                    WHISPER_MANUAL_MAX_PROCESSING_MS,
                ),
            },
            &fixture,
            samples.len(),
        ));

        // Automatic detection is a separate capability. Exercising every
        // language prevents a detector fixed to one language from passing.
        if nemotron_covers {
            let result = nemotron_transcribe(&nemotron, "auto", &samples);
            failures.extend(assess_quality(
                ModelRun {
                    engine: "Nemotron auto",
                    model_id: NEMOTRON_MODEL_ID,
                    model_name: "NVIDIA Nemotron 3.5 ASR Streaming 0.6B Int8",
                    selection: "auto",
                    result: &result,
                    performance_budget: PerformanceBudget::RealTimeFactor(
                        NEMOTRON_MAX_REALTIME_FACTOR,
                    ),
                },
                &fixture,
                samples.len(),
            ));
        }
        let result = whisper_transcribe(&whisper, "auto", &samples);
        failures.extend(assess_quality(
            ModelRun {
                engine: "Whisper auto",
                model_id: MULTILINGUAL_WHISPER_MODEL_ID,
                model_name: "Whisper Large V3 Turbo Q8",
                selection: "auto",
                result: &result,
                performance_budget: PerformanceBudget::ProcessingDurationMs(
                    WHISPER_AUTO_MAX_PROCESSING_MS,
                ),
            },
            &fixture,
            samples.len(),
        ));
    }

    assert!(
        failures.is_empty(),
        "multilingual quality failures:\n  {}",
        failures.join("\n  ")
    );
}
