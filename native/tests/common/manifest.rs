//! Loader for the reference corpus (`tests/fixtures/audio/manifest.json`).
//!
//! The corpus is the single source of truth for what each fixture should
//! transcribe to and how strictly to score it. The transcription suite is
//! data-driven over this file, so extending coverage is a manifest edit.

use std::path::PathBuf;

use serde::Deserialize;

use super::fixtures_dir;

#[derive(Debug, Deserialize)]
pub struct Corpus {
    pub fixtures: Vec<Fixture>,
}

#[derive(Debug, Deserialize)]
pub struct Fixture {
    /// Stable identifier, used in test output and to select a single fixture.
    pub id: String,
    /// Path to the audio file, relative to the fixtures directory.
    pub file: String,
    /// The text this clip should transcribe to.
    pub reference: String,
    /// Words that must appear in the output (case-insensitive), independent of
    /// the WER budget. A strong, model-version-tolerant regression guard.
    #[serde(default)]
    pub anchors: Vec<String>,
    /// Upper bound on the Word Error Rate for this clip.
    pub max_wer: f64,
    pub format: Format,
    pub source: Source,
}

#[derive(Debug, Deserialize)]
pub struct Format {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    #[serde(default)]
    pub approx_duration_ms: u64,
}

#[derive(Debug, Deserialize)]
pub struct Source {
    pub title: String,
    pub url: String,
    pub license: String,
    /// sha256 of the committed audio file, for integrity verification.
    pub sha256: String,
}

impl Corpus {
    /// Load and parse the bundled manifest. Panics with context on failure —
    /// a malformed manifest is a test-setup bug that should fail loudly.
    pub fn load() -> Self {
        let path = fixtures_dir().join("audio").join("manifest.json");
        let json = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read manifest {}: {error}", path.display()));
        serde_json::from_str(&json)
            .unwrap_or_else(|error| panic!("failed to parse manifest {}: {error}", path.display()))
    }
}

impl Fixture {
    /// Absolute path to this fixture's audio file.
    pub fn audio_path(&self) -> PathBuf {
        fixtures_dir().join(&self.file)
    }
}
