use std::collections::HashMap;

use crate::engine::capabilities::{
    AcceleratorAvailability, AcceleratorId, ModelFormat, RuntimeCapabilities, RuntimeId,
};
use crate::engine::traits::Runtime;

pub struct BergamotWasmRuntime {
    capabilities: RuntimeCapabilities,
}

impl BergamotWasmRuntime {
    pub fn probe() -> Self {
        let mut accelerator_details = HashMap::new();
        accelerator_details.insert(AcceleratorId::Cpu, AcceleratorAvailability::available());

        Self {
            capabilities: RuntimeCapabilities::from_details(
                accelerator_details,
                vec![ModelFormat::Bergamot],
            ),
        }
    }
}

impl Runtime for BergamotWasmRuntime {
    fn id(&self) -> RuntimeId {
        RuntimeId::BergamotWasm
    }

    fn capabilities(&self) -> &RuntimeCapabilities {
        &self.capabilities
    }
}
