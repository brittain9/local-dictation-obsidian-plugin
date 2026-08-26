use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::LazyLock;

use crate::catalog::TRANSLATION_LANGUAGE_TAGS;
use crate::engine::capabilities::{
    LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, ModelTask, RuntimeId,
};
use crate::engine::traits::{LoadedModel, ModelFamilyAdapter};
use crate::transcription::{GpuConfig, TranscriptionError, validate_model_path};

pub struct TencentHyMtAdapter;
static CAPABILITIES: LazyLock<ModelFamilyCapabilities> =
    LazyLock::new(|| ModelFamilyCapabilities {
        task: ModelTask::Translation,
        supports_hardware_acceleration: cfg!(any(feature = "gpu-metal", feature = "gpu-cuda")),
        available_voices: vec![],
        supports_speed_control: false,
        output_sample_rate: None,
        supports_segment_timestamps: false,
        supports_word_timestamps: false,
        supports_initial_prompt: false,
        supports_streaming: false,
        supports_language_selection: true,
        supports_automatic_language_detection: false,
        supported_languages: LanguageSupport::List {
            tags: TRANSLATION_LANGUAGE_TAGS
                .iter()
                .map(|tag| (*tag).to_string())
                .collect(),
        },
        max_audio_duration_secs: None,
        produces_punctuation: true,
    });

impl ModelFamilyAdapter for TencentHyMtAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::LlamaCpp
    }
    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::TencentHyMt
    }
    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }
    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        validate_model_path(path)?;
        let mut magic = [0_u8; 4];
        File::open(path)
            .and_then(|mut file| file.read_exact(&mut magic))
            .map_err(|error| {
                TranscriptionError::invalid_model_with_details(format!(
                    "failed to read GGUF header: {error}"
                ))
            })?;
        if &magic != b"GGUF" {
            return Err(TranscriptionError::invalid_model(
                "file is not a GGUF model",
            ));
        }
        Ok(())
    }
    fn load(&self, _: &Path, _: GpuConfig) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        Err(TranscriptionError::unsupported_engine(
            "Tencent HY-MT 2 runs in the packaged translation helper.".to_string(),
        ))
    }
}
