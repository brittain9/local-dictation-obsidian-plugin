use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelperAcceleratorId {
    Cuda,
    DirectMl,
    Metal,
    Vulkan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum HelperCommand {
    Translate {
        translation_id: String,
        model_path: PathBuf,
        source_language: String,
        target_language: String,
        texts: Vec<String>,
        accelerator: Option<HelperAcceleratorId>,
    },
    Cancel {
        translation_id: String,
    },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum HelperEvent {
    Ready {
        helper_version: String,
    },
    Started {
        translation_id: String,
        total: usize,
    },
    Progress {
        translation_id: String,
        completed: usize,
        total: usize,
    },
    Complete {
        translation_id: String,
        translations: Vec<String>,
    },
    Cancelled {
        translation_id: String,
    },
    Error {
        translation_id: String,
        code: String,
        message: String,
    },
}
