//! Optional machine-readable measurements from the model-backed acceptance
//! tests. Tests remain authoritative for pass/fail; setting
//! `STT_QUALITY_REPORT_PATH` additionally appends one JSON object per measured
//! fixture so CI and release tooling can render the same evidence for humans.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use serde::Serialize;

pub const REPORT_PATH_ENV: &str = "STT_QUALITY_REPORT_PATH";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityMeasurement<'a> {
    pub suite: &'a str,
    pub model_id: &'a str,
    pub model_name: &'a str,
    pub language: &'a str,
    pub selection: &'a str,
    pub fixture_id: &'a str,
    pub quality_metric: &'a str,
    pub quality_error_rate: f64,
    pub quality_budget: f64,
    pub audio_duration_ms: u64,
    pub processing_duration_ms: u64,
    pub real_time_factor: f64,
    pub real_time_factor_budget: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_partial_audio_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_partial_audio_budget_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub utterance_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_count: Option<usize>,
    pub passed: bool,
}

/// The on-disk line format: the schema version is `record`'s concern, not a
/// field every suite restates.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionedMeasurement<'a> {
    schema_version: u8,
    #[serde(flatten)]
    measurement: &'a QualityMeasurement<'a>,
}

pub fn record(measurement: &QualityMeasurement<'_>) {
    let Some(path) = std::env::var_os(REPORT_PATH_ENV).map(PathBuf::from) else {
        return;
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|error| {
            panic!(
                "create quality report directory {}: {error}",
                parent.display()
            )
        });
    }
    let mut output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .unwrap_or_else(|error| panic!("open quality report {}: {error}", path.display()));
    serde_json::to_writer(
        &mut output,
        &VersionedMeasurement {
            schema_version: 1,
            measurement,
        },
    )
    .unwrap_or_else(|error| panic!("serialize quality measurement: {error}"));
    output
        .write_all(b"\n")
        .unwrap_or_else(|error| panic!("write quality report {}: {error}", path.display()));
}

/// Locks the JSONL line shape consumed by
/// `scripts/lib/transcription-quality-report.mjs`: camelCase keys, a top-level
/// `schemaVersion`, and omitted (not null) optional fields.
#[test]
fn versioned_measurement_serializes_the_parser_contract() {
    let line = serde_json::to_value(VersionedMeasurement {
        schema_version: 1,
        measurement: &QualityMeasurement {
            suite: "suite",
            model_id: "model",
            model_name: "Model",
            language: "en",
            selection: "manual",
            fixture_id: "fixture",
            quality_metric: "wer",
            quality_error_rate: 0.1,
            quality_budget: 0.2,
            audio_duration_ms: 1_000,
            processing_duration_ms: 500,
            real_time_factor: 0.5,
            real_time_factor_budget: 1.0,
            first_partial_audio_ms: None,
            first_partial_audio_budget_ms: None,
            utterance_count: Some(1),
            partial_count: None,
            passed: true,
        },
    })
    .expect("measurement must serialize");

    assert_eq!(line["schemaVersion"], 1);
    assert_eq!(line["modelId"], "model");
    assert_eq!(line["realTimeFactorBudget"], 1.0);
    assert_eq!(line["utteranceCount"], 1);
    let object = line.as_object().expect("line must be a JSON object");
    assert!(!object.contains_key("firstPartialAudioMs"));
    assert!(!object.contains_key("partialCount"));
}
