use std::collections::HashMap;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;

use anyhow::{Context, Result, bail, ensure};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::{LogOptions, send_logs_to_tracing};

// Compile the helper's small shared modules directly into this executable. Importing
// the main sidecar library here would also link Whisper's GGML objects and recreate
// the symbol collision that this process boundary exists to avoid.
#[path = "../hy_mt.rs"]
mod hy_mt;
#[path = "../translation_helper_protocol.rs"]
mod translation_helper_protocol;

use hy_mt::{HyMtInference, translate_units};
use translation_helper_protocol::{HelperCommand, HelperEvent};

const JSON_FRAME_KIND: u8 = 0x01;
const FRAME_HEADER_LENGTH: usize = 5;
const MAX_FRAME_PAYLOAD: usize = 16 * 1024 * 1024;

fn read_json_frame<R: Read, T: for<'de> serde::Deserialize<'de>>(
    reader: &mut R,
) -> Result<Option<T>> {
    let mut header = [0_u8; FRAME_HEADER_LENGTH];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    ensure!(header[0] == JSON_FRAME_KIND, "expected a JSON frame");
    let payload_length = u32::from_le_bytes(header[1..].try_into()?) as usize;
    ensure!(
        payload_length <= MAX_FRAME_PAYLOAD,
        "frame payload exceeds maximum supported size"
    );
    let mut payload = vec![0_u8; payload_length];
    reader.read_exact(&mut payload)?;
    Ok(Some(serde_json::from_slice(&payload)?))
}

fn write_json_frame<W: Write, T: serde::Serialize>(writer: &mut W, value: &T) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    ensure!(
        payload.len() <= MAX_FRAME_PAYLOAD,
        "frame payload exceeds maximum supported size"
    );
    writer.write_all(&[JSON_FRAME_KIND])?;
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()?;
    Ok(())
}

struct Work {
    translation_id: String,
    model_path: PathBuf,
    source_language: String,
    target_language: String,
    texts: Vec<String>,
    use_gpu: bool,
    cancelled: Arc<AtomicBool>,
}

struct CachedModel {
    path: PathBuf,
    use_gpu: bool,
    backend: LlamaBackend,
    model: LlamaModel,
}

struct LlamaInference<'a> {
    model: &'a CachedModel,
}

const HY_MT_CONTEXT_SIZE: u32 = 8192;
const HY_MT_MAX_OUTPUT_TOKENS: i32 = 4096;

impl HyMtInference for LlamaInference<'_> {
    fn translate(&mut self, prompt: &str, cancelled: &AtomicBool) -> Result<String> {
        let message = LlamaChatMessage::new("user".into(), prompt.into())?;
        let template = self.model.model.chat_template(None)?;
        let rendered = self
            .model
            .model
            .apply_chat_template(&template, &[message], false)?;
        let tokens = self.model.model.str_to_token(&rendered, AddBos::Always)?;
        let context_size = NonZeroU32::new(HY_MT_CONTEXT_SIZE).expect("nonzero");
        if tokens.len() >= context_size.get() as usize {
            bail!("translation unit exceeds model context");
        }
        let mut context = self
            .model
            .model
            .new_context(
                &self.model.backend,
                context_params_for_acceleration(context_size, self.model.use_gpu),
            )
            .context("unable to create HY-MT inference context")?;
        let mut batch = LlamaBatch::new(HY_MT_CONTEXT_SIZE as usize, 1);
        batch
            .add_sequence(&tokens, 0, false)
            .context("unable to prepare HY-MT prompt tokens")?;
        context
            .decode(&mut batch)
            .context("unable to decode the HY-MT prompt")?;
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::penalties(-1, 1.05, 0.0, 0.0),
            LlamaSampler::top_k(20),
            LlamaSampler::top_p(0.6, 1),
            LlamaSampler::temp(0.7),
            LlamaSampler::dist(42),
        ]);
        let mut output = Vec::new();
        let mut position = i32::try_from(tokens.len())?;
        let max_position =
            i32::try_from(context_size.get())?.min(position + HY_MT_MAX_OUTPUT_TOKENS);
        while position < max_position {
            if cancelled.load(Ordering::Relaxed) {
                bail!("translation cancelled");
            }
            let token = sampler.sample(&context, batch.n_tokens() - 1);
            sampler.accept(token);
            if self.model.model.is_eog_token(token) {
                break;
            }
            match self
                .model
                .model
                .token_to_piece_bytes(token, 32, false, None)
            {
                Ok(bytes) => output.extend(bytes),
                Err(llama_cpp_2::TokenToStringError::InsufficientBufferSpace(size)) => {
                    output.extend(self.model.model.token_to_piece_bytes(
                        token,
                        (-size) as usize,
                        false,
                        None,
                    )?);
                }
                Err(error) => return Err(error.into()),
            }
            batch.clear();
            batch
                .add(token, position, &[0], true)
                .context("unable to prepare an HY-MT output token")?;
            context
                .decode(&mut batch)
                .context("unable to decode an HY-MT output token")?;
            position += 1;
        }
        Ok(String::from_utf8(output)?.trim().to_string())
    }
}

fn main() -> Result<()> {
    send_logs_to_tracing(LogOptions::default().with_logs_enabled(false));
    let (work_tx, work_rx) = mpsc::channel();
    let cancellations = Arc::new(Mutex::new(HashMap::<String, Arc<AtomicBool>>::new()));
    let shutdown = Arc::new(AtomicBool::new(false));
    spawn_reader(work_tx, Arc::clone(&cancellations), Arc::clone(&shutdown));
    let stdout = io::stdout();
    let mut writer = BufWriter::new(stdout.lock());
    write_json_frame(
        &mut writer,
        &HelperEvent::Ready {
            helper_version: env!("CARGO_PKG_VERSION").to_string(),
        },
    )?;
    let mut cached: Option<CachedModel> = None;
    while let Ok(work) = work_rx.recv() {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }
        write_json_frame(
            &mut writer,
            &HelperEvent::Started {
                translation_id: work.translation_id.clone(),
                total: work.texts.len(),
            },
        )?;
        if cached
            .as_ref()
            .is_none_or(|model| model.path != work.model_path || model.use_gpu != work.use_gpu)
        {
            match load_model(&work.model_path, work.use_gpu) {
                Ok(model) => cached = Some(model),
                Err(error) => {
                    cancellations
                        .lock()
                        .ok()
                        .and_then(|mut map| map.remove(&work.translation_id));
                    write_json_frame(
                        &mut writer,
                        &HelperEvent::Error {
                            translation_id: work.translation_id,
                            code: "model_load_failed".into(),
                            message: format!("Unable to load the translation model: {error:#}"),
                        },
                    )?;
                    continue;
                }
            }
        }
        let mut inference = LlamaInference {
            model: cached.as_ref().expect("loaded"),
        };
        let result = translate_units(
            &mut inference,
            &work.source_language,
            &work.target_language,
            &work.texts,
            &work.cancelled,
            |completed, total| {
                let _ = write_json_frame(
                    &mut writer,
                    &HelperEvent::Progress {
                        translation_id: work.translation_id.clone(),
                        completed,
                        total,
                    },
                );
            },
        );
        let event = match result {
            Ok(translations) => HelperEvent::Complete {
                translation_id: work.translation_id.clone(),
                translations,
            },
            Err(_) if work.cancelled.load(Ordering::Relaxed) => HelperEvent::Cancelled {
                translation_id: work.translation_id.clone(),
            },
            Err(error) => HelperEvent::Error {
                translation_id: work.translation_id.clone(),
                code: "inference_failed".into(),
                message: format!("Translation failed: {error:#}"),
            },
        };
        cancellations
            .lock()
            .ok()
            .and_then(|mut map| map.remove(&work.translation_id));
        write_json_frame(&mut writer, &event)?;
    }
    Ok(())
}

fn spawn_reader(
    work_tx: mpsc::Sender<Work>,
    cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    shutdown: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut reader = BufReader::new(stdin.lock());
        loop {
            match read_json_frame::<_, HelperCommand>(&mut reader) {
                Ok(Some(HelperCommand::Translate {
                    translation_id,
                    model_path,
                    source_language,
                    target_language,
                    texts,
                    use_gpu,
                })) => {
                    let cancelled = Arc::new(AtomicBool::new(false));
                    if let Ok(mut map) = cancellations.lock() {
                        map.insert(translation_id.clone(), Arc::clone(&cancelled));
                    }
                    if work_tx
                        .send(Work {
                            translation_id,
                            model_path,
                            source_language,
                            target_language,
                            texts,
                            use_gpu,
                            cancelled,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Some(HelperCommand::Cancel { translation_id })) => {
                    if let Ok(map) = cancellations.lock()
                        && let Some(flag) = map.get(&translation_id)
                    {
                        flag.store(true, Ordering::Relaxed);
                    }
                }
                Ok(Some(HelperCommand::Shutdown)) | Ok(None) | Err(_) => {
                    shutdown.store(true, Ordering::Relaxed);
                    if let Ok(map) = cancellations.lock() {
                        for flag in map.values() {
                            flag.store(true, Ordering::Relaxed);
                        }
                    }
                    break;
                }
            }
        }
    });
}

fn load_model(path: &Path, use_gpu: bool) -> Result<CachedModel> {
    let backend = LlamaBackend::init()?;
    let params = model_params_for_acceleration(use_gpu)?;
    let model = LlamaModel::load_from_file(&backend, path, &params)
        .context("unable to load HY-MT model")?;
    Ok(CachedModel {
        path: path.to_path_buf(),
        use_gpu,
        backend,
        model,
    })
}

fn model_params_for_acceleration(use_gpu: bool) -> Result<LlamaModelParams> {
    let params = LlamaModelParams::default().with_n_gpu_layers(0);
    #[cfg(any(feature = "gpu-metal", feature = "gpu-cuda"))]
    {
        if use_gpu {
            return Ok(params.with_n_gpu_layers(1000));
        }
    }
    #[cfg(not(any(feature = "gpu-metal", feature = "gpu-cuda")))]
    let _ = use_gpu;
    // llama.cpp otherwise selects the first compiled GPU device for the model,
    // even when no model layers are offloaded. An explicit empty list keeps a
    // CPU-only translation from initializing a GPU backend at all.
    Ok(params.with_devices(&[])?)
}

fn context_params_for_acceleration(context_size: NonZeroU32, use_gpu: bool) -> LlamaContextParams {
    LlamaContextParams::default()
        .with_n_ctx(Some(context_size))
        .with_n_batch(4096)
        .with_offload_kqv(use_gpu)
        .with_op_offload(use_gpu)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_only_model_params_disable_gpu_layers() {
        assert_eq!(
            model_params_for_acceleration(false).unwrap().n_gpu_layers(),
            0
        );
    }

    #[cfg(any(feature = "gpu-metal", feature = "gpu-cuda"))]
    #[test]
    fn auto_model_params_offload_to_the_accelerator() {
        assert_eq!(
            model_params_for_acceleration(true).unwrap().n_gpu_layers(),
            1000
        );
    }

    #[test]
    fn cpu_only_context_params_disable_gpu_operations() {
        let params = context_params_for_acceleration(NonZeroU32::new(4096).unwrap(), false);

        assert!(!params.offload_kqv());
        assert!(!params.op_offload());
    }
}
