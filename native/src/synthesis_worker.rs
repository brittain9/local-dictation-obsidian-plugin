use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread;

use crate::engine::capabilities::{ModelFamilyId, ModelTask, RuntimeId};
use crate::engine::registry::EngineRegistry;
use crate::panic_util::format_panic_message;
use crate::protocol::{Event, SynthesisTextChunk};
use crate::synthesis::{SynthesisCancellation, SynthesisError, pcm_f32_to_i16le, time_stretch};

const MAX_AUDIO_AHEAD_MS: u64 = 30_000;

#[derive(Debug)]
pub struct StartSynthesis {
    pub synthesis_id: u32,
    pub runtime_id: RuntimeId,
    pub family_id: ModelFamilyId,
    pub model_path: PathBuf,
    pub voice_path: PathBuf,
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
    Shutdown,
}

pub struct SynthesisWorker {
    command_tx: Sender<WorkerCommand>,
    event_rx: Receiver<Event>,
    active: Option<(u32, SynthesisCancellation)>,
}

impl SynthesisWorker {
    pub fn spawn(registry: Arc<EngineRegistry>) -> Self {
        let (command_tx, command_rx) = mpsc::channel();
        let (event_tx, event_rx) = mpsc::channel();
        thread::spawn(move || worker_main(command_rx, event_tx, registry));
        Self {
            command_tx,
            event_rx,
            active: None,
        }
    }

    pub fn start(&mut self, mut request: StartSynthesis) -> Result<(), String> {
        if let Some((active_id, cancellation)) = self.active.take() {
            cancellation.cancel();
            let _ = self.command_tx.send(WorkerCommand::Cancel {
                synthesis_id: active_id,
            });
        }
        request.cancellation = SynthesisCancellation::new();
        self.active = Some((request.synthesis_id, request.cancellation.clone()));
        self.command_tx
            .send(WorkerCommand::Start(request))
            .map_err(|_| "The synthesis worker is unavailable.".to_string())
    }

    pub fn cancel(&mut self, synthesis_id: u32) {
        if let Some((active_id, cancellation)) = self.active.as_ref()
            && *active_id == synthesis_id
        {
            cancellation.cancel();
        }
        let _ = self.command_tx.send(WorkerCommand::Cancel { synthesis_id });
    }

    pub fn update_playback_position(&self, synthesis_id: u32, played_through_seq: u32) {
        let _ = self.command_tx.send(WorkerCommand::PlaybackPosition {
            synthesis_id,
            played_through_seq,
        });
    }

    pub fn poll_event(&mut self) -> Option<Event> {
        let event = self.event_rx.try_recv().ok()?;
        let terminal_id = match &event {
            Event::SynthesisComplete { synthesis_id }
            | Event::SynthesisError { synthesis_id, .. } => Some(*synthesis_id),
            _ => None,
        };
        if let Some(event_id) = terminal_id
            && self.active.as_ref().is_some_and(|(id, _)| *id == event_id)
        {
            self.active = None;
        }
        Some(event)
    }
}

impl Drop for SynthesisWorker {
    fn drop(&mut self) {
        if let Some((_, cancellation)) = self.active.take() {
            cancellation.cancel();
        }
        let _ = self.command_tx.send(WorkerCommand::Shutdown);
    }
}

fn worker_main(
    command_rx: Receiver<WorkerCommand>,
    event_tx: Sender<Event>,
    registry: Arc<EngineRegistry>,
) {
    while let Ok(command) = command_rx.recv() {
        match command {
            WorkerCommand::Start(request) => {
                let synthesis_id = request.synthesis_id;
                let result = catch_unwind(AssertUnwindSafe(|| {
                    run_synthesis(request, &command_rx, &event_tx, &registry)
                }));
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
    let mut model = adapter.load_synthesis(&request.model_path)?;
    let sample_rate = adapter.capabilities().output_sample_rate.ok_or_else(|| {
        SynthesisError::invalid_model("Pocket TTS does not declare an output sample rate")
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
            false,
        )?;
        if request.cancellation.is_cancelled() {
            return Err(SynthesisError::cancelled());
        }
        let pcm = model.synthesize(&chunk.text, &request.voice_path, &request.cancellation)?;
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
            WorkerCommand::Shutdown => return Err(SynthesisError::cancelled()),
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
    use std::time::{Duration, Instant};

    use crate::engine::capabilities::{
        ModelFamilyCapabilities, ModelFamilyId, ModelTask, RuntimeId,
    };
    use crate::engine::registry::EngineRegistry;
    use crate::engine::traits::{LoadedModel, ModelFamilyAdapter};
    use crate::protocol::{Event, SourceRange, SynthesisTextChunk};
    use crate::synthesis::{SynthesisCancellation, SynthesisError, SynthesisModel, SynthesisPcm};
    use crate::transcription::{GpuConfig, TranscriptionError};

    use super::{StartSynthesis, SynthesisWorker};

    struct FakeSynthesisAdapter {
        capabilities: ModelFamilyCapabilities,
    }

    impl FakeSynthesisAdapter {
        fn new() -> Self {
            let mut capabilities = ModelFamilyCapabilities::unknown();
            capabilities.task = ModelTask::Tts;
            capabilities.output_sample_rate = Some(1_000);
            capabilities.supports_speed_control = true;
            Self { capabilities }
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
            Ok(Box::new(FakeSynthesisModel))
        }
    }

    struct FakeSynthesisModel;

    impl SynthesisModel for FakeSynthesisModel {
        fn synthesize(
            &mut self,
            text: &str,
            _voice_path: &Path,
            _cancellation: &SynthesisCancellation,
        ) -> Result<SynthesisPcm, SynthesisError> {
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
        let mut registry = EngineRegistry::default();
        registry.register_adapter(Box::new(FakeSynthesisAdapter::new()));
        SynthesisWorker::spawn(Arc::new(registry))
    }

    fn request(synthesis_id: u32, texts: &[&str]) -> StartSynthesis {
        StartSynthesis {
            synthesis_id,
            runtime_id: RuntimeId::OnnxRuntime,
            family_id: ModelFamilyId::PocketTts,
            model_path: PathBuf::from("model.onnx"),
            voice_path: PathBuf::from("voice.safetensors"),
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
