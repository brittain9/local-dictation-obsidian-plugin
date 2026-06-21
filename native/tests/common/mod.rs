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
//! runs audio through the sidecar (in-process and as a real subprocess), and
//! [`score`] judges an outcome against a fixture's quality budget.
#![allow(dead_code)]

pub mod audio;
pub mod driver;
pub mod manifest;
pub mod model;
pub mod score;
pub mod text;

use std::path::PathBuf;

/// Absolute path to the crate root (`native/`), from `CARGO_MANIFEST_DIR`.
pub fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Absolute path to the test fixtures directory (`native/tests/fixtures`).
pub fn fixtures_dir() -> PathBuf {
    crate_dir().join("tests").join("fixtures")
}
