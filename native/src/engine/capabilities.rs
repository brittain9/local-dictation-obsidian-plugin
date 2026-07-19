use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Runtime identifier — the execution framework that loads and runs model files.
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeId {
    OnnxRuntime,
    WhisperCpp,
}

impl RuntimeId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OnnxRuntime => "onnx_runtime",
            Self::WhisperCpp => "whisper_cpp",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::OnnxRuntime => "ONNX Runtime",
            Self::WhisperCpp => "whisper.cpp",
        }
    }
}

/// Model-family identifier — architecture + graph I/O convention + tokenizer.
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelFamilyId {
    CohereTranscribe,
    Moonshine,
    NemotronAsr,
    PocketTts,
    Whisper,
}

impl ModelFamilyId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CohereTranscribe => "cohere_transcribe",
            Self::Moonshine => "moonshine",
            Self::NemotronAsr => "nemotron_asr",
            Self::PocketTts => "pocket_tts",
            Self::Whisper => "whisper",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::CohereTranscribe => "Cohere Transcribe",
            Self::Moonshine => "Moonshine",
            Self::NemotronAsr => "NVIDIA Nemotron 3.5 ASR",
            Self::PocketTts => "Pocket TTS",
            Self::Whisper => "Whisper",
        }
    }
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceleratorId {
    Cpu,
    Cuda,
    Metal,
    DirectMl,
}

impl AcceleratorId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cpu => "cpu",
            Self::Cuda => "cuda",
            Self::Metal => "metal",
            Self::DirectMl => "direct_ml",
        }
    }
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelFormat {
    Ggml,
    Gguf,
    Onnx,
}

/// Product task performed by a model family. This is part of both the catalog
/// and capability wire contracts; keeping it explicit prevents an STT model
/// from being routed into synthesis (or the inverse).
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelTask {
    Stt,
    Tts,
}

impl ModelTask {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stt => "stt",
            Self::Tts => "tts",
        }
    }
}

/// Language support for a model family adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LanguageSupport {
    All,
    List { tags: Vec<String> },
    EnglishOnly,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcceleratorAvailability {
    pub available: bool,
    #[serde(rename = "unavailableReason")]
    pub unavailable_reason: Option<String>,
}

impl AcceleratorAvailability {
    pub const fn available() -> Self {
        Self {
            available: true,
            unavailable_reason: None,
        }
    }

    pub const fn unavailable(reason: String) -> Self {
        Self {
            available: false,
            unavailable_reason: Some(reason),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeCapabilities {
    #[serde(rename = "availableAccelerators")]
    pub available_accelerators: Vec<AcceleratorId>,
    #[serde(rename = "acceleratorDetails")]
    pub accelerator_details: HashMap<AcceleratorId, AcceleratorAvailability>,
    #[serde(rename = "supportedModelFormats")]
    pub supported_model_formats: Vec<ModelFormat>,
}

impl RuntimeCapabilities {
    /// Build a capabilities struct from detail entries, deriving
    /// `available_accelerators` as the subset flagged `available`.
    pub fn from_details(
        accelerator_details: HashMap<AcceleratorId, AcceleratorAvailability>,
        supported_model_formats: Vec<ModelFormat>,
    ) -> Self {
        let available_accelerators = accelerator_details
            .iter()
            .filter_map(|(id, details)| details.available.then_some(*id))
            .collect();

        Self {
            available_accelerators,
            accelerator_details,
            supported_model_formats,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelFamilyCapabilities {
    pub task: ModelTask,
    #[serde(rename = "availableVoices")]
    pub available_voices: Vec<String>,
    #[serde(rename = "supportsSpeedControl")]
    pub supports_speed_control: bool,
    #[serde(rename = "outputSampleRate")]
    pub output_sample_rate: Option<u32>,
    #[serde(rename = "supportsSegmentTimestamps")]
    pub supports_segment_timestamps: bool,
    #[serde(rename = "supportsWordTimestamps")]
    pub supports_word_timestamps: bool,
    #[serde(rename = "supportsInitialPrompt")]
    pub supports_initial_prompt: bool,
    #[serde(rename = "supportsStreaming")]
    pub supports_streaming: bool,
    #[serde(rename = "supportsLanguageSelection")]
    pub supports_language_selection: bool,
    #[serde(rename = "supportsAutomaticLanguageDetection")]
    pub supports_automatic_language_detection: bool,
    #[serde(rename = "supportedLanguages")]
    pub supported_languages: LanguageSupport,
    #[serde(rename = "maxAudioDurationSecs")]
    pub max_audio_duration_secs: Option<f32>,
    #[serde(rename = "producesPunctuation")]
    pub produces_punctuation: bool,
}

impl ModelFamilyCapabilities {
    /// Conservative fallback used when the family is unknown (external-file
    /// selections whose runtime is compiled in but whose graph shape isn't
    /// declared by any registered adapter).
    pub const fn unknown() -> Self {
        Self {
            task: ModelTask::Stt,
            available_voices: Vec::new(),
            supports_speed_control: false,
            output_sample_rate: None,
            supports_segment_timestamps: false,
            supports_word_timestamps: false,
            supports_initial_prompt: false,
            supports_streaming: false,
            supports_language_selection: false,
            supports_automatic_language_detection: false,
            supported_languages: LanguageSupport::Unknown,
            max_audio_duration_secs: None,
            produces_punctuation: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_family_capabilities_are_conservative() {
        let unknown = ModelFamilyCapabilities::unknown();

        assert_eq!(unknown.task, ModelTask::Stt);
        assert!(unknown.available_voices.is_empty());
        assert!(!unknown.supports_speed_control);
        assert!(unknown.output_sample_rate.is_none());
        assert!(!unknown.supports_segment_timestamps);
        assert!(!unknown.supports_word_timestamps);
        assert!(!unknown.supports_initial_prompt);
        assert!(!unknown.supports_streaming);
        assert!(!unknown.supports_language_selection);
        assert!(!unknown.supports_automatic_language_detection);
        assert!(!unknown.produces_punctuation);
        assert!(unknown.max_audio_duration_secs.is_none());
        assert_eq!(unknown.supported_languages, LanguageSupport::Unknown);
    }

    // TypeScript declares both fields as `T | null`. Omission would surface as
    // `undefined` in JS and slip past `!== null` guards (capability-view would
    // call `Math.round(undefined)` -> NaN). Pin the wire contract here.

    #[test]
    fn model_family_capabilities_serializes_none_max_audio_duration_as_null() {
        let unknown = ModelFamilyCapabilities::unknown();
        let json = serde_json::to_value(&unknown).expect("capabilities should serialize");

        assert!(
            json["maxAudioDurationSecs"].is_null(),
            "maxAudioDurationSecs must serialize as JSON null, not be omitted: {json}"
        );
    }

    #[test]
    fn model_family_capabilities_serializes_streaming_flag() {
        let unknown = ModelFamilyCapabilities::unknown();
        let json = serde_json::to_value(&unknown).expect("capabilities should serialize");

        assert_eq!(json["supportsStreaming"], false);
        assert!(json.get("supports_streaming").is_none());
    }

    #[test]
    fn tts_family_capabilities_serialize_the_synthesis_contract() {
        let capabilities = ModelFamilyCapabilities {
            task: ModelTask::Tts,
            available_voices: vec!["alba".to_string(), "marius".to_string()],
            supports_speed_control: true,
            output_sample_rate: Some(24_000),
            supports_segment_timestamps: false,
            supports_word_timestamps: false,
            supports_initial_prompt: false,
            supports_streaming: true,
            supports_language_selection: false,
            supports_automatic_language_detection: false,
            supported_languages: LanguageSupport::EnglishOnly,
            max_audio_duration_secs: None,
            produces_punctuation: false,
        };

        let json = serde_json::to_value(capabilities).expect("capabilities should serialize");

        assert_eq!(json["task"], "tts");
        assert_eq!(
            json["availableVoices"],
            serde_json::json!(["alba", "marius"])
        );
        assert_eq!(json["supportsSpeedControl"], true);
        assert_eq!(json["outputSampleRate"], 24_000);
    }

    #[test]
    fn accelerator_availability_serializes_none_reason_as_null() {
        let available = AcceleratorAvailability::available();
        let json = serde_json::to_value(&available).expect("availability should serialize");

        assert!(
            json["unavailableReason"].is_null(),
            "unavailableReason must serialize as JSON null, not be omitted: {json}"
        );
    }
}

/// Merged capability view sent over the wire per selected model.
///
/// Today this is `RuntimeCapabilities ⊕ ModelFamilyCapabilities` — every model
/// in a family reports the same family caps. Per-model overrides are a planned
/// additive extension: a new optional field on this struct (e.g.
/// `modelOverrides`) that consumers default to merged family caps when absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineCapabilities {
    #[serde(rename = "runtimeId")]
    pub runtime_id: RuntimeId,
    #[serde(rename = "familyId")]
    pub family_id: ModelFamilyId,
    pub runtime: RuntimeCapabilities,
    pub family: ModelFamilyCapabilities,
}

/// Warning emitted when the worker drops a request field the adapter cannot
/// honor. Surfaces in the plugin dev console only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestWarning {
    pub field: String,
    pub reason: String,
}
