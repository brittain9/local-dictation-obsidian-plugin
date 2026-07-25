use std::collections::HashMap;
use std::path::Path;
#[cfg(feature = "gpu-ort-cuda")]
use std::sync::OnceLock;

#[cfg(feature = "gpu-ort-cuda")]
use ort::ep::{CUDA, ExecutionProvider, cuda::CUDNN_DYLIBS};
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

        #[cfg(feature = "gpu-ort-cuda")]
        accelerator_details.insert(
            AcceleratorId::Cuda,
            match probe_cuda_execution_provider() {
                Ok(()) => AcceleratorAvailability::available(),
                Err(reason) => AcceleratorAvailability::unavailable(reason),
            },
        );

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

/// Build an ORT session for `model_path`, optionally registering the CUDA EP
/// when `gpu_config.use_gpu` is set and the `gpu-ort-cuda` feature is compiled.
pub fn build_session(
    model_path: &Path,
    gpu_config: GpuConfig,
) -> Result<Session, TranscriptionError> {
    let mut builder = Session::builder()
        .map_err(|e| TranscriptionError::transcription_failure("session builder", &e))?;

    #[cfg(feature = "gpu-ort-cuda")]
    if gpu_config.use_gpu {
        ensure_cuda_execution_provider_ready()
            .map_err(|e| TranscriptionError::transcription_failure("CUDA dependency check", &e))?;

        builder = builder
            .with_execution_providers([CUDA::default().build().error_on_failure()])
            .map_err(|e| TranscriptionError::transcription_failure("CUDA EP registration", &e))?;
    }

    #[cfg(not(feature = "gpu-ort-cuda"))]
    let _ = gpu_config;

    builder
        .commit_from_file(model_path)
        .map_err(|e| TranscriptionError::transcription_failure("model loading", &e))
}

#[cfg(feature = "gpu-ort-cuda")]
pub fn probe_cuda_execution_provider() -> Result<(), String> {
    ensure_cuda_execution_provider_ready()
}

#[cfg(feature = "gpu-ort-cuda")]
fn ensure_cuda_execution_provider_ready() -> Result<(), String> {
    static CUDA_PRECHECK: OnceLock<Result<(), String>> = OnceLock::new();

    CUDA_PRECHECK.get_or_init(run_cuda_precheck).clone()
}

#[cfg(feature = "gpu-ort-cuda")]
fn run_cuda_precheck() -> Result<(), String> {
    let execution_provider = CUDA::default();
    match execution_provider.is_available() {
        Ok(false) => {
            return Err("ONNX Runtime CUDA execution provider is unavailable.".to_string());
        }
        Err(error) => {
            return Err(format!(
                "Failed to query ONNX Runtime CUDA execution provider: {error}"
            ));
        }
        Ok(true) => {}
    }

    preload_cuda_dependencies()?;

    Session::builder()
        .map_err(|error| format!("Failed to create an ONNX Runtime session builder: {error}"))?
        .with_execution_providers([execution_provider.build().error_on_failure()])
        .map(|_| ())
        .map_err(|error| format!("CUDA execution provider registration failed: {error}"))
}

/// The CUDA runtime libraries staged next to the sidecar binary, read from the
/// same manifest `scripts/build-cuda.sh` copies out of the toolkit and
/// `scripts/package-sidecar-archive.mjs` ships. Embedding it keeps the preload
/// list from drifting away from what actually lands in `bin/cuda/`.
///
/// `ort`'s own `CUDA_DYLIBS` is deliberately not used: it still names the CUDA
/// 12 sonames even though the provider binary it downloads links CUDA 13, so
/// preloading from it fails on every library. The manifest is derived from the
/// provider's actual `DT_NEEDED` entries instead.
///
/// cuDNN is the opposite case and still comes from `CUDNN_DYLIBS`: we do not
/// vendor it — it has to be installed on the machine already — so upstream's
/// canonical names are the right ones to probe for. Do not "unify" these two.
#[cfg(feature = "gpu-ort-cuda")]
const CUDA_ARTIFACTS_MANIFEST: &str = include_str!("../../cuda-artifacts.json");

#[cfg(feature = "gpu-ort-cuda")]
#[derive(serde::Deserialize)]
struct CudaArtifacts {
    runtime: HashMap<String, Vec<String>>,
}

#[cfg(feature = "gpu-ort-cuda")]
fn vendored_cuda_dylibs() -> Result<Vec<String>, String> {
    let platform = if cfg!(windows) { "win32" } else { "linux" };
    serde_json::from_str::<CudaArtifacts>(CUDA_ARTIFACTS_MANIFEST)
        .map_err(|error| format!("bundled CUDA artifact manifest is malformed: {error}"))?
        .runtime
        .remove(platform)
        .ok_or_else(|| format!("bundled CUDA artifact manifest has no {platform} runtime entry"))
}

#[cfg(feature = "gpu-ort-cuda")]
fn preload_cuda_dependencies() -> Result<(), String> {
    // ORT can register the CUDA EP before delay-loaded CUDA/cuDNN DLLs are
    // actually resolved. Preload them so missing runtime files become a CPU
    // fallback reason instead of a fail-fast during the first encoder run.
    let sidecar_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));

    for library_name in vendored_cuda_dylibs()? {
        preload_required_dylib(
            &library_name,
            sidecar_dir.as_deref(),
            CudaDependency::Runtime,
        )?;
    }

    for library_name in CUDNN_DYLIBS {
        preload_required_dylib(library_name, sidecar_dir.as_deref(), CudaDependency::Cudnn)?;
    }

    Ok(())
}

/// Which dependency group a preload failure belongs to. The two produce very
/// different messages because they mean different things to the user: a missing
/// bundled CUDA library is a packaging bug worth diagnosing, while missing cuDNN
/// is an expected state on a machine that simply has not installed it.
#[cfg(feature = "gpu-ort-cuda")]
#[derive(Clone, Copy)]
enum CudaDependency {
    Runtime,
    Cudnn,
}

#[cfg(feature = "gpu-ort-cuda")]
impl CudaDependency {
    /// This string is surfaced verbatim in Settings, so the cuDNN case reads as
    /// an instruction rather than a stack trace. The bundled-runtime case keeps
    /// the loader error: it means the sidecar was packaged wrong, and the only
    /// person who can act on it needs the detail.
    fn not_found_reason(self, library_name: &str, loader_error: &str) -> String {
        match self {
            Self::Runtime => format!(
                "Bundled CUDA library {library_name} is missing from the sidecar directory and \
                 the system library search path: {loader_error}"
            ),
            Self::Cudnn => format!(
                "cuDNN 9 is not installed ({library_name} was not found), so ONNX models run on \
                 the CPU. Install NVIDIA cuDNN 9 to enable GPU acceleration for them."
            ),
        }
    }
}

#[cfg(feature = "gpu-ort-cuda")]
fn preload_required_dylib(
    library_name: &str,
    sidecar_dir: Option<&Path>,
    dependency: CudaDependency,
) -> Result<(), String> {
    if let Some(candidate) = sidecar_dir
        .map(|dir| dir.join(library_name))
        .filter(|candidate| candidate.is_file())
    {
        return ort::util::preload_dylib(&candidate).map_err(|error| {
            format!(
                "CUDA library {library_name} failed to load from {}: {error}",
                candidate.display()
            )
        });
    }

    ort::util::preload_dylib(Path::new(library_name))
        .map_err(|error| dependency.not_found_reason(library_name, &error.to_string()))
}

#[cfg(all(test, feature = "gpu-ort-cuda"))]
mod tests {
    use super::vendored_cuda_dylibs;

    /// A malformed or renamed manifest degrades to a blanket "CUDA unavailable"
    /// at runtime — exactly the silent failure this module exists to avoid.
    #[test]
    fn embedded_manifest_lists_the_cuda_runtime_for_this_platform() {
        let dylibs = vendored_cuda_dylibs().expect("embedded CUDA artifact manifest must parse");

        assert!(
            dylibs.iter().any(|name| name.contains("cudart")),
            "manifest must list the CUDA runtime library, got {dylibs:?}"
        );
    }
}
