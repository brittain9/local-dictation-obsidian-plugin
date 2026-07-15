//! Shared support code for the sidecar end-to-end quality suite.
//!
//! Integration tests in `tests/` each compile as their own crate and pull this
//! in with `mod common;`. Not every test binary uses every helper, so the
//! module is annotated `#![allow(dead_code)]` to avoid per-binary dead-code
//! warnings under `clippy --all-targets -D warnings`.
//!
//! Responsibilities are split by concern (SRP): [`audio`] decodes WAV fixtures
//! into the sidecar's PCM frame format, [`text`] scores transcripts, [`manifest`]
//! loads the reference corpus, [`model`] acquires a whisper model, [`driver`]
//! runs audio through the sidecar (in-process and as a real subprocess),
//! [`score`] judges an outcome against a fixture's quality budget, and
//! [`diarize`] builds multi-speaker scenarios and scores speaker clustering.
#![allow(dead_code)]

pub mod audio;
pub mod diarize;
pub mod driver;
pub mod manifest;
pub mod model;
pub mod quality_report;
pub mod score;
pub mod text;

use std::path::PathBuf;

use serde::Deserialize;

/// Absolute path to the crate root (`native/`), from `CARGO_MANIFEST_DIR`.
pub fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Absolute path to the test fixtures directory (`native/tests/fixtures`).
pub fn fixtures_dir() -> PathBuf {
    crate_dir().join("tests").join("fixtures")
}

#[derive(Debug, Deserialize)]
pub struct StreamingBudgets {
    pub tiers: std::collections::HashMap<String, StreamingTierBudget>,
    pub fixtures: Vec<StreamingFixtureBudget>,
}

#[derive(Debug, Deserialize)]
pub struct StreamingTierBudget {
    pub default_max_wer: f64,
}

#[derive(Debug, Deserialize)]
pub struct StreamingFixtureBudget {
    pub id: String,
    #[serde(default)]
    pub anchors: Vec<String>,
    #[serde(default)]
    pub max_wer: std::collections::HashMap<String, f64>,
}

impl StreamingBudgets {
    pub fn load() -> Self {
        let path = fixtures_dir().join("audio").join("streaming_budgets.json");
        let json = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "failed to read streaming budgets {}: {error}",
                path.display()
            )
        });
        serde_json::from_str(&json).unwrap_or_else(|error| {
            panic!(
                "failed to parse streaming budgets {}: {error}",
                path.display()
            )
        })
    }

    pub fn fixture(&self, fixture_id: &str) -> &StreamingFixtureBudget {
        self.fixtures
            .iter()
            .find(|fixture| fixture.id == fixture_id)
            .unwrap_or_else(|| panic!("no streaming budget for fixture {fixture_id}"))
    }

    pub fn max_wer(&self, tier: &str, fixture_id: &str) -> f64 {
        self.fixture(fixture_id)
            .max_wer
            .get(tier)
            .copied()
            .unwrap_or_else(|| {
                self.tiers
                    .get(tier)
                    .unwrap_or_else(|| panic!("no streaming budget tier {tier}"))
                    .default_max_wer
            })
    }
}
