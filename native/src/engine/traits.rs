use std::path::Path;
use std::time::Duration;

use crate::engine::capabilities::{
    LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, RuntimeCapabilities, RuntimeId,
};
use crate::transcription::{
    EngineTranscriptOutput, GpuConfig, TranscriptionError, TranscriptionRequest, validate_language,
};

/// Execution-framework layer. Owns accelerator registration/probe and the
/// model-file formats it understands.
pub trait Runtime: Send + Sync {
    fn id(&self) -> RuntimeId;
    fn capabilities(&self) -> &RuntimeCapabilities;
}

/// Model-family layer. Owns graph I/O names, tokenizer, prompt tokens,
/// audio limits, and per-model probe rules.
pub trait ModelFamilyAdapter: Send + Sync {
    fn runtime_id(&self) -> RuntimeId;
    fn family_id(&self) -> ModelFamilyId;
    fn capabilities(&self) -> &ModelFamilyCapabilities;

    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError>;
    fn model_language_support(&self, _path: &Path) -> Result<LanguageSupport, TranscriptionError> {
        Ok(self.capabilities().supported_languages.clone())
    }
    fn probe_model_and_language_support(
        &self,
        path: &Path,
    ) -> Result<LanguageSupport, TranscriptionError> {
        self.probe_model(path)?;
        self.model_language_support(path)
    }
    fn load(&self, path: &Path, gpu: GpuConfig)
    -> Result<Box<dyn LoadedModel>, TranscriptionError>;

    fn load_streaming(
        &self,
        path: &Path,
        gpu: GpuConfig,
    ) -> Result<Box<dyn StreamingModel>, TranscriptionError> {
        let _ = (path, gpu);
        Err(TranscriptionError::unsupported_engine(format!(
            "{} does not support streaming",
            self.family_id().as_str()
        )))
    }
}

/// Per-session inference state. Holds session/context/tokenizer whatever the
/// adapter needs; only `transcribe` is contract. Adapters return raw engine
/// output (segments only); the worker wraps the output into a canonical
/// `Transcript` with stage history and identity.
pub trait LoadedModel: Send {
    fn transcribe(
        &mut self,
        request: &TranscriptionRequest,
    ) -> Result<EngineTranscriptOutput, TranscriptionError>;
}

/// Per-utterance incremental inference state. Implementations accept 16 kHz
/// mono PCM and reset after `finalize_utterance`.
pub trait StreamingModel: Send {
    /// Minimum audio and wall-clock progress between partial decode attempts.
    /// Models with a fixed encoder window can request a shorter poll interval
    /// without forcing more inference: their `partial` implementation remains
    /// responsible for returning cheaply until a window is ready.
    fn partial_cadence(&self) -> StreamingPartialCadence {
        StreamingPartialCadence::default()
    }

    fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError>;
    fn set_language(&mut self, language: &str) -> Result<(), TranscriptionError> {
        validate_language(language)
    }
    fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError>;
    fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError>;
    fn reset_utterance(&mut self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamingPartialCadence {
    pub min_audio_samples: usize,
    pub min_wall_time: Duration,
}

impl Default for StreamingPartialCadence {
    fn default() -> Self {
        Self {
            min_audio_samples: 8_000,
            min_wall_time: Duration::from_millis(500),
        }
    }
}
