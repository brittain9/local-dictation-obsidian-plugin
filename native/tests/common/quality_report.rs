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
    pub schema_version: u8,
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

impl<'a> QualityMeasurement<'a> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        suite: &'a str,
        model_id: &'a str,
        model_name: &'a str,
        language: &'a str,
        selection: &'a str,
        fixture_id: &'a str,
        quality_metric: &'a str,
        quality_error_rate: f64,
        quality_budget: f64,
        audio_duration_ms: u64,
        processing_duration_ms: u64,
        real_time_factor_budget: f64,
    ) -> Self {
        Self {
            schema_version: 1,
            suite,
            model_id,
            model_name,
            language,
            selection,
            fixture_id,
            quality_metric,
            quality_error_rate,
            quality_budget,
            audio_duration_ms,
            processing_duration_ms,
            real_time_factor: processing_duration_ms as f64 / audio_duration_ms.max(1) as f64,
            real_time_factor_budget,
            first_partial_audio_ms: None,
            first_partial_audio_budget_ms: None,
            utterance_count: None,
            partial_count: None,
            passed: true,
        }
    }
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
    serde_json::to_writer(&mut output, measurement)
        .unwrap_or_else(|error| panic!("serialize quality measurement: {error}"));
    output
        .write_all(b"\n")
        .unwrap_or_else(|error| panic!("write quality report {}: {error}", path.display()));
}
