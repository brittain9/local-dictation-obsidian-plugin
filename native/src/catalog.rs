use std::collections::{HashMap, HashSet};
use std::path::{Component, Path};

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};

use crate::engine::capabilities::{ModelFamilyId, ModelTask, RuntimeId};
use crate::transcription::VERIFIED_MULTILINGUAL_LANGUAGE_TAGS;

const BUNDLED_CATALOG_JSON: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/catalog.json"));

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelCatalog {
    #[serde(rename = "catalogVersion")]
    pub catalog_version: u32,
    pub collections: Vec<ModelCollection>,
    pub runtimes: Vec<ModelRuntimeDescriptor>,
    pub families: Vec<ModelFamilyDescriptor>,
    pub models: Vec<CatalogModel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelRuntimeDescriptor {
    #[serde(rename = "runtimeId")]
    pub runtime_id: RuntimeId,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelFamilyDescriptor {
    #[serde(rename = "familyId")]
    pub family_id: ModelFamilyId,
    #[serde(rename = "runtimeId")]
    pub runtime_id: RuntimeId,
    pub task: ModelTask,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelCollection {
    #[serde(rename = "collectionId")]
    pub collection_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogModel {
    pub artifacts: Vec<ModelArtifact>,
    #[serde(rename = "collectionId")]
    pub collection_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "runtimeId")]
    pub runtime_id: RuntimeId,
    #[serde(rename = "familyId")]
    pub family_id: ModelFamilyId,
    pub task: ModelTask,
    #[serde(rename = "languageTags")]
    pub language_tags: Vec<String>,
    #[serde(default, rename = "supportsAutomaticLanguageDetection")]
    pub supports_automatic_language_detection: bool,
    #[serde(default, rename = "defaultVoice")]
    pub default_voice: Option<String>,
    #[serde(rename = "licenseLabel")]
    pub license_label: String,
    #[serde(rename = "licenseUrl")]
    pub license_url: String,
    #[serde(rename = "modelCardUrl")]
    pub model_card_url: Option<String>,
    #[serde(rename = "modelId")]
    pub model_id: String,
    pub notes: Vec<String>,
    #[serde(rename = "sourceUrl")]
    pub source_url: String,
    pub summary: String,
    #[serde(rename = "uxTags")]
    pub ux_tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelArtifact {
    #[serde(rename = "artifactId")]
    pub artifact_id: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
    pub filename: String,
    pub required: bool,
    pub role: ArtifactRole,
    #[serde(default, rename = "voiceId")]
    pub voice_id: Option<String>,
    pub sha256: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactRole {
    SupportingFile,
    SynthesisModel,
    TranscriptionModel,
    Voice,
}

impl ModelCatalog {
    pub fn load_bundled() -> Result<Self> {
        let catalog: Self = serde_json::from_str(BUNDLED_CATALOG_JSON)
            .context("failed to parse bundled model catalog")?;
        catalog.validate()?;
        Ok(catalog)
    }

    pub fn find_model(
        &self,
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        model_id: &str,
    ) -> Option<&CatalogModel> {
        self.models.iter().find(|model| {
            model.runtime_id == runtime_id
                && model.family_id == family_id
                && model.model_id == model_id
        })
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.catalog_version > 0,
            "catalogVersion must be a positive integer"
        );

        let mut runtime_ids = HashSet::new();
        for runtime in &self.runtimes {
            ensure!(
                runtime_ids.insert(runtime.runtime_id),
                "duplicate runtimeId {}",
                runtime.runtime_id.as_str()
            );
            ensure!(
                !runtime.display_name.trim().is_empty(),
                "runtime displayName must not be empty"
            );
        }

        let mut family_tasks = HashMap::new();
        for family in &self.families {
            ensure!(
                runtime_ids.contains(&family.runtime_id),
                "family {} references unknown runtimeId {}",
                family.family_id.as_str(),
                family.runtime_id.as_str()
            );
            ensure!(
                family_tasks
                    .insert((family.runtime_id, family.family_id), family.task)
                    .is_none(),
                "duplicate family pair ({}, {})",
                family.runtime_id.as_str(),
                family.family_id.as_str()
            );
            ensure!(
                !family.display_name.trim().is_empty(),
                "family displayName must not be empty"
            );
        }

        let mut collection_ids = HashSet::new();

        for collection in &self.collections {
            ensure!(
                collection_ids.insert(collection.collection_id.clone()),
                "duplicate collectionId {}",
                collection.collection_id
            );
            ensure!(
                !collection.display_name.trim().is_empty(),
                "collection displayName must not be empty"
            );
        }

        let mut model_keys = HashSet::new();

        for model in &self.models {
            ensure!(
                family_tasks.contains_key(&(model.runtime_id, model.family_id)),
                "model {} references unknown (runtimeId, familyId) ({}, {})",
                model.model_id,
                model.runtime_id.as_str(),
                model.family_id.as_str()
            );
            let family_task = family_tasks[&(model.runtime_id, model.family_id)];
            ensure!(
                model.task == family_task,
                "model {} task {} does not match family task {}",
                model.model_id,
                model.task.as_str(),
                family_task.as_str()
            );
            ensure!(
                collection_ids.contains(&model.collection_id),
                "model {} references unknown collectionId {}",
                model.model_id,
                model.collection_id
            );
            ensure!(
                !model.language_tags.is_empty(),
                "model {} must declare at least one languageTag",
                model.model_id
            );
            let mut language_tags = HashSet::new();
            for tag in &model.language_tags {
                ensure!(
                    VERIFIED_MULTILINGUAL_LANGUAGE_TAGS.contains(&tag.as_str()),
                    "model {} declares unsupported languageTag {}",
                    model.model_id,
                    tag
                );
                ensure!(
                    language_tags.insert(tag),
                    "model {} declares duplicate languageTag {}",
                    model.model_id,
                    tag
                );
            }
            ensure!(
                model_keys.insert((model.runtime_id, model.family_id, model.model_id.clone())),
                "duplicate modelId {} for ({}, {})",
                model.model_id,
                model.runtime_id.as_str(),
                model.family_id.as_str()
            );

            let mut artifact_ids = HashSet::new();
            let primary_role = match model.task {
                ModelTask::Stt => ArtifactRole::TranscriptionModel,
                ModelTask::Tts => ArtifactRole::SynthesisModel,
            };
            let mut has_primary_artifact = false;
            let mut voice_ids = HashSet::new();

            for artifact in &model.artifacts {
                ensure!(
                    artifact_ids.insert(artifact.artifact_id.clone()),
                    "duplicate artifactId {} for model {}",
                    artifact.artifact_id,
                    model.model_id
                );
                ensure!(
                    artifact.size_bytes > 0,
                    "artifact {} for model {} must have a positive sizeBytes",
                    artifact.artifact_id,
                    model.model_id
                );
                ensure!(
                    is_valid_sha256(&artifact.sha256),
                    "artifact {} for model {} has an invalid sha256",
                    artifact.artifact_id,
                    model.model_id
                );
                ensure!(
                    artifact.download_url.starts_with("https://"),
                    "artifact {} for model {} must use an https downloadUrl",
                    artifact.artifact_id,
                    model.model_id
                );
                ensure!(
                    is_safe_relative_path(&artifact.filename),
                    "artifact {} for model {} must use a safe relative filename",
                    artifact.artifact_id,
                    model.model_id
                );

                if artifact.required && artifact.role == primary_role {
                    has_primary_artifact = true;
                }

                match (&artifact.role, &artifact.voice_id) {
                    (ArtifactRole::Voice, Some(voice_id)) => {
                        ensure!(
                            !voice_id.trim().is_empty(),
                            "voice artifact {} for model {} must declare a non-empty voiceId",
                            artifact.artifact_id,
                            model.model_id
                        );
                        ensure!(
                            voice_ids.insert(voice_id.as_str()),
                            "model {} declares duplicate voiceId {}",
                            model.model_id,
                            voice_id
                        );
                    }
                    (ArtifactRole::Voice, None) => {
                        ensure!(
                            false,
                            "voice artifact {} for model {} must declare a voiceId",
                            artifact.artifact_id,
                            model.model_id
                        );
                    }
                    (_, Some(_)) => {
                        ensure!(
                            false,
                            "non-voice artifact {} for model {} must not declare a voiceId",
                            artifact.artifact_id,
                            model.model_id
                        );
                    }
                    (_, None) => {}
                }
            }

            match model.task {
                ModelTask::Stt => {
                    ensure!(
                        has_primary_artifact,
                        "model {} must declare a required transcription artifact",
                        model.model_id
                    );
                    ensure!(
                        model.default_voice.is_none(),
                        "STT model {} must not declare a default voice",
                        model.model_id
                    );
                }
                ModelTask::Tts => {
                    ensure!(
                        has_primary_artifact,
                        "model {} must declare a required synthesis artifact",
                        model.model_id
                    );
                    let default_voice = model.default_voice.as_deref().ok_or_else(|| {
                        anyhow::anyhow!("TTS model {} must declare a default voice", model.model_id)
                    })?;
                    ensure!(
                        voice_ids.contains(default_voice),
                        "model {} default voice {} does not reference a voice artifact",
                        model.model_id,
                        default_voice
                    );
                }
            }
        }

        Ok(())
    }
}

impl CatalogModel {
    pub fn required_download_bytes(&self) -> u64 {
        self.artifacts
            .iter()
            .filter(|artifact| artifact.required)
            .map(|artifact| artifact.size_bytes)
            .sum()
    }

    pub fn primary_artifact(&self) -> Option<&ModelArtifact> {
        let primary_role = match self.task {
            ModelTask::Stt => ArtifactRole::TranscriptionModel,
            ModelTask::Tts => ArtifactRole::SynthesisModel,
        };
        self.artifacts
            .iter()
            .find(|artifact| artifact.required && artifact.role == primary_role)
    }
}

fn is_safe_relative_path(value: &str) -> bool {
    let path = Path::new(value);

    if path.is_absolute() {
        return false;
    }

    let mut has_normal_component = false;

    for component in path.components() {
        match component {
            Component::Normal(_) => has_normal_component = true,
            Component::CurDir => continue,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return false,
        }
    }

    has_normal_component
}

fn is_valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::{
        ArtifactRole, CatalogModel, ModelArtifact, ModelCatalog, ModelCollection,
        ModelFamilyDescriptor, ModelRuntimeDescriptor,
    };
    use crate::engine::capabilities::{ModelFamilyId, ModelTask, RuntimeId};

    #[test]
    fn bundled_catalog_is_valid() {
        ModelCatalog::load_bundled().expect("bundled catalog should parse and validate");
    }

    #[test]
    fn bundled_nemotron_model_is_pinned_and_within_footprint_gate() {
        let catalog = ModelCatalog::load_bundled().expect("bundled catalog should load");
        let model = catalog
            .find_model(
                RuntimeId::OnnxRuntime,
                ModelFamilyId::NemotronAsr,
                "nemotron_asr_0_6b_int8_streaming_560ms",
            )
            .expect("Nemotron 3.5 ASR 560 ms model should be cataloged");

        assert_eq!(model.license_label, "OpenMDW-1.1");
        assert_eq!(model.artifacts.len(), 4);
        assert!(model.artifacts.iter().all(|artifact| {
            artifact
                .download_url
                .contains("ab43d895f5985b1bbab8b6eac8607fcdc05343f3")
        }));
        assert_eq!(model.required_download_bytes(), 682_215_356);
        assert!(model.required_download_bytes() <= 700 * 1024 * 1024);
        assert_eq!(
            model
                .primary_artifact()
                .map(|artifact| artifact.filename.as_str()),
            Some("encoder.int8.onnx")
        );
    }

    #[test]
    fn bundled_pocket_tts_models_cover_six_languages_and_expose_curated_voices() {
        let catalog = ModelCatalog::load_bundled().expect("bundled catalog should load");
        let expected = [
            ("pocket_tts_english_2026_04_int8", "en", 131_654_174),
            ("pocket_tts_french_24l_int8", "fr", 379_059_244),
            ("pocket_tts_german_int8", "de", 131_654_653),
            ("pocket_tts_spanish_int8", "es", 131_655_714),
            ("pocket_tts_portuguese_int8", "pt", 131_655_820),
            ("pocket_tts_italian_int8", "it", 131_654_897),
        ];

        for (model_id, language, required_bytes) in expected {
            let model = catalog
                .find_model(RuntimeId::OnnxRuntime, ModelFamilyId::PocketTts, model_id)
                .unwrap_or_else(|| panic!("Pocket TTS model {model_id} should be cataloged"));

            assert_eq!(model.task, ModelTask::Tts);
            assert_eq!(model.language_tags, [language]);
            assert_eq!(model.default_voice.as_deref(), Some("alba"));
            assert_eq!(model.required_download_bytes(), required_bytes);
            assert_eq!(
                model
                    .artifacts
                    .iter()
                    .filter_map(|artifact| artifact.voice_id.as_deref())
                    .collect::<Vec<_>>(),
                ["alba", "cosette", "fantine", "javert", "jean", "marius"]
            );
        }

        let french = catalog
            .find_model(
                RuntimeId::OnnxRuntime,
                ModelFamilyId::PocketTts,
                "pocket_tts_french_24l_int8",
            )
            .expect("Pocket TTS French should be cataloged");
        assert_eq!(
            french
                .artifacts
                .iter()
                .filter(|artifact| artifact.role == ArtifactRole::Voice && artifact.required)
                .filter_map(|artifact| artifact.voice_id.as_deref())
                .collect::<Vec<_>>(),
            ["alba"]
        );
        assert!(french.ux_tags.iter().any(|tag| tag == "high-cpu"));
        assert!(french.ux_tags.iter().any(|tag| tag == "may-buffer"));
    }

    #[test]
    fn bundled_supertonic_model_exposes_current_languages_and_optional_voice_pack() {
        let catalog = ModelCatalog::load_bundled().expect("bundled catalog should load");
        let model = catalog
            .find_model(
                RuntimeId::OnnxRuntime,
                ModelFamilyId::Supertonic,
                "supertonic_3_multilingual_2026_05",
            )
            .expect("Supertonic 3 multilingual model should be cataloged");

        assert_eq!(model.task, ModelTask::Tts);
        assert_eq!(
            model.language_tags,
            ["en", "es", "de", "fr", "pt", "it", "nl", "ja"]
        );
        assert_eq!(model.default_voice.as_deref(), Some("F1"));
        assert_eq!(model.license_label, "OpenRAIL-M");
        assert!(model.required_download_bytes() <= 400 * 1024 * 1024);
        assert!(model.artifacts.iter().all(|artifact| {
            artifact
                .download_url
                .contains("3cadd1ee6394adea1bd021217a0e650ede09a323")
        }));
        assert_eq!(
            model
                .primary_artifact()
                .map(|artifact| artifact.filename.as_str()),
            Some("onnx/vector_estimator.onnx")
        );
        assert_eq!(
            model
                .artifacts
                .iter()
                .filter(|artifact| artifact.role == ArtifactRole::Voice && artifact.required)
                .filter_map(|artifact| artifact.voice_id.as_deref())
                .collect::<Vec<_>>(),
            ["F1"]
        );
        assert_eq!(
            model
                .artifacts
                .iter()
                .filter_map(|artifact| artifact.voice_id.as_deref())
                .collect::<Vec<_>>(),
            ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]
        );
    }

    #[test]
    fn validate_rejects_duplicate_runtime_ids() {
        let error = ModelCatalog {
            catalog_version: 2,
            collections: vec![sample_collection()],
            runtimes: vec![sample_runtime(), sample_runtime()],
            families: vec![sample_family()],
            models: vec![sample_model()],
        }
        .validate()
        .expect_err("catalog should fail");

        assert!(error.to_string().contains("duplicate runtimeId"));
    }

    #[test]
    fn validate_rejects_invalid_artifact_paths() {
        let mut model = sample_model();
        model.artifacts[0].filename = "../model.bin".to_string();

        let error = ModelCatalog {
            catalog_version: 2,
            collections: vec![sample_collection()],
            runtimes: vec![sample_runtime()],
            families: vec![sample_family()],
            models: vec![model],
        }
        .validate()
        .expect_err("catalog should fail");

        assert!(
            error
                .to_string()
                .contains("must use a safe relative filename")
        );
    }

    #[test]
    fn validate_rejects_unknown_or_duplicate_language_tags() {
        for tags in [
            vec!["xx".to_string()],
            vec!["en".to_string(), "en".to_string()],
        ] {
            let mut model = sample_model();
            model.language_tags = tags;
            let error = ModelCatalog {
                catalog_version: 2,
                collections: vec![sample_collection()],
                runtimes: vec![sample_runtime()],
                families: vec![sample_family()],
                models: vec![model],
            }
            .validate()
            .expect_err("catalog should reject invalid language tags");

            assert!(error.to_string().contains("languageTag"));
        }
    }

    #[test]
    fn validate_rejects_model_and_family_task_mismatch() {
        let mut model = sample_model();
        model.task = ModelTask::Tts;

        let error = ModelCatalog {
            catalog_version: 4,
            collections: vec![sample_collection()],
            runtimes: vec![sample_runtime()],
            families: vec![sample_family()],
            models: vec![model],
        }
        .validate()
        .expect_err("catalog should reject a task mismatch");

        assert!(error.to_string().contains("task tts"));
        assert!(error.to_string().contains("family task stt"));
    }

    #[test]
    fn validate_requires_a_tts_primary_artifact_and_declared_default_voice() {
        let mut family = sample_family();
        family.task = ModelTask::Tts;
        let mut model = sample_model();
        model.task = ModelTask::Tts;
        model.default_voice = Some("alba".to_string());

        let missing_synthesis = ModelCatalog {
            catalog_version: 4,
            collections: vec![sample_collection()],
            runtimes: vec![sample_runtime()],
            families: vec![family.clone()],
            models: vec![model.clone()],
        }
        .validate()
        .expect_err("TTS model should require a synthesis artifact");
        assert!(missing_synthesis.to_string().contains("synthesis artifact"));

        model.artifacts = vec![
            ModelArtifact {
                artifact_id: "synthesis".to_string(),
                download_url: "https://example.com/model.onnx".to_string(),
                filename: "model.onnx".to_string(),
                required: true,
                role: ArtifactRole::SynthesisModel,
                voice_id: None,
                sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    .to_string(),
                size_bytes: 10,
            },
            ModelArtifact {
                artifact_id: "voice_marius".to_string(),
                download_url: "https://example.com/marius.safetensors".to_string(),
                filename: "embeddings/marius.safetensors".to_string(),
                required: false,
                role: ArtifactRole::Voice,
                voice_id: Some("marius".to_string()),
                sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
                    .to_string(),
                size_bytes: 10,
            },
        ];

        let missing_default = ModelCatalog {
            catalog_version: 4,
            collections: vec![sample_collection()],
            runtimes: vec![sample_runtime()],
            families: vec![family],
            models: vec![model],
        }
        .validate()
        .expect_err("default voice should reference a voice artifact");
        assert!(missing_default.to_string().contains("default voice alba"));
    }

    fn sample_runtime() -> ModelRuntimeDescriptor {
        ModelRuntimeDescriptor {
            runtime_id: RuntimeId::WhisperCpp,
            display_name: "whisper.cpp".to_string(),
            summary: "summary".to_string(),
        }
    }

    fn sample_family() -> ModelFamilyDescriptor {
        ModelFamilyDescriptor {
            family_id: ModelFamilyId::Whisper,
            runtime_id: RuntimeId::WhisperCpp,
            task: ModelTask::Stt,
            display_name: "Whisper".to_string(),
            summary: "summary".to_string(),
        }
    }

    fn sample_collection() -> ModelCollection {
        ModelCollection {
            collection_id: "english".to_string(),
            display_name: "English".to_string(),
            summary: "summary".to_string(),
        }
    }

    fn sample_model() -> CatalogModel {
        CatalogModel {
            artifacts: vec![ModelArtifact {
                artifact_id: "transcription".to_string(),
                download_url: "https://example.com/model.bin".to_string(),
                filename: "model.bin".to_string(),
                required: true,
                role: ArtifactRole::TranscriptionModel,
                voice_id: None,
                sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    .to_string(),
                size_bytes: 10,
            }],
            collection_id: "english".to_string(),
            display_name: "Model".to_string(),
            runtime_id: RuntimeId::WhisperCpp,
            family_id: ModelFamilyId::Whisper,
            task: ModelTask::Stt,
            language_tags: vec!["en".to_string()],
            supports_automatic_language_detection: false,
            default_voice: None,
            license_label: "MIT".to_string(),
            license_url: "https://example.com/license".to_string(),
            model_card_url: None,
            model_id: "model".to_string(),
            notes: vec![],
            source_url: "https://example.com".to_string(),
            summary: "summary".to_string(),
            ux_tags: vec![],
        }
    }
}
