use std::path::Path;
use std::sync::LazyLock;

use crate::engine::capabilities::{
    LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, ModelTask, RuntimeId,
};
use crate::engine::traits::{LoadedModel, ModelFamilyAdapter};
use crate::transcription::{GpuConfig, TranscriptionError, validate_model_path};

/// Languages with a released Firefox translation direction in both directions.
///
/// Mozilla publishes the two halves of a language pair independently, so this
/// is narrower than the product vocabulary: `hr` and `sr` have a released
/// `en→` model but no released `→en` counterpart, and a one-way language is not
/// offered. The authoritative per-direction truth is `translationSupport` and
/// `translationPacks` in the catalog; this list only bounds what the family
/// advertises.
const TRANSLATION_LANGUAGE_TAGS: &[&str] = &[
    "en", "ar", "bg", "bn", "ca", "cs", "da", "de", "el", "es", "et", "eu", "fa", "fi", "fr", "gl",
    "gu", "he", "hi", "hu", "id", "is", "it", "ja", "kn", "ko", "lt", "lv", "ml", "mr", "ms", "nb",
    "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "ta", "te", "th", "tr", "uk", "ur", "vi", "zh",
    "zh-Hant",
];

#[derive(Default)]
pub struct FirefoxTranslationsAdapter;

static CAPABILITIES: LazyLock<ModelFamilyCapabilities> =
    LazyLock::new(|| ModelFamilyCapabilities {
        task: ModelTask::Translation,
        supports_hardware_acceleration: false,
        available_voices: Vec::new(),
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

impl ModelFamilyAdapter for FirefoxTranslationsAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::BergamotWasm
    }

    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::FirefoxTranslations
    }

    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }

    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        validate_model_path(path)
    }

    fn load(
        &self,
        _path: &Path,
        _gpu: GpuConfig,
    ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        Err(TranscriptionError::unsupported_engine(
            "Firefox Translations runs in the plugin's isolated WebAssembly worker.".to_string(),
        ))
    }
}
