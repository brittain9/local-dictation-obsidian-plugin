//! Acquisition of a whisper model for the end-to-end suite.
//!
//! The model is the one heavyweight dependency the suite cannot commit. It is
//! sourced, in priority order, from an explicit local path, a verified cache, or
//! a download straight from the **bundled catalog** — so the test fetches the
//! exact pinned URL + sha256 the shipping app uses, with no duplicated metadata.

use std::path::{Path, PathBuf};
use std::time::Duration;

use local_dictation_sidecar::catalog::ModelCatalog;
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use sha2::{Digest, Sha256};

/// Smallest bundled whisper model — fast to download and load on CPU, which
/// keeps the suite cheap while still exercising the real inference path.
pub const TEST_MODEL_ID: &str = "whisper_tiny_en_q8_0";

/// Resolve a whisper model file for the suite. In priority order:
/// 1. `STT_TEST_WHISPER_MODEL` — explicit path to an existing model.
/// 2. A cached download under `STT_TEST_MODEL_DIR` (default: a temp subdir),
///    integrity-checked by sha256 and reused across runs.
/// 3. A fresh download from the bundled catalog's pinned URL, verified + cached.
pub fn resolve_whisper_model() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("STT_TEST_WHISPER_MODEL") {
        let path = PathBuf::from(path);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!(
                "STT_TEST_WHISPER_MODEL points at a missing file: {}",
                path.display()
            ))
        };
    }

    let catalog =
        ModelCatalog::load_bundled().map_err(|error| format!("load catalog: {error:#}"))?;
    let model = catalog
        .find_model(RuntimeId::WhisperCpp, ModelFamilyId::Whisper, TEST_MODEL_ID)
        .ok_or_else(|| format!("bundled catalog has no model {TEST_MODEL_ID}"))?;
    let artifact = model
        .primary_artifact()
        .ok_or_else(|| format!("{TEST_MODEL_ID} declares no transcription artifact"))?;

    let cached = cache_dir().join(&artifact.filename);
    if cached.is_file()
        && file_sha256(&cached).is_ok_and(|digest| digest.eq_ignore_ascii_case(&artifact.sha256))
    {
        return Ok(cached);
    }

    download_verified(&artifact.download_url, &artifact.sha256, &cached)?;
    Ok(cached)
}

/// Like [`resolve_whisper_model`] but panics with actionable guidance. The
/// `#[ignore]`d tests use this: the caller explicitly opted into the heavy
/// suite, so a missing model is a hard failure, not a silent skip.
pub fn require_whisper_model() -> PathBuf {
    resolve_whisper_model().unwrap_or_else(|error| {
        panic!(
            "could not obtain a whisper model for the e2e suite: {error}\n  \
             Set STT_TEST_WHISPER_MODEL=/path/to/ggml-model.bin to reuse a local model, or \
             ensure network access so the bundled catalog model can be downloaded."
        )
    })
}

fn cache_dir() -> PathBuf {
    std::env::var_os("STT_TEST_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("local-dictation-sidecar-test-models"))
}

fn download_verified(url: &str, expected_sha256: &str, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create cache dir: {error}"))?;
    }

    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("build http client: {error}"))?
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("GET {url}: {error}"))?;

    let bytes = response
        .bytes()
        .map_err(|error| format!("read body from {url}: {error}"))?;

    let actual = sha256_hex(&bytes);
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!(
            "sha256 mismatch for {url}: expected {expected_sha256}, got {actual}"
        ));
    }

    // Write to a temp sibling then rename, so an aborted run never leaves a
    // half-written file that a later run's existence check would trust.
    let tmp = dest.with_extension("part");
    std::fs::write(&tmp, &bytes).map_err(|error| format!("write {}: {error}", tmp.display()))?;
    std::fs::rename(&tmp, dest)
        .map_err(|error| format!("rename into {}: {error}", dest.display()))?;
    Ok(())
}

/// Hex sha256 of a file's contents. Used to verify fixture integrity against
/// the manifest, and a cached model against the catalog.
pub fn file_sha256(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    Ok(sha256_hex(&bytes))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
