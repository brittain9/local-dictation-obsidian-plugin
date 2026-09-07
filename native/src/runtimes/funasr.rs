use std::collections::HashMap;
use std::env;
#[cfg(target_os = "linux")]
use std::fs::{self, OpenOptions};
#[cfg(target_os = "linux")]
use std::os::unix::fs::FileTypeExt;
use std::path::PathBuf;
use std::process::Command;

use crate::engine::capabilities::{
    AcceleratorAvailability, AcceleratorId, ModelFormat, RuntimeCapabilities, RuntimeId,
};
use crate::engine::traits::Runtime;

pub const SENSEVOICE_HELPER_BASENAME: &str = "llama-funasr-sensevoice";
pub const NANO_HELPER_BASENAME: &str = "llama-funasr-cli";
pub const AUDIO_CPP_HELPER_BASENAME: &str = "audiocpp_cli";

pub struct FunasrRuntime {
    capabilities: RuntimeCapabilities,
}

impl FunasrRuntime {
    pub fn probe() -> Self {
        let mut details = HashMap::new();
        details.insert(AcceleratorId::Cpu, AcceleratorAvailability::available());

        #[cfg(target_os = "linux")]
        details.insert(
            AcceleratorId::Vulkan,
            match vulkan_ready() {
                true => AcceleratorAvailability::available(),
                false => AcceleratorAvailability::unavailable(
                    "The packaged FunASR Vulkan helper, Vulkan loader, or an accessible hardware render device is unavailable."
                        .to_string(),
                ),
            },
        );
        Self {
            capabilities: RuntimeCapabilities::from_details(
                details,
                vec![ModelFormat::Gguf, ModelFormat::Onnx],
            ),
        }
    }
}

impl Runtime for FunasrRuntime {
    fn id(&self) -> RuntimeId {
        RuntimeId::FunasrLlamaCpp
    }

    fn capabilities(&self) -> &RuntimeCapabilities {
        &self.capabilities
    }
}

/// The official FunASR release helper is shipped beside the native sidecar.
/// Keeping this lookup relative to the executable also supports an explicit
/// sidecar-path override without relying on a global installation.
pub fn sensevoice_helper_path() -> Option<PathBuf> {
    helper_path(SENSEVOICE_HELPER_BASENAME)
}

pub fn nano_helper_path() -> Option<PathBuf> {
    helper_path(NANO_HELPER_BASENAME)
}

pub fn audio_cpp_helper_path() -> Option<PathBuf> {
    helper_path(AUDIO_CPP_HELPER_BASENAME)
}

pub fn audio_cpp_helper_supports_backend(accelerator: AcceleratorId) -> bool {
    let Some(helper) = audio_cpp_helper_path() else {
        return false;
    };
    let Ok(output) = Command::new(helper).arg("--list-devices").output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    match accelerator {
        AcceleratorId::Cpu => stdout.contains("CPU:"),
        AcceleratorId::Vulkan => stdout.contains("Vulkan:"),
        _ => false,
    }
}

/// GPU helpers must prove that they can initialize the requested backend.
/// Looking only at `--help` caused Vulkan to be advertised when device
/// initialization was actually failing and the adapter later fell back to CPU.
pub fn nano_helper_supports_backend(accelerator: AcceleratorId) -> bool {
    let Some(helper) = nano_helper_path() else {
        return false;
    };
    let Ok(output) = Command::new(helper)
        .arg("--probe-backend")
        .arg(accelerator.as_str())
        .output()
    else {
        return false;
    };
    output.status.success()
}

fn helper_path(basename: &str) -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    let parent = executable.parent()?;
    let filename = if cfg!(target_os = "windows") {
        format!("{basename}.exe")
    } else {
        basename.to_string()
    };
    let helper = parent.join(&filename);
    if helper.is_file() {
        return Some(helper);
    }

    // Cargo puts integration-test executables in `target/<profile>/deps`,
    // while the sidecar helper belongs in the enclosing profile directory.
    // A shipped sidecar only accepts the sibling path above.
    if cfg!(debug_assertions) {
        let helper = parent.parent()?.join(&filename);
        if helper.is_file() {
            return Some(helper);
        }
    }

    None
}

#[cfg(target_os = "linux")]
fn vulkan_ready() -> bool {
    if sensevoice_helper_path().is_none() {
        return false;
    }

    // A loader alone can expose a software implementation such as lavapipe.
    // Require an accessible DRM render node so "Vulkan available" means the
    // helper can reach hardware, without depending on the optional vulkaninfo
    // command-line package.
    let loader_available = unsafe { libloading::Library::new("libvulkan.so.1").is_ok() };
    loader_available && has_accessible_render_device()
}

#[cfg(target_os = "linux")]
fn has_accessible_render_device() -> bool {
    let Ok(entries) = fs::read_dir("/dev/dri") else {
        return false;
    };
    entries.filter_map(Result::ok).any(|entry| {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return false;
        };
        if !name.starts_with("renderD") {
            return false;
        }
        let Ok(metadata) = entry.metadata() else {
            return false;
        };
        metadata.file_type().is_char_device()
            && OpenOptions::new()
                .read(true)
                .write(true)
                .open(entry.path())
                .is_ok()
    })
}
