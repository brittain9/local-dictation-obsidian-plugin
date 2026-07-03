use std::path::Path;

use crate::engine::capabilities::{
    ModelFamilyCapabilities, ModelFamilyId, RuntimeCapabilities, RuntimeId,
};
use crate::transcription::{
    EngineTranscriptOutput, GpuConfig, TranscriptionError, TranscriptionRequest,
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
    fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError>;
    fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError>;
    fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError>;
    fn reset_utterance(&mut self);
}
