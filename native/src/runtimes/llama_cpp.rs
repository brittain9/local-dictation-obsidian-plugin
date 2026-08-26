use std::collections::HashMap;

use crate::engine::capabilities::{
    AcceleratorAvailability, AcceleratorId, ModelFormat, RuntimeCapabilities, RuntimeId,
};
use crate::engine::traits::Runtime;

pub struct LlamaCppRuntime {
    capabilities: RuntimeCapabilities,
}

impl LlamaCppRuntime {
    pub fn probe() -> Self {
        let mut details = HashMap::new();
        details.insert(AcceleratorId::Cpu, AcceleratorAvailability::available());
        #[cfg(feature = "gpu-metal")]
        details.insert(AcceleratorId::Metal, AcceleratorAvailability::available());
        #[cfg(feature = "gpu-cuda")]
        details.insert(AcceleratorId::Cuda, AcceleratorAvailability::available());
        Self {
            capabilities: RuntimeCapabilities::from_details(details, vec![ModelFormat::Gguf]),
        }
    }
}

impl Runtime for LlamaCppRuntime {
    fn id(&self) -> RuntimeId {
        RuntimeId::LlamaCpp
    }
    fn capabilities(&self) -> &RuntimeCapabilities {
        &self.capabilities
    }
}
