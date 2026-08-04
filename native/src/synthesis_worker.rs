use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use crate::engine::capabilities::{ModelFamilyId, ModelTask, RuntimeId};
use crate::engine::registry::EngineRegistry;
use crate::panic_util::format_panic_message;
use crate::protocol::{Event, SynthesisTextChunk};
use crate::synthesis::{
    SynthesisCancellation, SynthesisError, SynthesisModel, pcm_f32_to_i16le, time_stretch,
};

const MAX_AUDIO_AHEAD_MS: u64 = 30_000;

/// How long a loaded synthesis model is kept resident after the last request.
///
/// Loading a TTS model is expensive enough to dominate time-to-first-audio
/// (measured at 1-2s for Supertonic 3), so back-to-back read-aloud requests
/// reuse one loaded model. The model is dropped once idle so that a session
/// that stops using read-aloud does not hold the weights for the lifetime of
/// the sidecar, which outlives any single request.
const SYNTHESIS_MODEL_IDLE_TTL: Duration = Duration::from_secs(90);

/// Identifies a loaded synthesis model.
///
/// Keyed on the resolved model path rather than a catalog model id: the model
/// store path override is a per-request field, so two consecutive requests can
/// name the same model id at different absolute paths.
#[derive(Debug, PartialEq, Eq)]
struct ModelKey {
    runtime_id: RuntimeId,
    family_id: ModelFamilyId,
    model_path: PathBuf,
}

/// Cheap staleness check for the file a cached model was loaded from.
///
/// Model (re)installs stage into a scratch directory and rename it over the
/// live one, so a cached model can outlive the files it was loaded from — this
/// catches that without the installer having to know the worker exists.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FileFingerprint {
    len: u64,
    modified: SystemTime,
}

impl FileFingerprint {
    /// Returns `None` when the path cannot be stat'd, which callers treat as
    /// "not reusable" so the load path can surface the real error.
    fn read(path: &Path) -> Option<Self> {
        let metadata = std::fs::metadata(path).ok()?;
        Some(Self {
            len: metadata.len(),
            modified: metadata.modified().ok()?,
        })
    }
}

#[derive(Debug, Clone)]
struct ModelInvalidationTarget {
    runtime_id: RuntimeId,
    family_id: ModelFamilyId,
    install_dir: PathBuf,
}

impl ModelInvalidationTarget {
    fn matches(&self, key: &ModelKey) -> bool {
        self.runtime_id == key.runtime_id
            && self.family_id == key.family_id
            && key.model_path.starts_with(&self.install_dir)
    }
}

struct CachedSynthesisModel {
    key: ModelKey,
    /// `None` when the model file could not be stat'd at load time, which makes
    /// the entry unreusable — it is still held so the weights are released on
    /// the same idle schedule as any other load.
    fingerprint: Option<FileFingerprint>,
    model: Box<dyn SynthesisModel>,
    idle_deadline: Instant,
}

#[derive(Default)]
struct SynthesisControlState {
    invalidate_requested: bool,
    invalidation_acknowledgements: Vec<Sender<()>>,
    shutdown_requested: bool,
}

#[derive(Debug)]
pub struct StartSynthesis {
    pub synthesis_id: u32,
    pub runtime_id: RuntimeId,
    pub family_id: ModelFamilyId,
    pub model_path: PathBuf,
    pub voice_path: PathBuf,
    pub language: String,
    pub speed: f32,
    pub chunks: Vec<SynthesisTextChunk>,
    pub cancellation: SynthesisCancellation,
}

#[derive(Debug)]
enum WorkerCommand {
    Start(StartSynthesis),
    Cancel {
        synthesis_id: u32,
    },
    PlaybackPosition {
        synthesis_id: u32,
        played_through_seq: u32,
    },
    InvalidateModel {
        target: ModelInvalidationTarget,
        acknowledged: Option<Sender<()>>,
    },
    Shutdown,
}

pub struct SynthesisWorker {
    command_tx: Sender<WorkerCommand>,
    event_rx: Receiver<Event>,
    active: Option<ActiveSynthesis>,
}

struct ActiveSynthesis {
    synthesis_id: u32,
    cancellation: SynthesisCancellation,
}

#[derive(Clone)]
pub struct SynthesisCacheInvalidator {
    command_tx: Sender<WorkerCommand>,
}

impl SynthesisCacheInvalidator {
    /// Wait until a cached model backed by `install_dir` has released its
    /// handles. Installer threads use this immediately before atomically
    /// replacing that directory.
    pub fn invalidate_and_wait(
        &self,
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        install_dir: &Path,
    ) -> Result<(), String> {
        let (acknowledged, acknowledgement) = mpsc::channel();
        self.command_tx
            .send(WorkerCommand::InvalidateModel {
                target: ModelInvalidationTarget {
                    runtime_id,
                    family_id,
                    install_dir: install_dir.to_path_buf(),
                },
                acknowledged: Some(acknowledged),
            })
            .map_err(|_| "The synthesis worker is unavailable.".to_string())?;
        acknowledgement
            .recv()
            .map_err(|_| "The synthesis worker stopped before releasing the model.".to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrepareModelRemoval {
    Ready,
    InUse,
    WorkerUnavailable,
}

impl SynthesisWorker {
    pub fn spawn(registry: Arc<EngineRegistry>) -> Self {
        Self::spawn_with_idle_ttl(registry, SYNTHESIS_MODEL_IDLE_TTL)
    }

    /// Same as [`SynthesisWorker::spawn`] with a caller-chosen idle TTL, so
    /// tests can exercise eviction without waiting out the production value.
    pub fn spawn_with_idle_ttl(registry: Arc<EngineRegistry>, idle_ttl: Duration) -> Self {
        let (command_tx, command_rx) = mpsc::channel();
        let (event_tx, event_rx) = mpsc::channel();
        thread::spawn(move || worker_main(command_rx, event_tx, registry, idle_ttl));
        Self {
            command_tx,
            event_rx,
            active: None,
        }
    }

    pub fn start(&mut self, mut request: StartSynthesis) -> Result<(), String> {
        if let Some(active) = self.active.take() {
            active.cancellation.cancel();
            let _ = self.command_tx.send(WorkerCommand::Cancel {
                synthesis_id: active.synthesis_id,
            });
        }
        request.cancellation = SynthesisCancellation::new();
        self.active = Some(ActiveSynthesis {
            synthesis_id: request.synthesis_id,
            cancellation: request.cancellation.clone(),
        });
        self.command_tx
            .send(WorkerCommand::Start(request))
            .map_err(|_| "The synthesis worker is unavailable.".to_string())
    }

    pub fn cancel(&mut self, synthesis_id: u32) {
        if let Some(active) = self.active.as_ref()
            && active.synthesis_id == synthesis_id
        {
            active.cancellation.cancel();
        }
        let _ = self.command_tx.send(WorkerCommand::Cancel { synthesis_id });
    }

    pub fn update_playback_position(&self, synthesis_id: u32, played_through_seq: u32) {
        let _ = self.command_tx.send(WorkerCommand::PlaybackPosition {
            synthesis_id,
            played_through_seq,
        });
    }

    pub fn cache_invalidator(&self) -> SynthesisCacheInvalidator {
        SynthesisCacheInvalidator {
            command_tx: self.command_tx.clone(),
        }
    }

    /// Release a targeted cached model before deleting its install directory.
    ///
    /// The app command loop must not wait for an active synthesis, because it
    /// is also responsible for forwarding playback progress and cancellation.
    /// In that case the invalidation is queued for the end of synthesis and
    /// removal reports the model as in use.
    pub fn prepare_model_removal(
        &self,
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        install_dir: &Path,
    ) -> PrepareModelRemoval {
        let target = ModelInvalidationTarget {
            runtime_id,
            family_id,
            install_dir: install_dir.to_path_buf(),
        };
        if self.active.is_some() {
            return match self.command_tx.send(WorkerCommand::InvalidateModel {
                target,
                acknowledged: None,
            }) {
                Ok(()) => PrepareModelRemoval::InUse,
                Err(_) => PrepareModelRemoval::WorkerUnavailable,
            };
        }
        match self
            .cache_invalidator()
            .invalidate_and_wait(runtime_id, family_id, install_dir)
        {
            Ok(()) => PrepareModelRemoval::Ready,
            Err(_) => PrepareModelRemoval::WorkerUnavailable,
        }
    }

    pub fn poll_event(&mut self) -> Option<Event> {
        let event = self.event_rx.try_recv().ok()?;
        let terminal_id = match &event {
            Event::SynthesisComplete { synthesis_id }
            | Event::SynthesisError { synthesis_id, .. } => Some(*synthesis_id),
            _ => None,
        };
        if let Some(event_id) = terminal_id
            && self
                .active
                .as_ref()
                .is_some_and(|active| active.synthesis_id == event_id)
        {
            self.active = None;
        }
        Some(event)
    }
}

impl Drop for SynthesisWorker {
    fn drop(&mut self) {
        if let Some(active) = self.active.take() {
            active.cancellation.cancel();
        }
        let _ = self.command_tx.send(WorkerCommand::Shutdown);
    }
}

fn worker_main(
    command_rx: Receiver<WorkerCommand>,
    event_tx: Sender<Event>,
    registry: Arc<EngineRegistry>,
    idle_ttl: Duration,
) {
    let mut cache: Option<CachedSynthesisModel> = None;
    loop {
        // Only wait on a deadline while a model is actually resident. With an
        // empty cache this blocks indefinitely, so a session that never uses
        // read-aloud costs no periodic wakeups.
        let command = match cache.as_ref().map(|cached| cached.idle_deadline) {
            Some(deadline) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                match command_rx.recv_timeout(remaining) {
                    Ok(command) => command,
                    Err(RecvTimeoutError::Timeout) => {
                        cache = None;
                        continue;
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            None => match command_rx.recv() {
                Ok(command) => command,
                Err(_) => break,
            },
        };
        match command {
            WorkerCommand::Start(request) => {
                let synthesis_id = request.synthesis_id;
                let mut control = SynthesisControlState::default();
                let result = catch_unwind(AssertUnwindSafe(|| {
                    run_synthesis(
                        request,
                        &command_rx,
                        &event_tx,
                        &registry,
                        &mut cache,
                        &mut control,
                    )
                }));
                let panicked = result.is_err();
                match result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) if error.code == "synthesis_cancelled" => {}
                    Ok(Err(error)) => send_error(&event_tx, synthesis_id, error),
                    Err(payload) => send_error(
                        &event_tx,
                        synthesis_id,
                        SynthesisError::inference(
                            "synthesis worker panic",
                            format_panic_message(payload.as_ref(), "Synthesis worker panicked"),
                        ),
                    ),
                }
                // An invalidation that arrived mid-synthesis is applied now:
                // the model stayed loaded for the chunks that were still being
                // produced, and is dropped once they are done.
                if control.invalidate_requested {
                    cache = None;
                }
                if panicked {
                    cache = None;
                }
                if control.shutdown_requested {
                    break;
                }
                for acknowledgement in control.invalidation_acknowledgements {
                    let _ = acknowledgement.send(());
                }
                if let Some(cached) = cache.as_mut() {
                    cached.idle_deadline = Instant::now() + idle_ttl;
                }
            }
            WorkerCommand::InvalidateModel {
                target,
                acknowledged,
            } => {
                if cache
                    .as_ref()
                    .is_some_and(|cached| target.matches(&cached.key))
                {
                    cache = None;
                }
                if let Some(acknowledged) = acknowledged {
                    let _ = acknowledged.send(());
                }
            }
            WorkerCommand::Cancel { .. } | WorkerCommand::PlaybackPosition { .. } => {}
            WorkerCommand::Shutdown => break,
        }
    }
}

fn run_synthesis(
    request: StartSynthesis,
    command_rx: &Receiver<WorkerCommand>,
    event_tx: &Sender<Event>,
    registry: &EngineRegistry,
    cache: &mut Option<CachedSynthesisModel>,
    control: &mut SynthesisControlState,
) -> Result<(), SynthesisError> {
    if !(0.75..=2.0).contains(&request.speed) || !request.speed.is_finite() {
        return Err(SynthesisError::invalid_request(
            "Read-aloud speed must be between 0.75 and 2.0.",
        ));
    }
    if request.chunks.is_empty()
        || request.chunks.iter().any(|chunk| {
            chunk.text.trim().is_empty() || chunk.source_range.from >= chunk.source_range.to
        })
        || request
            .chunks
            .windows(2)
            .any(|pair| pair[1].source_range.from < pair[0].source_range.to)
    {
        return Err(SynthesisError::invalid_request(
            "Read-aloud requires non-empty ordered text chunks and source ranges.",
        ));
    }
    let adapter = registry
        .adapter(request.runtime_id, request.family_id)
        .ok_or_else(|| {
            SynthesisError::unsupported("The selected synthesis engine is unavailable.")
        })?;
    if adapter.capabilities().task != ModelTask::Tts {
        return Err(SynthesisError::invalid_request(
            "The selected model is a dictation model, not a read-aloud model.",
        ));
    }
    let key = ModelKey {
        runtime_id: request.runtime_id,
        family_id: request.family_id,
        model_path: request.model_path.clone(),
    };
    let fingerprint = FileFingerprint::read(&request.model_path);
    let reusable = match (cache.as_ref(), fingerprint.as_ref()) {
        (Some(cached), Some(fingerprint)) => {
            cached.key == key && cached.fingerprint.as_ref() == Some(fingerprint)
        }
        _ => false,
    };
    let model = match cache {
        Some(cached) if reusable => &mut cached.model,
        slot => {
            // Drop the resident model before loading its replacement: holding
            // two sets of TTS weights at once doubles the working set.
            *slot = None;
            let model = adapter.load_synthesis(&request.model_path)?;
            &mut slot
                .insert(CachedSynthesisModel {
                    key,
                    fingerprint,
                    model,
                    idle_deadline: Instant::now(),
                })
                .model
        }
    };
    let sample_rate = adapter.capabilities().output_sample_rate.ok_or_else(|| {
        SynthesisError::invalid_model("The TTS adapter does not declare an output sample rate")
    })?;
    event_tx
        .send(Event::SynthesisStarted {
            synthesis_id: request.synthesis_id,
            sample_rate,
        })
        .map_err(|error| SynthesisError::inference("synthesis event delivery", error))?;

    let mut cumulative_duration = Vec::new();
    let mut generated_ms = 0_u64;
    let mut played_ms = 0_u64;
    for (index, chunk) in request.chunks.iter().enumerate() {
        if request.cancellation.is_cancelled() {
            return Err(SynthesisError::cancelled());
        }
        drain_control_messages(
            command_rx,
            &request,
            &cumulative_duration,
            &mut played_ms,
            control,
            false,
        )?;
        if request.cancellation.is_cancelled() {
            return Err(SynthesisError::cancelled());
        }
        let pcm = model.synthesize(
            &chunk.text,
            &request.language,
            &request.voice_path,
            &request.cancellation,
        )?;
        if request.cancellation.is_cancelled() {
            return Err(SynthesisError::cancelled());
        }
        if pcm.sample_rate != sample_rate {
            return Err(SynthesisError::invalid_model(format!(
                "adapter returned {} Hz audio; expected {sample_rate} Hz",
                pcm.sample_rate
            )));
        }
        let stretched = time_stretch(&pcm.samples, request.speed, pcm.sample_rate);
        let duration_ms = stretched.len() as u64 * 1_000 / sample_rate as u64;
        generated_ms = generated_ms.saturating_add(duration_ms);
        cumulative_duration.push(generated_ms);
        let seq = u32::try_from(index)
            .map_err(|_| SynthesisError::invalid_request("Too many synthesis chunks."))?;
        event_tx
            .send(Event::SynthesisChunkMeta {
                synthesis_id: request.synthesis_id,
                seq,
                source_range: chunk.source_range,
                duration_ms,
            })
            .map_err(|error| SynthesisError::inference("synthesis metadata delivery", error))?;
        event_tx
            .send(Event::SynthesisAudio {
                synthesis_id: request.synthesis_id,
                seq,
                pcm16le: pcm_f32_to_i16le(&stretched),
            })
            .map_err(|error| SynthesisError::inference("synthesis audio delivery", error))?;

        while generated_ms.saturating_sub(played_ms) >= MAX_AUDIO_AHEAD_MS {
            drain_control_messages(
                command_rx,
                &request,
                &cumulative_duration,
                &mut played_ms,
                control,
                true,
            )?;
        }
    }
    if request.cancellation.is_cancelled() {
        return Err(SynthesisError::cancelled());
    }
    event_tx
        .send(Event::SynthesisComplete {
            synthesis_id: request.synthesis_id,
        })
        .map_err(|error| SynthesisError::inference("synthesis completion delivery", error))?;
    Ok(())
}

fn drain_control_messages(
    command_rx: &Receiver<WorkerCommand>,
    request: &StartSynthesis,
    cumulative_duration: &[u64],
    played_ms: &mut u64,
    control: &mut SynthesisControlState,
    block: bool,
) -> Result<(), SynthesisError> {
    loop {
        let command = if block {
            command_rx.recv().map_err(|_| SynthesisError::cancelled())?
        } else {
            match command_rx.try_recv() {
                Ok(command) => command,
                Err(TryRecvError::Empty) => return Ok(()),
                Err(TryRecvError::Disconnected) => return Err(SynthesisError::cancelled()),
            }
        };
        match command {
            WorkerCommand::Cancel { synthesis_id } if synthesis_id == request.synthesis_id => {
                request.cancellation.cancel();
                return Err(SynthesisError::cancelled());
            }
            WorkerCommand::PlaybackPosition {
                synthesis_id,
                played_through_seq,
            } if synthesis_id == request.synthesis_id => {
                if let Some(duration) = cumulative_duration.get(played_through_seq as usize) {
                    *played_ms = (*played_ms).max(*duration);
                }
                if block {
                    return Ok(());
                }
            }
            WorkerCommand::Start(_) => {
                request.cancellation.cancel();
                return Err(SynthesisError::cancelled());
            }
            WorkerCommand::Shutdown => {
                control.shutdown_requested = true;
                return Err(SynthesisError::cancelled());
            }
            // Explicit arm, ahead of the catch-alls below: an invalidation must
            // neither be swallowed nor end a flow-control wait. The model stays
            // loaded until the chunks in flight are done; `worker_main` drops it
            // once this synthesis returns.
            WorkerCommand::InvalidateModel {
                target,
                acknowledged,
            } => {
                let active_key = ModelKey {
                    runtime_id: request.runtime_id,
                    family_id: request.family_id,
                    model_path: request.model_path.clone(),
                };
                if target.matches(&active_key) {
                    control.invalidate_requested = true;
                    if let Some(acknowledged) = acknowledged {
                        control.invalidation_acknowledgements.push(acknowledged);
                    }
                } else if let Some(acknowledged) = acknowledged {
                    let _ = acknowledged.send(());
                }
            }
            _ if block => return Ok(()),
            _ => {}
        }
    }
}

fn send_error(event_tx: &Sender<Event>, synthesis_id: u32, error: SynthesisError) {
    let _ = event_tx.send(Event::SynthesisError {
        synthesis_id,
        code: error.code.to_string(),
        message: error.message,
        details: error.details,
    });
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    use crate::engine::capabilities::{
        ModelFamilyCapabilities, ModelFamilyId, ModelTask, RuntimeId,
    };
    use crate::engine::registry::EngineRegistry;
    use crate::engine::traits::{LoadedModel, ModelFamilyAdapter};
    use crate::protocol::{Event, SourceRange, SynthesisTextChunk};
    use crate::synthesis::{SynthesisCancellation, SynthesisError, SynthesisModel, SynthesisPcm};
    use crate::transcription::{GpuConfig, TranscriptionError};

    use super::{PrepareModelRemoval, SYNTHESIS_MODEL_IDLE_TTL, StartSynthesis, SynthesisWorker};

    static NEXT_MODEL_FILE_ID: AtomicUsize = AtomicUsize::new(0);

    struct FakeSynthesisAdapter {
        capabilities: ModelFamilyCapabilities,
        drops: Option<Arc<AtomicUsize>>,
        loads: Arc<AtomicUsize>,
        panic_first_load: bool,
    }

    impl FakeSynthesisAdapter {
        fn new(loads: Arc<AtomicUsize>) -> Self {
            let mut capabilities = ModelFamilyCapabilities::unknown();
            capabilities.task = ModelTask::Tts;
            capabilities.output_sample_rate = Some(1_000);
            capabilities.supports_speed_control = true;
            Self {
                capabilities,
                drops: None,
                loads,
                panic_first_load: false,
            }
        }

        fn panics_on_first_synthesis(loads: Arc<AtomicUsize>) -> Self {
            let mut adapter = Self::new(loads);
            adapter.panic_first_load = true;
            adapter
        }

        fn with_drop_counter(loads: Arc<AtomicUsize>, drops: Arc<AtomicUsize>) -> Self {
            let mut adapter = Self::new(loads);
            adapter.drops = Some(drops);
            adapter
        }
    }

    impl ModelFamilyAdapter for FakeSynthesisAdapter {
        fn runtime_id(&self) -> RuntimeId {
            RuntimeId::OnnxRuntime
        }

        fn family_id(&self) -> ModelFamilyId {
            ModelFamilyId::PocketTts
        }

        fn capabilities(&self) -> &ModelFamilyCapabilities {
            &self.capabilities
        }

        fn probe_model(&self, _path: &Path) -> Result<(), TranscriptionError> {
            Ok(())
        }

        fn load(
            &self,
            _path: &Path,
            _gpu: GpuConfig,
        ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
            Err(TranscriptionError::unsupported_engine(
                "test adapter is synthesis-only".to_string(),
            ))
        }

        fn load_synthesis(&self, _path: &Path) -> Result<Box<dyn SynthesisModel>, SynthesisError> {
            let load_index = self.loads.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(FakeSynthesisModel {
                drops: self.drops.clone(),
                panic_on_synthesis: self.panic_first_load && load_index == 0,
            }))
        }
    }

    struct FakeSynthesisModel {
        drops: Option<Arc<AtomicUsize>>,
        panic_on_synthesis: bool,
    }

    impl Drop for FakeSynthesisModel {
        fn drop(&mut self) {
            if let Some(drops) = self.drops.as_ref() {
                drops.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    impl SynthesisModel for FakeSynthesisModel {
        fn synthesize(
            &mut self,
            text: &str,
            _language: &str,
            _voice_path: &Path,
            _cancellation: &SynthesisCancellation,
        ) -> Result<SynthesisPcm, SynthesisError> {
            assert!(!self.panic_on_synthesis, "synthetic synthesis panic");
            let duration_seconds = text
                .parse::<usize>()
                .map_err(|error| SynthesisError::invalid_request(error.to_string()))?;
            Ok(SynthesisPcm {
                samples: vec![0.25; duration_seconds * 1_000],
                sample_rate: 1_000,
            })
        }
    }

    fn worker() -> SynthesisWorker {
        worker_with(Arc::new(AtomicUsize::new(0)), SYNTHESIS_MODEL_IDLE_TTL)
    }

    fn worker_with(loads: Arc<AtomicUsize>, idle_ttl: Duration) -> SynthesisWorker {
        let mut registry = EngineRegistry::default();
        registry.register_adapter(Box::new(FakeSynthesisAdapter::new(loads)));
        SynthesisWorker::spawn_with_idle_ttl(Arc::new(registry), idle_ttl)
    }

    fn worker_with_adapter(adapter: FakeSynthesisAdapter) -> SynthesisWorker {
        let mut registry = EngineRegistry::default();
        registry.register_adapter(Box::new(adapter));
        SynthesisWorker::spawn_with_idle_ttl(Arc::new(registry), SYNTHESIS_MODEL_IDLE_TTL)
    }

    /// Creates a real file for the worker to fingerprint. The cache refuses to
    /// reuse a model it cannot stat, so cache tests cannot use a bare path.
    fn model_file(name: &str, contents: &[u8]) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "local-dictation-sidecar-synthesis-cache-{}-{}",
            std::process::id(),
            NEXT_MODEL_FILE_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).expect("temp dir should create");
        let path = directory.join(name);
        std::fs::write(&path, contents).expect("model file should write");
        path
    }

    fn request_for(synthesis_id: u32, texts: &[&str], model_path: &Path) -> StartSynthesis {
        let mut request = request(synthesis_id, texts);
        request.model_path = model_path.to_path_buf();
        request
    }

    fn run_to_completion(worker: &mut SynthesisWorker, request: StartSynthesis) {
        worker.start(request).expect("synthesis should start");
        loop {
            match wait_for_event(worker) {
                Event::SynthesisComplete { .. } => return,
                Event::SynthesisError { code, message, .. } => {
                    panic!("unexpected synthesis error {code}: {message}")
                }
                _ => {}
            }
        }
    }

    fn request(synthesis_id: u32, texts: &[&str]) -> StartSynthesis {
        StartSynthesis {
            synthesis_id,
            runtime_id: RuntimeId::OnnxRuntime,
            family_id: ModelFamilyId::PocketTts,
            model_path: PathBuf::from("model.onnx"),
            voice_path: PathBuf::from("voice.safetensors"),
            language: "en".to_string(),
            speed: 1.0,
            chunks: texts
                .iter()
                .enumerate()
                .map(|(index, text)| SynthesisTextChunk {
                    text: (*text).to_string(),
                    source_range: SourceRange {
                        from: (index * 10) as u32,
                        to: (index * 10 + 5) as u32,
                    },
                })
                .collect(),
            cancellation: SynthesisCancellation::new(),
        }
    }

    fn wait_for_event(worker: &mut SynthesisWorker) -> Event {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(event) = worker.poll_event() {
                return event;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for synthesis event"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn drain_initial_chunk_events(worker: &mut SynthesisWorker, count: usize) -> Vec<Event> {
        let mut events = vec![wait_for_event(worker)];
        for _ in 0..count * 2 {
            events.push(wait_for_event(worker));
        }
        events
    }

    #[test]
    fn flow_control_blocks_at_thirty_seconds_and_resumes_only_for_the_active_session() {
        let mut worker = worker();
        worker
            .start(request(7, &["16", "16", "16"]))
            .expect("synthesis should start");

        let events = drain_initial_chunk_events(&mut worker, 2);
        assert!(matches!(
            events[0],
            Event::SynthesisStarted {
                synthesis_id: 7,
                ..
            }
        ));
        let metadata = events
            .iter()
            .filter_map(|event| match event {
                Event::SynthesisChunkMeta {
                    seq, source_range, ..
                } => Some((*seq, *source_range)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            metadata,
            vec![
                (0, SourceRange { from: 0, to: 5 }),
                (1, SourceRange { from: 10, to: 15 })
            ]
        );
        std::thread::sleep(Duration::from_millis(25));
        assert!(
            worker.poll_event().is_none(),
            "third chunk must be flow-controlled"
        );

        worker.update_playback_position(999, 0);
        std::thread::sleep(Duration::from_millis(25));
        assert!(
            worker.poll_event().is_none(),
            "stale playback position must be ignored"
        );

        worker.update_playback_position(7, 0);
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisChunkMeta { seq: 2, .. }
        ));
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisAudio { seq: 2, .. }
        ));
        worker.update_playback_position(7, 1);
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisComplete { synthesis_id: 7 }
        ));
    }

    #[test]
    fn cancellation_releases_a_flow_controlled_worker_for_the_next_request() {
        let mut worker = worker();
        worker
            .start(request(7, &["16", "16", "16"]))
            .expect("synthesis should start");
        drain_initial_chunk_events(&mut worker, 2);

        worker.cancel(7);
        worker
            .start(request(8, &["1"]))
            .expect("replacement synthesis should start");

        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisStarted {
                synthesis_id: 8,
                ..
            }
        ));
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisChunkMeta {
                synthesis_id: 8,
                ..
            }
        ));
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisAudio {
                synthesis_id: 8,
                ..
            }
        ));
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisComplete { synthesis_id: 8 }
        ));
    }

    #[test]
    fn reuses_the_loaded_model_across_requests_for_the_same_file() {
        let loads = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let mut worker = worker_with(Arc::clone(&loads), SYNTHESIS_MODEL_IDLE_TTL);

        run_to_completion(&mut worker, request_for(1, &["1"], &model_path));
        run_to_completion(&mut worker, request_for(2, &["1"], &model_path));

        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn reloads_when_the_model_path_changes() {
        let loads = Arc::new(AtomicUsize::new(0));
        let first = model_file("model.onnx", b"weights");
        let second = model_file("model.onnx", b"weights");
        let mut worker = worker_with(Arc::clone(&loads), SYNTHESIS_MODEL_IDLE_TTL);

        run_to_completion(&mut worker, request_for(1, &["1"], &first));
        run_to_completion(&mut worker, request_for(2, &["1"], &second));

        assert_eq!(loads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn reloads_when_the_model_file_is_replaced_underneath_the_cache() {
        let loads = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let mut worker = worker_with(Arc::clone(&loads), SYNTHESIS_MODEL_IDLE_TTL);

        run_to_completion(&mut worker, request_for(1, &["1"], &model_path));
        std::fs::write(&model_path, b"reinstalled weights").expect("model file should rewrite");
        run_to_completion(&mut worker, request_for(2, &["1"], &model_path));

        assert_eq!(loads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn acknowledged_invalidation_drops_the_cached_model_before_returning() {
        let loads = Arc::new(AtomicUsize::new(0));
        let drops = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let mut worker = worker_with_adapter(FakeSynthesisAdapter::with_drop_counter(
            Arc::clone(&loads),
            Arc::clone(&drops),
        ));

        run_to_completion(&mut worker, request_for(1, &["1"], &model_path));
        worker
            .cache_invalidator()
            .invalidate_and_wait(
                RuntimeId::OnnxRuntime,
                ModelFamilyId::PocketTts,
                model_path.parent().expect("model should have a parent"),
            )
            .expect("worker should acknowledge invalidation");
        assert_eq!(
            drops.load(Ordering::SeqCst),
            1,
            "acknowledgement must follow model drop"
        );
        run_to_completion(&mut worker, request_for(2, &["1"], &model_path));

        assert_eq!(loads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn targeted_invalidation_keeps_an_unrelated_cached_model() {
        let loads = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let unrelated_model = model_file("other.onnx", b"weights");
        let mut worker = worker_with(Arc::clone(&loads), SYNTHESIS_MODEL_IDLE_TTL);

        run_to_completion(&mut worker, request_for(1, &["1"], &model_path));
        worker
            .cache_invalidator()
            .invalidate_and_wait(
                RuntimeId::OnnxRuntime,
                ModelFamilyId::PocketTts,
                unrelated_model
                    .parent()
                    .expect("unrelated model should have a parent"),
            )
            .expect("worker should acknowledge unrelated invalidation");
        run_to_completion(&mut worker, request_for(2, &["1"], &model_path));

        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn idle_expiry_drops_the_cached_model() {
        let loads = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let mut worker = worker_with(Arc::clone(&loads), Duration::from_millis(50));

        run_to_completion(&mut worker, request_for(1, &["1"], &model_path));
        std::thread::sleep(Duration::from_millis(300));
        run_to_completion(&mut worker, request_for(2, &["1"], &model_path));

        assert_eq!(loads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn active_synthesis_defers_unrelated_removal_without_releasing_flow_control() {
        let loads = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let unrelated_model = model_file("other.onnx", b"weights");
        let mut worker = worker_with(Arc::clone(&loads), SYNTHESIS_MODEL_IDLE_TTL);

        worker
            .start(request_for(1, &["16", "16", "16"], &model_path))
            .expect("synthesis should start");
        drain_initial_chunk_events(&mut worker, 2);

        assert_eq!(
            worker.prepare_model_removal(
                RuntimeId::OnnxRuntime,
                ModelFamilyId::PocketTts,
                unrelated_model
                    .parent()
                    .expect("unrelated model should have a parent"),
            ),
            PrepareModelRemoval::InUse
        );
        assert!(
            worker.poll_event().is_none(),
            "unrelated removal must not release the flow-control wait"
        );

        worker.update_playback_position(1, 0);
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisChunkMeta { seq: 2, .. }
        ));
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisAudio { seq: 2, .. }
        ));
        worker.update_playback_position(1, 1);
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisComplete { synthesis_id: 1 }
        ));
        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn invalidate_during_synthesis_finishes_it_before_dropping_the_model() {
        let loads = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let mut worker = worker_with(Arc::clone(&loads), SYNTHESIS_MODEL_IDLE_TTL);

        worker
            .start(request_for(1, &["16", "16", "16"], &model_path))
            .expect("synthesis should start");
        drain_initial_chunk_events(&mut worker, 2);

        // The worker is now flow-control-blocked inside `drain_control_messages`,
        // which is where an invalidation is easiest to swallow or to mistake for
        // a wakeup.
        assert_eq!(
            worker.prepare_model_removal(
                RuntimeId::OnnxRuntime,
                ModelFamilyId::PocketTts,
                model_path.parent().expect("model should have a parent"),
            ),
            PrepareModelRemoval::InUse
        );
        std::thread::sleep(Duration::from_millis(25));
        assert!(
            worker.poll_event().is_none(),
            "invalidation must not release the flow-control wait"
        );

        worker.update_playback_position(1, 0);
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisChunkMeta { seq: 2, .. }
        ));
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisAudio { seq: 2, .. }
        ));
        worker.update_playback_position(1, 1);
        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisComplete { synthesis_id: 1 }
        ));

        run_to_completion(&mut worker, request_for(2, &["1"], &model_path));
        assert_eq!(loads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn shutdown_during_synthesis_terminates_worker_with_an_invalidator_clone() {
        let loads = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let mut worker = worker_with(Arc::clone(&loads), SYNTHESIS_MODEL_IDLE_TTL);
        let invalidator = worker.cache_invalidator();

        worker
            .start(request_for(1, &["16", "16", "16"], &model_path))
            .expect("synthesis should start");
        drain_initial_chunk_events(&mut worker, 2);
        drop(worker);

        assert!(
            invalidator
                .invalidate_and_wait(
                    RuntimeId::OnnxRuntime,
                    ModelFamilyId::PocketTts,
                    model_path.parent().expect("model should have a parent"),
                )
                .is_err(),
            "shutdown must close the worker instead of acknowledging later file changes"
        );
    }

    #[test]
    fn panic_drops_cached_model_and_next_request_reloads() {
        let loads = Arc::new(AtomicUsize::new(0));
        let model_path = model_file("model.onnx", b"weights");
        let mut worker = worker_with_adapter(FakeSynthesisAdapter::panics_on_first_synthesis(
            Arc::clone(&loads),
        ));

        worker
            .start(request_for(1, &["1"], &model_path))
            .expect("synthesis should start");
        loop {
            if let Event::SynthesisError {
                synthesis_id: 1,
                code,
                ..
            } = wait_for_event(&mut worker)
            {
                assert_eq!(code, "synthesis_failed");
                break;
            }
        }

        run_to_completion(&mut worker, request_for(2, &["1"], &model_path));
        assert_eq!(loads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn rejects_overlapping_source_ranges() {
        let mut worker = worker();
        let mut invalid = request(9, &["1", "1"]);
        invalid.chunks[1].source_range = SourceRange { from: 4, to: 9 };
        worker
            .start(invalid)
            .expect("request should reach the worker");

        assert!(matches!(
            wait_for_event(&mut worker),
            Event::SynthesisError { synthesis_id: 9, code, .. } if code == "invalid_synthesis_request"
        ));
    }
}
