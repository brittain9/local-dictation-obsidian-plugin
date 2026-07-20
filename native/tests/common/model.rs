//! Acquisition of a whisper model for the end-to-end suite.
//!
//! The model is the one heavyweight dependency the suite cannot commit. It is
//! sourced, in priority order, from an explicit local path, a verified cache, or
//! a download straight from the **bundled catalog** — so the test fetches the
//! exact pinned URL + sha256 the shipping app uses, with no duplicated metadata.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use local_dictation_sidecar::catalog::{CatalogModel, ModelCatalog};
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use sha2::{Digest, Sha256};

/// Smallest bundled whisper model — fast to download and load on CPU, which
/// keeps the suite cheap while still exercising the real inference path.
pub const TEST_MODEL_ID: &str = "whisper_tiny_en_q8_0";
pub const MULTILINGUAL_WHISPER_MODEL_ID: &str = "whisper_large_v3_turbo_q8_0";
pub const NEMOTRON_MODEL_ID: &str = "nemotron_asr_0_6b_int8_streaming_560ms";
pub const POCKET_TTS_MODEL_ID: &str = "pocket_tts_english_2026_04_int8";

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

pub fn require_multilingual_whisper_model() -> PathBuf {
    resolve_catalog_model(
        "STT_TEST_MULTILINGUAL_WHISPER_DIR",
        RuntimeId::WhisperCpp,
        ModelFamilyId::Whisper,
        MULTILINGUAL_WHISPER_MODEL_ID,
    )
    .unwrap_or_else(|error| {
        panic!(
            "could not obtain the multilingual Whisper model: {error}\n  Set \
             STT_TEST_MULTILINGUAL_WHISPER_DIR=/path/to/catalog/model/directory, or ensure \
             network access for the pinned catalog download."
        )
    })
}

#[derive(Clone, Copy, Debug)]
pub enum MoonshineTier {
    Tiny,
    Small,
}

impl MoonshineTier {
    pub fn model_id(self) -> &'static str {
        match self {
            Self::Tiny => "moonshine_tiny_streaming_en",
            Self::Small => "moonshine_small_streaming_en",
        }
    }
}

/// Resolve the `frontend.ort` entry point for a complete Moonshine model.
///
/// An explicit `STT_TEST_MOONSHINE_DIR` takes priority. Otherwise all catalog
/// artifacts are sha-verified and cached in a per-tier directory.
pub fn resolve_moonshine_model(tier: MoonshineTier) -> Result<PathBuf, String> {
    resolve_catalog_model(
        "STT_TEST_MOONSHINE_DIR",
        RuntimeId::OnnxRuntime,
        ModelFamilyId::Moonshine,
        tier.model_id(),
    )
}

pub fn require_moonshine_model(tier: MoonshineTier) -> PathBuf {
    resolve_moonshine_model(tier).unwrap_or_else(|error| {
        panic!(
            "could not obtain Moonshine {tier:?} assets: {error}\n  \
             Set STT_TEST_MOONSHINE_DIR=/path/to/dir (containing frontend.ort + siblings) \
             to reuse local assets, or ensure network access for the catalog download."
        )
    })
}

/// Resolve the exact Nemotron export from the shipping catalog. An explicit
/// directory and downloaded cache are both verified against every required
/// artifact hash before the model is used.
pub fn resolve_nemotron_model() -> Result<PathBuf, String> {
    static RESOLVED: OnceLock<Result<PathBuf, String>> = OnceLock::new();
    RESOLVED
        .get_or_init(|| {
            resolve_catalog_model(
                "STT_TEST_NEMOTRON_DIR",
                RuntimeId::OnnxRuntime,
                ModelFamilyId::NemotronAsr,
                NEMOTRON_MODEL_ID,
            )
        })
        .clone()
}

pub fn require_nemotron_model() -> PathBuf {
    resolve_nemotron_model().unwrap_or_else(|error| {
        panic!(
            "could not obtain the pinned Nemotron assets: {error}\n  \
             Set STT_TEST_NEMOTRON_DIR=/path/to/model to reuse verified local assets, or \
             ensure network access for the catalog download."
        )
    })
}

pub fn require_pocket_tts_model() -> PathBuf {
    require_pocket_tts_model_by_id(POCKET_TTS_MODEL_ID)
}

pub fn require_pocket_tts_model_by_id(model_id: &str) -> PathBuf {
    let directory_env = if model_id == POCKET_TTS_MODEL_ID {
        "POCKET_TTS_MODEL_DIR".to_string()
    } else {
        format!(
            "POCKET_TTS_{}_DIR",
            model_id
                .trim_start_matches("pocket_tts_")
                .to_ascii_uppercase()
        )
    };
    resolve_catalog_model(
        &directory_env,
        RuntimeId::OnnxRuntime,
        ModelFamilyId::PocketTts,
        model_id,
    )
    .unwrap_or_else(|error| {
        panic!(
            "could not obtain the pinned Pocket TTS assets for {model_id}: {error}\n  Set \
             {directory_env}=/path/to/model to reuse verified local assets, or ensure network \
             access for the pinned catalog download."
        )
    })
}

fn resolve_catalog_model(
    directory_env: &str,
    runtime_id: RuntimeId,
    family_id: ModelFamilyId,
    model_id: &str,
) -> Result<PathBuf, String> {
    let catalog =
        ModelCatalog::load_bundled().map_err(|error| format!("load catalog: {error:#}"))?;
    let model = catalog
        .find_model(runtime_id, family_id, model_id)
        .ok_or_else(|| format!("bundled catalog has no model {model_id}"))?;
    let explicit_dir = std::env::var_os(directory_env).map(PathBuf::from);
    let dir = explicit_dir
        .clone()
        .unwrap_or_else(|| cache_dir().join(model_id));

    if explicit_dir.is_some() {
        verify_catalog_artifacts(model, &dir)?;
    } else {
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("create {}: {error}", dir.display()))?;
        for artifact in model.artifacts.iter().filter(|artifact| artifact.required) {
            let destination = dir.join(&artifact.filename);
            let verified = destination.is_file()
                && file_sha256(&destination)
                    .is_ok_and(|digest| digest.eq_ignore_ascii_case(&artifact.sha256));
            if !verified {
                download_verified(&artifact.download_url, &artifact.sha256, &destination)?;
            }
        }
        verify_catalog_artifacts(model, &dir)?;
    }

    let primary = model
        .primary_artifact()
        .ok_or_else(|| format!("{model_id} declares no transcription artifact"))?;
    Ok(dir.join(&primary.filename))
}

fn verify_catalog_artifacts(model: &CatalogModel, dir: &Path) -> Result<(), String> {
    for artifact in model.artifacts.iter().filter(|artifact| artifact.required) {
        let path = dir.join(&artifact.filename);
        if !path.is_file() {
            return Err(format!(
                "required model artifact is missing: {}",
                path.display()
            ));
        }
        let actual = file_sha256(&path)?;
        if !actual.eq_ignore_ascii_case(&artifact.sha256) {
            return Err(format!(
                "sha256 mismatch for {}: expected {}, got {actual}",
                path.display(),
                artifact.sha256
            ));
        }
    }
    Ok(())
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

    let mut response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("build http client: {error}"))?
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("GET {url}: {error}"))?;

    let tmp = dest.with_extension("part");
    let mut file = std::fs::File::create(&tmp)
        .map_err(|error| format!("create {}: {error}", tmp.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("read body from {url}: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read])
            .map_err(|error| format!("write {}: {error}", tmp.display()))?;
    }
    file.sync_all()
        .map_err(|error| format!("flush {}: {error}", tmp.display()))?;

    let actual = hex(&hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "sha256 mismatch for {url}: expected {expected_sha256}, got {actual}"
        ));
    }

    if dest.exists() {
        std::fs::remove_file(dest)
            .map_err(|error| format!("remove invalid {}: {error}", dest.display()))?;
    }
    std::fs::rename(&tmp, dest)
        .map_err(|error| format!("rename into {}: {error}", dest.display()))?;
    Ok(())
}

/// Hex sha256 of a file's contents, streamed so a large model file is never read
/// fully into memory. Used to verify fixture integrity against the manifest, and
/// a cached model against the catalog.
pub fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|error| format!("open {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
