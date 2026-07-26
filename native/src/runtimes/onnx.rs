use std::collections::HashMap;
use std::path::Path;

use ort::session::Session;

use crate::engine::capabilities::{
    AcceleratorAvailability, AcceleratorId, ModelFormat, RuntimeCapabilities, RuntimeId,
};
use crate::engine::traits::Runtime;
use crate::transcription::{GpuConfig, TranscriptionError};

pub struct OnnxRuntime {
    capabilities: RuntimeCapabilities,
}

impl OnnxRuntime {
    pub fn probe() -> Self {
        let mut accelerator_details: HashMap<AcceleratorId, AcceleratorAvailability> =
            HashMap::new();

        accelerator_details.insert(AcceleratorId::Cpu, AcceleratorAvailability::available());

        Self {
            capabilities: RuntimeCapabilities::from_details(
                accelerator_details,
                vec![ModelFormat::Onnx],
            ),
        }
    }
}

impl Runtime for OnnxRuntime {
    fn id(&self) -> RuntimeId {
        RuntimeId::OnnxRuntime
    }

    fn capabilities(&self) -> &RuntimeCapabilities {
        &self.capabilities
    }
}

/// Build a CPU ONNX Runtime session for `model_path`.
///
/// Production ONNX execution is CPU-only. The tested ASR exports were unsafe or
/// slower under the generic CUDA EP because unsupported operators split
/// inference across CPU and GPU. Other families stay on CPU without an
/// unverified acceleration claim. A future accelerated backend must be enabled
/// per model family only after it proves a meaningful user benefit.
pub fn build_session(
    model_path: &Path,
    _gpu_config: GpuConfig,
) -> Result<Session, TranscriptionError> {
    Session::builder()
        .map_err(|e| TranscriptionError::transcription_failure("session builder", &e))?
        .commit_from_file(model_path)
        .map_err(|e| TranscriptionError::transcription_failure("model loading", &e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_runtime_advertises_cpu_only() {
        let runtime = OnnxRuntime::probe();
        let capabilities = runtime.capabilities();

        assert_eq!(
            capabilities.available_accelerators,
            vec![AcceleratorId::Cpu]
        );
        assert_eq!(
            capabilities
                .accelerator_details
                .keys()
                .copied()
                .collect::<Vec<_>>(),
            vec![AcceleratorId::Cpu]
        );
    }
}
