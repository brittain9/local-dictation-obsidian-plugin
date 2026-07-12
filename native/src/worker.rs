use std::collections::HashMap;
use std::panic::{self, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Instant;

use tokio::runtime::{Builder, Runtime};
use tokio::sync::watch;
use uuid::Uuid;

use crate::diarize::{SessionDiarizer, SpeakerTurn};
use crate::engine::capabilities::{
    ModelFamilyCapabilities, ModelFamilyId, RequestWarning, RuntimeId,
};
use crate::engine::registry::{EngineRegistry, apply_capability_gates, missing_adapter_error};
use crate::engine::traits::{LoadedModel, StreamingModel};
use crate::panic_util::format_panic_message;
use crate::protocol::{
    ContextWindow, EngineStagePayload, StageId, StageOutcome, StageStatus, TranscriptSegment,
    UserRule,
};
use crate::session::{FinalizedUtterance, LiveUtterance};
use crate::stages::{
    StageContext, StageEnablement, StageProcessor, post_engine_processors, run_post_engine,
};
use crate::transcription::{
    EngineTranscriptOutput, GpuConfig, Transcript, TranscriptionError, TranscriptionRequest,
};

#[derive(Debug, Clone)]
pub struct SessionMetadata {
    pub runtime_id: RuntimeId,
    pub family_id: ModelFamilyId,
    pub gpu_config: GpuConfig,
    pub diarization_enabled: bool,
    pub language: String,
    pub model_file_path: PathBuf,
    pub cancel_rx: watch::Receiver<bool>,
    pub session_start_unix_ms: u64,
    pub session_id: String,
    pub stage_enablement: StageEnablement,
    pub user_rules: Vec<UserRule>,
}

#[derive(Debug)]
pub enum WorkerCommand {
    BeginStreamingUtterance {
        session_id: String,
        utterance: LiveUtterance,
        utterance_id: Uuid,
    },
    BeginSession(SessionMetadata),
    EndSession {
        session_id: String,
    },
    Shutdown,
    StreamAudio {
        samples: Vec<i16>,
        session_id: String,
        utterance_id: Uuid,
    },
    FinalizeStreamingUtterance {
        session_id: String,
        utterance: FinalizedUtterance,
        utterance_id: Uuid,
    },
    TranscribeUtterance {
        context: Option<ContextWindow>,
        session_id: String,
        utterance: FinalizedUtterance,
        utterance_id: Uuid,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum WorkerEvent {
    SessionError {
        code: String,
        details: Option<String>,
        finalizes_utterance: bool,
        message: String,
        session_id: String,
        utterance_id: Option<Uuid>,
    },
    TranscriptReady {
        pause_ms_before_utterance: Option<u64>,
        processing_duration_ms: u64,
        session_id: String,
        speaker_index: Option<u32>,
        transcript: Transcript,
        utterance_duration_ms: u64,
        utterance_end_ms_in_session: u64,
        utterance_index: u64,
        utterance_start_ms_in_session: u64,
        warnings: Vec<RequestWarning>,
    },
}

pub struct TranscriptionWorker {
    command_tx: Sender<WorkerCommand>,
    event_rx: Receiver<WorkerEvent>,
}

impl TranscriptionWorker {
    pub fn spawn(registry: Arc<EngineRegistry>) -> Self {
        let (command_tx, command_rx) = mpsc::channel();
        let (event_tx, event_rx) = mpsc::channel();

        thread::spawn(move || worker_main(command_rx, event_tx, registry));

        Self {
            command_tx,
            event_rx,
        }
    }

    pub fn poll_event(&self) -> Option<WorkerEvent> {
        self.event_rx.try_recv().ok()
    }

    // SendError wraps the rejected command, which contains an audio buffer
    // and an optional ContextWindow. We never inspect the rejected value
    // (an Err here means the worker thread is gone — a fatal condition),
    // so the size warning does not represent a real cost.
    #[allow(clippy::result_large_err)]
    pub fn send(&self, command: WorkerCommand) -> Result<(), mpsc::SendError<WorkerCommand>> {
        self.command_tx.send(command)
    }
}

struct WorkerSession {
    metadata: SessionMetadata,
    family_capabilities: ModelFamilyCapabilities,
    model: SessionModel,
    processors: Vec<Box<dyn StageProcessor>>,
    diarizer: Option<SessionDiarizer>,
    warnings: Vec<RequestWarning>,
}

enum SessionModel {
    Batch(Box<dyn LoadedModel>),
    Streaming {
        model: Box<dyn StreamingModel>,
        utterance: Option<OpenStreamingUtterance>,
    },
}

struct LoadedSessionResources {
    family_capabilities: ModelFamilyCapabilities,
    model: SessionModel,
}

const PARTIAL_CADENCE_MS: u64 = 500;
const PARTIAL_CADENCE_SAMPLES: usize = 8_000;

struct OpenStreamingUtterance {
    cadence: PartialCadence,
    last_emitted_text: String,
    next_revision: u32,
    utterance: LiveUtterance,
    utterance_id: Uuid,
}

struct PartialCadence {
    last_decode_wall_ms: u64,
    samples_since_decode: usize,
}

impl PartialCadence {
    fn new(now_ms: u64, initial_samples: usize) -> Self {
        Self {
            last_decode_wall_ms: now_ms,
            samples_since_decode: initial_samples,
        }
    }

    fn observe(&mut self, samples: usize) {
        self.samples_since_decode = self.samples_since_decode.saturating_add(samples);
    }

    fn take_if_due(&mut self, now_ms: u64) -> bool {
        if self.samples_since_decode < PARTIAL_CADENCE_SAMPLES
            || now_ms.saturating_sub(self.last_decode_wall_ms) < PARTIAL_CADENCE_MS
        {
            return false;
        }

        self.samples_since_decode = 0;
        self.last_decode_wall_ms = now_ms;
        true
    }
}

fn load_session_resources(
    registry: &EngineRegistry,
    metadata: &SessionMetadata,
) -> Result<LoadedSessionResources, TranscriptionError> {
    let adapter = registry
        .adapter(metadata.runtime_id, metadata.family_id)
        .ok_or_else(|| missing_adapter_error(metadata.runtime_id, metadata.family_id))?;
    let family_capabilities = adapter.capabilities().clone();
    let model = if family_capabilities.supports_streaming {
        SessionModel::Streaming {
            model: adapter.load_streaming(&metadata.model_file_path, metadata.gpu_config)?,
            utterance: None,
        }
    } else {
        SessionModel::Batch(adapter.load(&metadata.model_file_path, metadata.gpu_config)?)
    };

    Ok(LoadedSessionResources {
        family_capabilities,
        model,
    })
}

fn worker_main(
    command_rx: Receiver<WorkerCommand>,
    event_tx: Sender<WorkerEvent>,
    registry: Arc<EngineRegistry>,
) {
    let mut sessions: HashMap<String, WorkerSession> = HashMap::new();
    let tokio_runtime = Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("worker tokio runtime should build");
    let worker_started_at = Instant::now();

    while let Ok(command) = command_rx.recv() {
        match command {
            WorkerCommand::BeginStreamingUtterance {
                session_id,
                utterance,
                utterance_id,
            } => {
                let now_ms = worker_started_at.elapsed().as_millis() as u64;
                if let Some(session) = sessions.get_mut(&session_id) {
                    let result = panic::catch_unwind(AssertUnwindSafe(|| {
                        begin_streaming_utterance(session, utterance, utterance_id, now_ms)
                    }));
                    match result {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => {
                            send_worker_error(
                                &event_tx,
                                session_id,
                                Some(utterance_id),
                                false,
                                error,
                            );
                        }
                        Err(payload) => {
                            clear_streaming_utterance(session);
                            let message = format_panic_message(
                                payload.as_ref(),
                                "Worker thread panicked beginning a streaming utterance",
                            );
                            let _ = event_tx.send(WorkerEvent::SessionError {
                                code: "worker_panic".to_string(),
                                details: None,
                                finalizes_utterance: false,
                                message,
                                session_id,
                                utterance_id: Some(utterance_id),
                            });
                        }
                    }
                }
            }
            WorkerCommand::BeginSession(metadata) => {
                let load_result = panic::catch_unwind(AssertUnwindSafe(|| {
                    load_session_resources(registry.as_ref(), &metadata)
                }));

                match load_result {
                    Ok(Ok(resources)) => {
                        let streaming = resources.family_capabilities.supports_streaming;
                        let warnings = session_request_warnings(
                            &resources.family_capabilities,
                            metadata.diarization_enabled,
                            &metadata.language,
                        );
                        let diarizer = if metadata.diarization_enabled && !streaming {
                            match SessionDiarizer::new() {
                                Ok(diarizer) => Some(diarizer),
                                Err(error) => {
                                    eprintln!(
                                        "diarization disabled for session: failed to load speaker-embedding model: {error}"
                                    );
                                    None
                                }
                            }
                        } else {
                            None
                        };
                        let processors = post_engine_processors(&metadata.user_rules);
                        sessions.insert(
                            metadata.session_id.clone(),
                            WorkerSession {
                                metadata,
                                family_capabilities: resources.family_capabilities,
                                model: resources.model,
                                processors,
                                diarizer,
                                warnings,
                            },
                        );
                    }
                    Ok(Err(error)) => {
                        let _ = event_tx.send(WorkerEvent::SessionError {
                            code: error.code.to_string(),
                            details: error.details,
                            finalizes_utterance: false,
                            message: error.message.to_string(),
                            session_id: metadata.session_id,
                            utterance_id: None,
                        });
                    }
                    Err(payload) => {
                        let message = format_panic_message(
                            payload.as_ref(),
                            "Worker thread panicked loading model",
                        );
                        let _ = event_tx.send(WorkerEvent::SessionError {
                            code: "worker_panic".to_string(),
                            details: None,
                            finalizes_utterance: false,
                            message,
                            session_id: metadata.session_id,
                            utterance_id: None,
                        });
                    }
                }
            }
            WorkerCommand::EndSession { session_id } => {
                sessions.remove(&session_id);
            }
            WorkerCommand::Shutdown => break,
            WorkerCommand::StreamAudio {
                samples,
                session_id,
                utterance_id,
            } => {
                let now_ms = worker_started_at.elapsed().as_millis() as u64;
                if let Some(session) = sessions.get_mut(&session_id) {
                    let result = panic::catch_unwind(AssertUnwindSafe(|| {
                        stream_audio(
                            session,
                            &event_tx,
                            &tokio_runtime,
                            &session_id,
                            utterance_id,
                            &samples,
                            now_ms,
                        )
                    }));
                    match result {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => {
                            send_worker_error(
                                &event_tx,
                                session_id,
                                Some(utterance_id),
                                false,
                                error,
                            );
                        }
                        Err(payload) => {
                            clear_streaming_utterance(session);
                            let message = format_panic_message(
                                payload.as_ref(),
                                "Worker thread panicked streaming audio",
                            );
                            let _ = event_tx.send(WorkerEvent::SessionError {
                                code: "worker_panic".to_string(),
                                details: None,
                                finalizes_utterance: false,
                                message,
                                session_id,
                                utterance_id: Some(utterance_id),
                            });
                        }
                    }
                }
            }
            WorkerCommand::FinalizeStreamingUtterance {
                session_id,
                utterance,
                utterance_id,
            } => {
                if let Some(session) = sessions.get_mut(&session_id) {
                    let result = panic::catch_unwind(AssertUnwindSafe(|| {
                        finalize_streaming_utterance(
                            session,
                            &event_tx,
                            &tokio_runtime,
                            &session_id,
                            utterance,
                            utterance_id,
                        )
                    }));
                    match result {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => {
                            send_worker_error(
                                &event_tx,
                                session_id,
                                Some(utterance_id),
                                true,
                                error,
                            );
                        }
                        Err(payload) => {
                            clear_streaming_utterance(session);
                            let message = format_panic_message(
                                payload.as_ref(),
                                "Worker thread panicked finalizing a streaming utterance",
                            );
                            let _ = event_tx.send(WorkerEvent::SessionError {
                                code: "worker_panic".to_string(),
                                details: None,
                                finalizes_utterance: true,
                                message,
                                session_id,
                                utterance_id: Some(utterance_id),
                            });
                        }
                    }
                }
            }
            WorkerCommand::TranscribeUtterance {
                context,
                session_id,
                utterance,
                utterance_id,
            } => {
                let Some(session) = sessions.get_mut(&session_id) else {
                    continue;
                };

                let utterance_duration_ms = utterance.duration_ms();
                let utterance_end_ms_in_session = utterance.utterance_end_ms_in_session();
                let utterance_start_ms_in_session = utterance.utterance_start_ms_in_session();
                let FinalizedUtterance {
                    // Batch transcription re-decodes the whole utterance, so the
                    // streaming carry-forward marker is irrelevant here.
                    carries_audio_forward: _,
                    pause_ms_before_utterance,
                    samples,
                    utterance_index,
                    vad_probabilities,
                    voice_activity,
                } = utterance;
                let audio_samples: Vec<f32> = samples
                    .iter()
                    .map(|&sample| sample as f32 / 32768.0)
                    .collect();

                let mut request = TranscriptionRequest {
                    audio_samples,
                    gpu_config: session.metadata.gpu_config,
                    language: session.metadata.language.clone(),
                    model_file_path: session.metadata.model_file_path.clone(),
                    context,
                };
                let stage_context = request.context.clone();

                let warnings = apply_capability_gates(&session.family_capabilities, &mut request);

                let started_at = Instant::now();
                let result = panic::catch_unwind(AssertUnwindSafe(|| match &mut session.model {
                    SessionModel::Batch(model) => model.transcribe(&request),
                    SessionModel::Streaming { .. } => Err(TranscriptionError::unsupported_engine(
                        "streaming model received a batch transcription command".to_string(),
                    )),
                }));
                let engine_duration_ms = started_at.elapsed().as_millis() as u64;

                match result {
                    Ok(Ok(engine_output)) => {
                        let mut transcript = assemble_transcript(TranscriptAssembly {
                            utterance_id,
                            engine_output,
                            engine_duration_ms,
                            is_final: true,
                            pause_ms_before_utterance,
                            vad_probabilities: &vad_probabilities,
                            voice_activity,
                            context: stage_context.as_ref(),
                            family_capabilities: &session.family_capabilities,
                            stage_enablement: &session.metadata.stage_enablement,
                            processors: &session.processors,
                            tokio_runtime: &tokio_runtime,
                            cancel_rx: &session.metadata.cancel_rx,
                        });
                        let speaker_index = diarize_utterance(
                            session.diarizer.as_mut(),
                            &mut transcript,
                            &request.audio_samples,
                        );
                        let _ = event_tx.send(WorkerEvent::TranscriptReady {
                            pause_ms_before_utterance,
                            processing_duration_ms: started_at.elapsed().as_millis() as u64,
                            session_id,
                            speaker_index,
                            transcript,
                            utterance_duration_ms,
                            utterance_end_ms_in_session,
                            utterance_index,
                            utterance_start_ms_in_session,
                            warnings,
                        });
                    }
                    Ok(Err(error)) => {
                        let _ = event_tx.send(WorkerEvent::SessionError {
                            code: error.code.to_string(),
                            details: error.details,
                            finalizes_utterance: true,
                            message: error.message.to_string(),
                            session_id,
                            utterance_id: Some(utterance_id),
                        });
                    }
                    Err(payload) => {
                        let message = format_panic_message(
                            payload.as_ref(),
                            "Worker thread panicked during transcription",
                        );
                        let _ = event_tx.send(WorkerEvent::SessionError {
                            code: "worker_panic".to_string(),
                            details: None,
                            finalizes_utterance: true,
                            message,
                            session_id,
                            utterance_id: Some(utterance_id),
                        });
                    }
                }
            }
        }
    }
}

/// Drop the session's open streaming utterance, if any, after a caught panic.
/// A panic can leave the adapter's incremental decode state unknown, so the
/// safe move is to end the affected utterance the same way a clean adapter
/// `Err` already does for `finalize_streaming_utterance` (which takes the
/// slot before calling the model at all): the next `StreamAudio` for this
/// utterance id becomes a no-op, and the next `FinalizeStreamingUtterance`
/// falls through to `model.reset_utterance()` + a full re-feed instead of
/// trusting whatever the model was doing when it panicked.
fn clear_streaming_utterance(session: &mut WorkerSession) {
    if let SessionModel::Streaming { utterance, .. } = &mut session.model {
        *utterance = None;
    }
}

fn begin_streaming_utterance(
    session: &mut WorkerSession,
    utterance: LiveUtterance,
    utterance_id: Uuid,
    now_ms: u64,
) -> Result<(), TranscriptionError> {
    let SessionModel::Streaming {
        model,
        utterance: open,
    } = &mut session.model
    else {
        return Err(TranscriptionError::unsupported_engine(
            "batch model received streaming audio".to_string(),
        ));
    };

    model.reset_utterance();
    model.accept_audio(&utterance.samples)?;
    let initial_samples = utterance.samples.len();
    *open = Some(OpenStreamingUtterance {
        cadence: PartialCadence::new(now_ms, initial_samples),
        last_emitted_text: String::new(),
        next_revision: 0,
        utterance,
        utterance_id,
    });
    Ok(())
}

fn stream_audio(
    session: &mut WorkerSession,
    event_tx: &Sender<WorkerEvent>,
    tokio_runtime: &Runtime,
    session_id: &str,
    utterance_id: Uuid,
    samples: &[i16],
    now_ms: u64,
) -> Result<(), TranscriptionError> {
    let started_at = Instant::now();
    let SessionModel::Streaming {
        model,
        utterance: open,
    } = &mut session.model
    else {
        return Err(TranscriptionError::unsupported_engine(
            "batch model received streaming audio".to_string(),
        ));
    };
    let Some(open) = open
        .as_mut()
        .filter(|open| open.utterance_id == utterance_id)
    else {
        return Ok(());
    };

    model.accept_audio(samples)?;
    open.utterance.samples.extend_from_slice(samples);
    open.cadence.observe(samples.len());
    if !open.cadence.take_if_due(now_ms) {
        return Ok(());
    }

    let engine_started_at = Instant::now();
    let engine_output = model.partial()?;
    let engine_duration_ms = engine_started_at.elapsed().as_millis() as u64;
    let text = joined_engine_text(&engine_output);
    if text == open.last_emitted_text {
        return Ok(());
    }

    let revision = open.next_revision;
    open.next_revision = open.next_revision.saturating_add(1);
    open.last_emitted_text = text;
    let utterance_duration_ms = (open.utterance.samples.len() as u64 * 1_000) / 16_000;
    let utterance_start_ms_in_session = open.utterance.voice_activity.audio_start_ms;
    let utterance_end_ms_in_session =
        utterance_start_ms_in_session.saturating_add(utterance_duration_ms);
    let mut voice_activity = open.utterance.voice_activity;
    voice_activity.audio_end_ms = utterance_end_ms_in_session;

    let transcript = offset_transcript_revision(
        assemble_transcript(TranscriptAssembly {
            utterance_id,
            engine_output,
            engine_duration_ms,
            is_final: false,
            pause_ms_before_utterance: open.utterance.pause_ms_before_utterance,
            vad_probabilities: &open.utterance.vad_probabilities,
            voice_activity,
            context: None,
            family_capabilities: &session.family_capabilities,
            stage_enablement: &session.metadata.stage_enablement,
            processors: &[],
            tokio_runtime,
            cancel_rx: &session.metadata.cancel_rx,
        }),
        revision,
    );

    let _ = event_tx.send(WorkerEvent::TranscriptReady {
        pause_ms_before_utterance: open.utterance.pause_ms_before_utterance,
        processing_duration_ms: started_at.elapsed().as_millis() as u64,
        session_id: session_id.to_string(),
        speaker_index: None,
        transcript,
        utterance_duration_ms,
        utterance_end_ms_in_session,
        utterance_index: open.utterance.utterance_index,
        utterance_start_ms_in_session,
        warnings: session.warnings.clone(),
    });
    Ok(())
}

fn finalize_streaming_utterance(
    session: &mut WorkerSession,
    event_tx: &Sender<WorkerEvent>,
    tokio_runtime: &Runtime,
    session_id: &str,
    utterance: FinalizedUtterance,
    utterance_id: Uuid,
) -> Result<(), TranscriptionError> {
    let started_at = Instant::now();
    let utterance_duration_ms = utterance.duration_ms();
    let utterance_end_ms_in_session = utterance.utterance_end_ms_in_session();
    let utterance_start_ms_in_session = utterance.utterance_start_ms_in_session();
    let FinalizedUtterance {
        carries_audio_forward,
        pause_ms_before_utterance,
        samples,
        utterance_index,
        vad_probabilities,
        voice_activity,
    } = utterance;

    let SessionModel::Streaming {
        model,
        utterance: open,
    } = &mut session.model
    else {
        return Err(TranscriptionError::unsupported_engine(
            "batch model received a streaming final".to_string(),
        ));
    };
    let open = open.take();
    let revision = open.as_ref().map_or(0, |open| open.next_revision);
    match open
        .as_ref()
        .filter(|open| open.utterance_id == utterance_id)
    {
        Some(open) if samples.starts_with(&open.utterance.samples) => {
            let missing_tail = &samples[open.utterance.samples.len()..];
            if !missing_tail.is_empty() {
                model.accept_audio(missing_tail)?;
            }
        }
        Some(open) if !carries_audio_forward && open.utterance.samples.starts_with(&samples) => {
            // Pause-driven finalization trims the silence hangover already fed
            // to the streaming model. That suffix carries no speech, so keep
            // the incremental state instead of resetting and re-feeding the
            // finalized prefix. A boundary cap-split (`carries_audio_forward`)
            // is excluded here: its streamed suffix is voice carried into the
            // next utterance, so it must fall through to a reset and re-feed.
        }
        _ => {
            model.reset_utterance();
            model.accept_audio(&samples)?;
        }
    }

    let engine_started_at = Instant::now();
    let engine_output = model.finalize_utterance()?;
    let engine_duration_ms = engine_started_at.elapsed().as_millis() as u64;
    let transcript = offset_transcript_revision(
        assemble_transcript(TranscriptAssembly {
            utterance_id,
            engine_output,
            engine_duration_ms,
            is_final: true,
            pause_ms_before_utterance,
            vad_probabilities: &vad_probabilities,
            voice_activity,
            context: None,
            family_capabilities: &session.family_capabilities,
            stage_enablement: &session.metadata.stage_enablement,
            processors: &session.processors,
            tokio_runtime,
            cancel_rx: &session.metadata.cancel_rx,
        }),
        revision,
    );

    let _ = event_tx.send(WorkerEvent::TranscriptReady {
        pause_ms_before_utterance,
        processing_duration_ms: started_at.elapsed().as_millis() as u64,
        session_id: session_id.to_string(),
        speaker_index: None,
        transcript,
        utterance_duration_ms,
        utterance_end_ms_in_session,
        utterance_index,
        utterance_start_ms_in_session,
        warnings: session.warnings.clone(),
    });
    Ok(())
}

fn send_worker_error(
    event_tx: &Sender<WorkerEvent>,
    session_id: String,
    utterance_id: Option<Uuid>,
    finalizes_utterance: bool,
    error: TranscriptionError,
) {
    let _ = event_tx.send(WorkerEvent::SessionError {
        code: error.code.to_string(),
        details: error.details,
        finalizes_utterance,
        message: error.message.to_string(),
        session_id,
        utterance_id,
    });
}

fn session_request_warnings(
    capabilities: &ModelFamilyCapabilities,
    diarization_enabled: bool,
    language: &str,
) -> Vec<RequestWarning> {
    let mut warnings = Vec::new();
    if capabilities.supports_streaming && diarization_enabled {
        warnings.push(RequestWarning {
            field: "diarizationEnabled".to_string(),
            reason:
                "diarization dropped because streaming sessions do not support speaker attribution"
                    .to_string(),
        });
    }
    if capabilities.supports_streaming
        && !capabilities.supports_language_selection
        && !language.eq_ignore_ascii_case("en")
    {
        warnings.push(RequestWarning {
            field: "language".to_string(),
            reason:
                "language dropped because streaming adapter does not advertise supports_language_selection"
                    .to_string(),
        });
    }
    warnings
}

fn joined_engine_text(output: &EngineTranscriptOutput) -> String {
    output
        .segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn offset_transcript_revision(mut transcript: Transcript, offset: u32) -> Transcript {
    if offset == 0 {
        return transcript;
    }

    transcript.revision = transcript.revision.saturating_add(offset);
    for stage in &mut transcript.stage_history {
        stage.revision_in = stage.revision_in.saturating_add(offset);
        stage.revision_out = stage
            .revision_out
            .map(|revision| revision.saturating_add(offset));
    }
    transcript
}

struct TranscriptAssembly<'a> {
    utterance_id: Uuid,
    engine_output: EngineTranscriptOutput,
    engine_duration_ms: u64,
    is_final: bool,
    pause_ms_before_utterance: Option<u64>,
    vad_probabilities: &'a [f32],
    voice_activity: crate::audio_metadata::VoiceActivityEvidence,
    context: Option<&'a ContextWindow>,
    family_capabilities: &'a ModelFamilyCapabilities,
    stage_enablement: &'a StageEnablement,
    processors: &'a [Box<dyn StageProcessor>],
    tokio_runtime: &'a Runtime,
    cancel_rx: &'a watch::Receiver<bool>,
}

/// Run diarization on a finalized utterance after the text stages. Splits the
/// utterance into speaker turns, attributes each transcript segment to the turn
/// it overlaps most, and returns the utterance's *dominant* speaker (the one
/// credited with the most audio) for the back-compat utterance-level field.
/// Returns `None` when diarization is disabled or the utterance has no surviving
/// text. Records a `Diarization` stage outcome whenever it runs.
fn diarize_utterance(
    diarizer: Option<&mut SessionDiarizer>,
    transcript: &mut Transcript,
    samples: &[f32],
) -> Option<u32> {
    let diarizer = diarizer?;
    if transcript.joined_text().is_empty() {
        return None;
    }

    let revision = transcript.revision;
    let started_at = Instant::now();
    match diarizer.diarize(samples) {
        Ok(turns) => {
            let dominant = assign_segment_speakers(&mut transcript.segments, &turns);
            let speaker_count = turns
                .iter()
                .map(|turn| turn.speaker_index)
                .collect::<std::collections::HashSet<_>>()
                .len();
            transcript.stage_history.push(StageOutcome {
                duration_ms: started_at.elapsed().as_millis() as u64,
                is_final: true,
                payload: Some(serde_json::json!({
                    "speakerIndex": dominant,
                    "turnCount": turns.len(),
                    "speakerCount": speaker_count,
                })),
                revision_in: revision,
                revision_out: Some(revision),
                stage_id: StageId::Diarization,
                status: StageStatus::Ok,
            });
            dominant
        }
        Err(error) => {
            transcript.stage_history.push(StageOutcome {
                duration_ms: started_at.elapsed().as_millis() as u64,
                is_final: true,
                payload: None,
                revision_in: revision,
                revision_out: None,
                stage_id: StageId::Diarization,
                status: StageStatus::Failed { error },
            });
            None
        }
    }
}

/// Attribute each transcript segment to the speaker of the turn it overlaps
/// most; a segment overlapping no turn falls back to the nearest turn by
/// midpoint, so every segment is labelled whenever any turn exists. Returns the
/// dominant speaker (most attributed audio) for the utterance-level field.
fn assign_segment_speakers(
    segments: &mut [TranscriptSegment],
    turns: &[SpeakerTurn],
) -> Option<u32> {
    if turns.is_empty() {
        return None;
    }

    let mut duration_by_speaker: HashMap<u32, u64> = HashMap::new();
    for segment in segments.iter_mut() {
        let speaker =
            best_overlap_speaker(segment, turns).or_else(|| nearest_turn_speaker(segment, turns));
        segment.speaker = speaker;
        if let Some(speaker) = speaker {
            *duration_by_speaker.entry(speaker).or_default() +=
                segment.end_ms.saturating_sub(segment.start_ms).max(1);
        }
    }

    duration_by_speaker
        .into_iter()
        .max_by_key(|&(_, duration)| duration)
        .map(|(speaker, _)| speaker)
}

fn best_overlap_speaker(segment: &TranscriptSegment, turns: &[SpeakerTurn]) -> Option<u32> {
    turns
        .iter()
        .filter_map(|turn| {
            let overlap = overlap_ms(segment.start_ms, segment.end_ms, turn.start_ms, turn.end_ms);
            (overlap > 0).then_some((overlap, turn.speaker_index))
        })
        .max_by_key(|&(overlap, _)| overlap)
        .map(|(_, speaker)| speaker)
}

fn nearest_turn_speaker(segment: &TranscriptSegment, turns: &[SpeakerTurn]) -> Option<u32> {
    let midpoint = (segment.start_ms + segment.end_ms) / 2;
    turns
        .iter()
        .min_by_key(|turn| ((turn.start_ms + turn.end_ms) / 2).abs_diff(midpoint))
        .map(|turn| turn.speaker_index)
}

fn overlap_ms(a_start: u64, a_end: u64, b_start: u64, b_end: u64) -> u64 {
    a_end.min(b_end).saturating_sub(a_start.max(b_start))
}

fn assemble_transcript(input: TranscriptAssembly<'_>) -> Transcript {
    let revision: u32 = 0;
    let mut stage_history: Vec<StageOutcome> = Vec::with_capacity(1 + input.processors.len());
    let EngineTranscriptOutput {
        segments,
        diagnostics,
    } = input.engine_output;

    stage_history.push(StageOutcome {
        duration_ms: input.engine_duration_ms,
        is_final: input.is_final,
        payload: Some(
            serde_json::to_value(EngineStagePayload {
                pause_ms_before_utterance: input.pause_ms_before_utterance,
                voice_activity: input.voice_activity,
            })
            .expect("EngineStagePayload serialization should not fail"),
        ),
        revision_in: revision,
        revision_out: Some(revision),
        stage_id: StageId::Engine,
        status: StageStatus::Ok,
    });

    let mut transcript = Transcript {
        utterance_id: input.utterance_id,
        revision,
        segments,
        stage_history,
    };

    let ctx = StageContext {
        context: input.context,
        family_capabilities: input.family_capabilities,
        stage_enabled: input.stage_enablement,
        is_final: input.is_final,
        tokio_runtime: input.tokio_runtime,
        cancel_rx: input.cancel_rx,
        pause_ms_before_utterance: input.pause_ms_before_utterance,
        segment_diagnostics: &diagnostics,
        vad_probabilities: input.vad_probabilities,
        voice_activity: &input.voice_activity,
    };
    run_post_engine(&mut transcript, input.processors, &ctx);

    transcript
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Mutex;
    use std::time::Duration;

    use super::*;
    use crate::audio_metadata::voiced_fraction;
    use crate::engine::capabilities::LanguageSupport;
    use crate::engine::traits::ModelFamilyAdapter;
    use crate::protocol::{
        ListeningMode, TimestampGranularity, TimestampSource, TranscriptSegment,
    };
    use crate::session::{
        ListeningSession, SessionAction, SessionConfig, SpeakingStyle, VoiceActivityDetector,
        VoiceActivityError,
    };
    use crate::stages::StageProcess;

    #[test]
    fn streaming_simulation_emits_monotonic_partials_and_batch_equivalent_final() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/audio/7021-79740-0000.wav");
        let mut reader = hound::WavReader::open(fixture).unwrap();
        let samples: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
        assert!(samples.len() > PARTIAL_CADENCE_SAMPLES * 2);
        let frames: Vec<Vec<i16>> = samples
            .chunks(320)
            .map(|chunk| {
                let mut frame = chunk.to_vec();
                frame.resize(320, 0);
                frame
            })
            .collect();

        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let metadata = SessionMetadata {
            runtime_id: RuntimeId::OnnxRuntime,
            family_id: ModelFamilyId::Moonshine,
            gpu_config: GpuConfig::default(),
            diarization_enabled: false,
            language: "en".to_string(),
            model_file_path: PathBuf::from("/tmp/frontend.ort"),
            cancel_rx,
            session_start_unix_ms: 0,
            session_id: "streaming-test".to_string(),
            stage_enablement: StageEnablement::default(),
            user_rules: Vec::new(),
        };
        let mut worker_session = WorkerSession {
            metadata,
            family_capabilities: streaming_caps(),
            model: SessionModel::Streaming {
                model: Box::new(FixtureStreamingModel::default()),
                utterance: None,
            },
            processors: post_engine_processors(&[]),
            diarizer: None,
            warnings: Vec::new(),
        };
        let utterance_id = Uuid::new_v4();
        let mut listening_session = ListeningSession::with_vad(
            SessionConfig {
                mode: ListeningMode::AlwaysOn,
                session_start_unix_ms: 0,
                session_id: "streaming-test".to_string(),
                style: SpeakingStyle::Balanced,
            },
            FixtureVad {
                calls: 0,
                speech_frames: frames.len(),
            },
        );
        let runtime = test_runtime();
        let (event_tx, event_rx) = mpsc::channel();
        let mut opened = false;
        let mut finalized_samples = None;

        for index in 0..frames.len() + 50 {
            let frame = frames.get(index).cloned().unwrap_or_else(|| vec![0; 320]);
            let frame_bytes: Vec<u8> = frame
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect();
            let actions = listening_session.ingest_audio_frame(&frame_bytes).unwrap();
            for action in actions {
                if let SessionAction::FinalizeUtterance(utterance) = action {
                    finalized_samples = Some(utterance.samples.clone());
                    finalize_streaming_utterance(
                        &mut worker_session,
                        &event_tx,
                        &runtime,
                        "streaming-test",
                        utterance,
                        utterance_id,
                    )
                    .unwrap();
                }
            }

            let Some(live) = listening_session.live_utterance() else {
                continue;
            };
            if opened {
                stream_audio(
                    &mut worker_session,
                    &event_tx,
                    &runtime,
                    "streaming-test",
                    utterance_id,
                    &frame,
                    ((index + 1) * 20) as u64,
                )
                .unwrap();
            } else {
                begin_streaming_utterance(
                    &mut worker_session,
                    live,
                    utterance_id,
                    ((index + 1) * 20) as u64,
                )
                .unwrap();
                opened = true;
            }
        }

        let finalized_samples = finalized_samples.expect("VAD should finalize the fixture");
        let mut expected_model = FixtureStreamingModel::default();
        expected_model.accept_audio(&finalized_samples).unwrap();
        let expected_final = joined_engine_text(&expected_model.finalize_utterance().unwrap());

        let events: Vec<WorkerEvent> = event_rx.try_iter().collect();
        let transcripts: Vec<&Transcript> = events
            .iter()
            .filter_map(|event| match event {
                WorkerEvent::TranscriptReady { transcript, .. } => Some(transcript),
                WorkerEvent::SessionError { .. } => None,
            })
            .collect();
        assert!(transcripts.len() >= 3);
        assert!(
            transcripts
                .windows(2)
                .all(|window| window[0].revision < window[1].revision)
        );

        let partial_events: Vec<&WorkerEvent> = events
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    WorkerEvent::TranscriptReady { transcript, .. } if !transcript.is_final()
                )
            })
            .collect();
        assert!(partial_events.len() >= 2);
        let partial_durations: Vec<u64> = partial_events
            .iter()
            .filter_map(|event| match event {
                WorkerEvent::TranscriptReady {
                    transcript,
                    utterance_duration_ms,
                    ..
                } => {
                    assert_eq!(transcript.stage_history.len(), 1);
                    assert_eq!(transcript.stage_history[0].stage_id, StageId::Engine);
                    assert!(!transcript.stage_history[0].is_final);
                    Some(*utterance_duration_ms)
                }
                WorkerEvent::SessionError { .. } => None,
            })
            .collect();
        assert!(
            partial_durations
                .windows(2)
                .all(|window| (500..=520).contains(&window[1].saturating_sub(window[0])))
        );

        let final_transcript = transcripts.last().unwrap();
        assert!(final_transcript.is_final());
        assert!(final_transcript.stage_history.len() > 1);
        assert_eq!(final_transcript.joined_text(), expected_final);
    }

    #[test]
    fn pause_finalize_reuses_streamed_state_after_silence_trim() {
        let outcome = run_counted_streaming_finalize(FixtureVad {
            calls: 0,
            speech_frames: 20,
        });
        let counts = outcome.counts.lock().expect("feed counts lock");

        assert_eq!(counts.reset_calls, 1, "finalize must not reset and re-feed");
        assert!(
            counts.accepted_samples > outcome.finalized_samples,
            "the fixture must exercise trimmed silence already present in streamed state"
        );
    }

    #[test]
    fn cap_split_feeds_only_the_unstreamed_tail() {
        let outcome = run_counted_streaming_finalize(FixtureVad {
            calls: 0,
            speech_frames: usize::MAX,
        });
        let counts = outcome.counts.lock().expect("feed counts lock");

        assert_eq!(counts.reset_calls, 1, "finalize must not reset and re-feed");
        assert_eq!(
            counts.accepted_samples, outcome.finalized_samples,
            "each capped utterance sample must be fed exactly once"
        );
    }

    #[test]
    fn boundary_cap_split_resets_and_refeeds_only_the_finalized_prefix() {
        // Speech for 1400 frames, a 20-frame dip below the speech threshold (but
        // above the negative threshold, so it registers a silence boundary
        // without arming a pause finalize), then resumed speech until the 30 s
        // cap. `split_at_boundary` cuts at the boundary and carries the resumed
        // speech into the next utterance, so the streamed state holds voice that
        // does not belong to this final.
        let probabilities: Vec<f32> = std::iter::repeat_n(1.0_f32, 1_400)
            .chain(std::iter::repeat_n(0.4_f32, 20))
            .chain(std::iter::repeat_n(1.0_f32, 200))
            .collect();
        let outcome = run_counted_streaming_finalize(ScriptedVad {
            probabilities,
            index: 0,
        });
        let counts = outcome.counts.lock().expect("feed counts lock");

        // Only a prefix of the streamed audio is finalized: the voiced suffix is
        // carried forward, so this is a genuine boundary split, not a hard cut.
        assert!(
            outcome.finalized_samples < outcome.streamed_samples,
            "boundary split must finalize a prefix of the streamed audio"
        );
        // begin_streaming_utterance resets once; the boundary split forces a
        // second reset so the carried-forward speech is not folded into this
        // final and then transcribed again in the next utterance.
        assert_eq!(
            counts.reset_calls, 2,
            "boundary cap-split must reset and re-feed the finalized prefix"
        );
        assert_eq!(
            counts.accepted_samples,
            outcome.streamed_samples + outcome.finalized_samples,
            "the finalized prefix is re-fed exactly once after the reset"
        );
    }

    // --- Panic-boundary coverage for the streaming worker commands ---
    //
    // These drive `worker_main` itself (not the per-command helpers directly)
    // through a real channel and a real spawned thread, so a regression that
    // removes a `catch_unwind` would surface as the thread dying: `handle.join()`
    // returning `Err`, or the follow-up "ping" command never getting a reply.

    /// A `StreamingModel` whose panics are scripted by call count, so a single
    /// adapter can be reused across the begin/stream/finalize panic tests
    /// without needing three near-duplicate fakes.
    struct ScriptedPanicModel {
        accept_calls: usize,
        panic_on_accept_call: Option<usize>,
        panic_on_finalize: bool,
    }

    impl StreamingModel for ScriptedPanicModel {
        fn accept_audio(&mut self, _samples: &[i16]) -> Result<(), TranscriptionError> {
            self.accept_calls += 1;
            if self.panic_on_accept_call == Some(self.accept_calls) {
                panic!("synthetic accept_audio panic");
            }
            Ok(())
        }

        fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
            Ok(fixture_output("panic-test partial".to_string()))
        }

        fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
            if self.panic_on_finalize {
                panic!("synthetic finalize_utterance panic");
            }
            Ok(fixture_output("panic-test final".to_string()))
        }

        fn reset_utterance(&mut self) {}
    }

    struct ScriptedPanicAdapter {
        capabilities: ModelFamilyCapabilities,
        panic_on_accept_call: Option<usize>,
        panic_on_finalize: bool,
    }

    impl ModelFamilyAdapter for ScriptedPanicAdapter {
        fn runtime_id(&self) -> RuntimeId {
            RuntimeId::OnnxRuntime
        }

        fn family_id(&self) -> ModelFamilyId {
            ModelFamilyId::Moonshine
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
                "panic-test adapter is streaming-only".to_string(),
            ))
        }

        fn load_streaming(
            &self,
            _path: &Path,
            _gpu: GpuConfig,
        ) -> Result<Box<dyn StreamingModel>, TranscriptionError> {
            Ok(Box::new(ScriptedPanicModel {
                accept_calls: 0,
                panic_on_accept_call: self.panic_on_accept_call,
                panic_on_finalize: self.panic_on_finalize,
            }))
        }
    }

    fn panic_streaming_registry(
        panic_on_accept_call: Option<usize>,
        panic_on_finalize: bool,
    ) -> Arc<EngineRegistry> {
        let mut registry = EngineRegistry::default();
        registry.register_adapter(Box::new(ScriptedPanicAdapter {
            capabilities: streaming_caps(),
            panic_on_accept_call,
            panic_on_finalize,
        }));
        Arc::new(registry)
    }

    fn spawn_test_worker(
        registry: Arc<EngineRegistry>,
    ) -> (
        Sender<WorkerCommand>,
        Receiver<WorkerEvent>,
        thread::JoinHandle<()>,
    ) {
        let (command_tx, command_rx) = mpsc::channel();
        let (event_tx, event_rx) = mpsc::channel();
        let handle = thread::spawn(move || worker_main(command_rx, event_tx, registry));
        (command_tx, event_rx, handle)
    }

    fn streaming_session_metadata(session_id: &str) -> SessionMetadata {
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        SessionMetadata {
            runtime_id: RuntimeId::OnnxRuntime,
            family_id: ModelFamilyId::Moonshine,
            gpu_config: GpuConfig::default(),
            diarization_enabled: false,
            language: "en".to_string(),
            model_file_path: PathBuf::from("/tmp/frontend.ort"),
            cancel_rx,
            session_start_unix_ms: 0,
            session_id: session_id.to_string(),
            stage_enablement: StageEnablement::default(),
            user_rules: Vec::new(),
        }
    }

    fn live_utterance_fixture() -> LiveUtterance {
        LiveUtterance {
            pause_ms_before_utterance: None,
            samples: vec![0i16; 320],
            utterance_index: 0,
            vad_probabilities: Vec::new(),
            voice_activity: voice_activity(),
        }
    }

    fn finalized_utterance_fixture(samples: Vec<i16>) -> FinalizedUtterance {
        FinalizedUtterance {
            carries_audio_forward: false,
            pause_ms_before_utterance: None,
            samples,
            utterance_index: 0,
            vad_probabilities: Vec::new(),
            voice_activity: voice_activity(),
        }
    }

    /// Sends a `TranscribeUtterance` "ping" against a still-streaming session
    /// and asserts a reply arrives. A streaming session always rejects a batch
    /// transcription with a deterministic `unsupported_engine` error (see the
    /// `TranscribeUtterance` dispatch arm), so this proves the worker thread
    /// is alive and still servicing its command channel after a caught panic,
    /// independent of whatever the panicking command left behind.
    fn assert_worker_still_responds(
        command_tx: &Sender<WorkerCommand>,
        event_rx: &Receiver<WorkerEvent>,
        session_id: &str,
    ) {
        let ping_id = Uuid::new_v4();
        command_tx
            .send(WorkerCommand::TranscribeUtterance {
                context: None,
                session_id: session_id.to_string(),
                utterance: finalized_utterance_fixture(vec![0i16; 320]),
                utterance_id: ping_id,
            })
            .expect("worker command channel should still accept commands");

        match event_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("worker thread should still respond after a caught panic")
        {
            WorkerEvent::SessionError {
                code, utterance_id, ..
            } => {
                assert_eq!(code, "unsupported_engine");
                assert_eq!(utterance_id, Some(ping_id));
            }
            other => panic!("expected a SessionError ping reply, got {other:?}"),
        }
    }

    #[test]
    fn begin_streaming_utterance_panic_is_caught_and_worker_survives() {
        let registry = panic_streaming_registry(Some(1), false);
        let (command_tx, event_rx, handle) = spawn_test_worker(registry);
        let session_id = "panic-begin".to_string();

        command_tx
            .send(WorkerCommand::BeginSession(streaming_session_metadata(
                &session_id,
            )))
            .unwrap();

        let utterance_id = Uuid::new_v4();
        command_tx
            .send(WorkerCommand::BeginStreamingUtterance {
                session_id: session_id.clone(),
                utterance: live_utterance_fixture(),
                utterance_id,
            })
            .unwrap();

        match event_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("panic should still emit a SessionError")
        {
            WorkerEvent::SessionError {
                code,
                finalizes_utterance,
                utterance_id: reported_id,
                ..
            } => {
                assert_eq!(code, "worker_panic");
                assert!(!finalizes_utterance);
                assert_eq!(reported_id, Some(utterance_id));
            }
            other => panic!("expected SessionError, got {other:?}"),
        }

        assert_worker_still_responds(&command_tx, &event_rx, &session_id);
        drop(command_tx);
        handle
            .join()
            .expect("worker thread must not die from a caught panic");
    }

    #[test]
    fn stream_audio_panic_is_caught_and_worker_survives() {
        // Call #1 is the accept_audio inside BeginStreamingUtterance (must
        // succeed so an utterance is actually open); call #2 is the first
        // StreamAudio, which panics.
        let registry = panic_streaming_registry(Some(2), false);
        let (command_tx, event_rx, handle) = spawn_test_worker(registry);
        let session_id = "panic-stream".to_string();

        command_tx
            .send(WorkerCommand::BeginSession(streaming_session_metadata(
                &session_id,
            )))
            .unwrap();

        let utterance_id = Uuid::new_v4();
        command_tx
            .send(WorkerCommand::BeginStreamingUtterance {
                session_id: session_id.clone(),
                utterance: live_utterance_fixture(),
                utterance_id,
            })
            .unwrap();
        command_tx
            .send(WorkerCommand::StreamAudio {
                samples: vec![0i16; 320],
                session_id: session_id.clone(),
                utterance_id,
            })
            .unwrap();

        match event_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("panic should still emit a SessionError")
        {
            WorkerEvent::SessionError {
                code,
                finalizes_utterance,
                utterance_id: reported_id,
                ..
            } => {
                assert_eq!(code, "worker_panic");
                assert!(!finalizes_utterance);
                assert_eq!(reported_id, Some(utterance_id));
            }
            other => panic!("expected SessionError, got {other:?}"),
        }

        assert_worker_still_responds(&command_tx, &event_rx, &session_id);
        drop(command_tx);
        handle
            .join()
            .expect("worker thread must not die from a caught panic");
    }

    #[test]
    fn finalize_streaming_utterance_panic_is_caught_and_worker_survives() {
        let registry = panic_streaming_registry(None, true);
        let (command_tx, event_rx, handle) = spawn_test_worker(registry);
        let session_id = "panic-finalize".to_string();

        command_tx
            .send(WorkerCommand::BeginSession(streaming_session_metadata(
                &session_id,
            )))
            .unwrap();

        let utterance_id = Uuid::new_v4();
        command_tx
            .send(WorkerCommand::BeginStreamingUtterance {
                session_id: session_id.clone(),
                utterance: live_utterance_fixture(),
                utterance_id,
            })
            .unwrap();
        command_tx
            .send(WorkerCommand::FinalizeStreamingUtterance {
                session_id: session_id.clone(),
                utterance: finalized_utterance_fixture(vec![0i16; 320]),
                utterance_id,
            })
            .unwrap();

        match event_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("panic should still emit a SessionError")
        {
            WorkerEvent::SessionError {
                code,
                finalizes_utterance,
                utterance_id: reported_id,
                ..
            } => {
                assert_eq!(code, "worker_panic");
                assert!(finalizes_utterance);
                assert_eq!(reported_id, Some(utterance_id));
            }
            other => panic!("expected SessionError, got {other:?}"),
        }

        assert_worker_still_responds(&command_tx, &event_rx, &session_id);
        drop(command_tx);
        handle
            .join()
            .expect("worker thread must not die from a caught panic");
    }

    #[test]
    fn streaming_session_warns_when_diarization_is_requested() {
        assert_eq!(
            session_request_warnings(&streaming_caps(), true, "en"),
            vec![RequestWarning {
                field: "diarizationEnabled".to_string(),
                reason: "diarization dropped because streaming sessions do not support speaker attribution"
                    .to_string(),
            }]
        );
        assert!(session_request_warnings(&whisper_caps(), true, "en").is_empty());
        assert!(session_request_warnings(&streaming_caps(), false, "en").is_empty());
    }

    #[test]
    fn streaming_session_warns_when_language_selection_is_dropped() {
        assert_eq!(
            session_request_warnings(&streaming_caps(), false, "fr"),
            vec![RequestWarning {
                field: "language".to_string(),
                reason: "language dropped because streaming adapter does not advertise supports_language_selection"
                    .to_string(),
            }]
        );
        assert!(session_request_warnings(&streaming_caps(), false, "en").is_empty());
    }

    #[derive(Default)]
    struct FixtureStreamingModel {
        samples: Vec<i16>,
    }

    struct FixtureVad {
        calls: usize,
        speech_frames: usize,
    }

    #[derive(Default)]
    struct StreamingFeedCounts {
        accepted_samples: usize,
        reset_calls: usize,
    }

    struct CountedStreamingFinalize {
        counts: Arc<Mutex<StreamingFeedCounts>>,
        finalized_samples: usize,
        streamed_samples: usize,
    }

    /// Plays back a fixed sequence of VAD probabilities, holding the last value
    /// once the script is exhausted. Lets a streaming fixture reproduce a
    /// speech → short silence gap → resumed speech pattern that drives a
    /// boundary-aware 30 s cap split.
    struct ScriptedVad {
        probabilities: Vec<f32>,
        index: usize,
    }

    struct CountingStreamingModel {
        counts: Arc<Mutex<StreamingFeedCounts>>,
    }

    impl StreamingModel for CountingStreamingModel {
        fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError> {
            self.counts
                .lock()
                .expect("feed counts lock")
                .accepted_samples += samples.len();
            Ok(())
        }

        fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
            Ok(fixture_output("counted partial".to_string()))
        }

        fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
            Ok(fixture_output("counted final".to_string()))
        }

        fn reset_utterance(&mut self) {
            self.counts.lock().expect("feed counts lock").reset_calls += 1;
        }
    }

    fn run_counted_streaming_finalize<V: VoiceActivityDetector>(
        vad: V,
    ) -> CountedStreamingFinalize {
        let counts = Arc::new(Mutex::new(StreamingFeedCounts::default()));
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let mut worker_session = WorkerSession {
            metadata: SessionMetadata {
                runtime_id: RuntimeId::OnnxRuntime,
                family_id: ModelFamilyId::Moonshine,
                gpu_config: GpuConfig::default(),
                diarization_enabled: false,
                language: "en".to_string(),
                model_file_path: PathBuf::from("/tmp/frontend.ort"),
                cancel_rx,
                session_start_unix_ms: 0,
                session_id: "streaming-reconcile-test".to_string(),
                stage_enablement: StageEnablement::default(),
                user_rules: Vec::new(),
            },
            family_capabilities: streaming_caps(),
            model: SessionModel::Streaming {
                model: Box::new(CountingStreamingModel {
                    counts: Arc::clone(&counts),
                }),
                utterance: None,
            },
            processors: Vec::new(),
            diarizer: None,
            warnings: Vec::new(),
        };
        let mut listening_session = ListeningSession::with_vad(
            SessionConfig {
                mode: ListeningMode::AlwaysOn,
                session_start_unix_ms: 0,
                session_id: "streaming-reconcile-test".to_string(),
                style: SpeakingStyle::Balanced,
            },
            vad,
        );
        let runtime = test_runtime();
        let (event_tx, _event_rx) = mpsc::channel();
        let utterance_id = Uuid::new_v4();
        let mut opened = false;

        for index in 0..1_600 {
            let frame = vec![index as i16; 320];
            let frame_bytes: Vec<u8> = frame
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect();
            let actions = listening_session.ingest_audio_frame(&frame_bytes).unwrap();
            for action in actions {
                let SessionAction::FinalizeUtterance(utterance) = action else {
                    continue;
                };
                let finalized_samples = utterance.samples.len();
                let streamed_samples = counts.lock().expect("feed counts lock").accepted_samples;
                finalize_streaming_utterance(
                    &mut worker_session,
                    &event_tx,
                    &runtime,
                    "streaming-reconcile-test",
                    utterance,
                    utterance_id,
                )
                .unwrap();
                return CountedStreamingFinalize {
                    counts,
                    finalized_samples,
                    streamed_samples,
                };
            }

            let Some(live) = listening_session.live_utterance() else {
                continue;
            };
            if opened {
                stream_audio(
                    &mut worker_session,
                    &event_tx,
                    &runtime,
                    "streaming-reconcile-test",
                    utterance_id,
                    &frame,
                    ((index + 1) * 20) as u64,
                )
                .unwrap();
            } else {
                begin_streaming_utterance(
                    &mut worker_session,
                    live,
                    utterance_id,
                    ((index + 1) * 20) as u64,
                )
                .unwrap();
                opened = true;
            }
        }

        panic!("fixture did not finalize an utterance");
    }

    impl VoiceActivityDetector for FixtureVad {
        fn speech_probability(&mut self, _frame: &[i16]) -> Result<f32, VoiceActivityError> {
            let probability = if self.calls < self.speech_frames {
                1.0
            } else {
                0.0
            };
            self.calls += 1;
            Ok(probability)
        }

        fn reset(&mut self) {}
    }

    impl VoiceActivityDetector for ScriptedVad {
        fn speech_probability(&mut self, _frame: &[i16]) -> Result<f32, VoiceActivityError> {
            let probability = self
                .probabilities
                .get(self.index)
                .copied()
                .or_else(|| self.probabilities.last().copied())
                .unwrap_or(0.0);
            self.index += 1;
            Ok(probability)
        }

        fn reset(&mut self) {}
    }

    impl StreamingModel for FixtureStreamingModel {
        fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError> {
            self.samples.extend_from_slice(samples);
            Ok(())
        }

        fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
            Ok(fixture_output(format!(
                "fixture partial {}",
                self.samples.len() / PARTIAL_CADENCE_SAMPLES
            )))
        }

        fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
            let output = fixture_output("fixture final.".to_string());
            self.samples.clear();
            Ok(output)
        }

        fn reset_utterance(&mut self) {
            self.samples.clear();
        }
    }

    fn fixture_output(text: String) -> EngineTranscriptOutput {
        EngineTranscriptOutput {
            diagnostics: Vec::new(),
            segments: vec![TranscriptSegment {
                start_ms: 0,
                end_ms: 1_000,
                speaker: None,
                text,
                timestamp_granularity: TimestampGranularity::Utterance,
                timestamp_source: TimestampSource::Vad,
            }],
        }
    }

    fn streaming_caps() -> ModelFamilyCapabilities {
        ModelFamilyCapabilities {
            supports_segment_timestamps: false,
            supports_word_timestamps: false,
            supports_initial_prompt: false,
            supports_streaming: true,
            supports_language_selection: false,
            supported_languages: LanguageSupport::EnglishOnly,
            max_audio_duration_secs: None,
            produces_punctuation: true,
        }
    }

    struct VoiceActivityReadingProcessor;

    impl StageProcessor for VoiceActivityReadingProcessor {
        fn id(&self) -> StageId {
            StageId::HallucinationFilter
        }

        fn process(&self, transcript: &Transcript, ctx: &StageContext<'_>) -> StageProcess {
            StageProcess::Ok {
                segments: transcript.segments.clone(),
                payload: Some(serde_json::json!({
                    "audioStartMs": ctx.voice_activity.audio_start_ms,
                    "voicedMs": ctx.voice_activity.voiced_ms,
                })),
            }
        }
    }

    struct PauseReadingProcessor;

    impl StageProcessor for PauseReadingProcessor {
        fn id(&self) -> StageId {
            StageId::HallucinationFilter
        }

        fn process(&self, transcript: &Transcript, ctx: &StageContext<'_>) -> StageProcess {
            StageProcess::Ok {
                segments: transcript.segments.clone(),
                payload: Some(serde_json::json!({
                    "pauseMsBeforeUtterance": ctx.pause_ms_before_utterance,
                })),
            }
        }
    }

    /// Synthesises the consumer pattern PR 3 (hallucination filter v2) will
    /// use: read the per-frame trace from `StageContext` and compute a
    /// per-segment voiced fraction. Segment timestamps are utterance-local.
    struct VoicedFractionProcessor;

    impl StageProcessor for VoicedFractionProcessor {
        fn id(&self) -> StageId {
            StageId::HallucinationFilter
        }

        fn process(&self, transcript: &Transcript, ctx: &StageContext<'_>) -> StageProcess {
            let segment = &transcript.segments[0];
            let fraction = voiced_fraction(
                ctx.vad_probabilities,
                segment.start_ms,
                segment.end_ms,
                0.35,
            );
            StageProcess::Ok {
                segments: transcript.segments.clone(),
                payload: Some(serde_json::json!({ "voicedFraction": fraction })),
            }
        }
    }

    struct FamilyCapabilitiesReadingProcessor;

    impl StageProcessor for FamilyCapabilitiesReadingProcessor {
        fn id(&self) -> StageId {
            StageId::HallucinationFilter
        }

        fn process(&self, transcript: &Transcript, ctx: &StageContext<'_>) -> StageProcess {
            StageProcess::Ok {
                segments: transcript.segments.clone(),
                payload: Some(serde_json::json!({
                    "supportsInitialPrompt": ctx.family_capabilities.supports_initial_prompt,
                    "supportsLanguageSelection": ctx.family_capabilities.supports_language_selection,
                })),
            }
        }
    }

    fn assert_payload_with_measured_duration(
        payload: &Option<serde_json::Value>,
        expected: serde_json::Value,
    ) {
        let mut actual = payload.clone().expect("processor should emit payload");
        let duration = actual
            .as_object_mut()
            .expect("processor payload should be an object")
            .remove("durationMs")
            .expect("processor payload should include measured duration");

        assert!(duration.is_u64());
        assert_eq!(actual, expected);
    }

    #[test]
    fn assemble_transcript_includes_voice_activity_in_engine_payload() {
        let voice_activity = voice_activity();
        let runtime = test_runtime();
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let transcript = assemble_transcript(TranscriptAssembly {
            cancel_rx: &cancel_rx,
            context: None,
            engine_duration_ms: 7,
            engine_output: engine_output(),
            family_capabilities: &whisper_caps(),
            is_final: true,
            pause_ms_before_utterance: None,
            processors: &[],
            stage_enablement: &StageEnablement::default(),
            tokio_runtime: &runtime,
            utterance_id: Uuid::nil(),
            vad_probabilities: &[],
            voice_activity,
        });

        let payload = transcript.stage_history[0]
            .payload
            .as_ref()
            .expect("engine stage should carry payload")
            .clone();
        assert_eq!(
            serde_json::from_value::<EngineStagePayload>(payload).unwrap(),
            EngineStagePayload {
                pause_ms_before_utterance: None,
                voice_activity
            }
        );
        assert!(transcript.stage_history[0].is_final);
    }

    #[test]
    fn stage_context_exposes_voice_activity_to_processors() {
        let voice_activity = voice_activity();
        let processors: Vec<Box<dyn StageProcessor>> =
            vec![Box::new(VoiceActivityReadingProcessor)];
        let runtime = test_runtime();
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let transcript = assemble_transcript(TranscriptAssembly {
            cancel_rx: &cancel_rx,
            context: None,
            engine_duration_ms: 7,
            engine_output: engine_output(),
            family_capabilities: &whisper_caps(),
            is_final: true,
            pause_ms_before_utterance: None,
            processors: &processors,
            stage_enablement: &StageEnablement::default(),
            tokio_runtime: &runtime,
            utterance_id: Uuid::nil(),
            vad_probabilities: &[],
            voice_activity,
        });

        assert_payload_with_measured_duration(
            &transcript.stage_history[1].payload,
            serde_json::json!({
                "audioStartMs": voice_activity.audio_start_ms,
                "voicedMs": voice_activity.voiced_ms,
            }),
        );
    }

    #[test]
    fn assemble_transcript_threads_pause_into_engine_payload() {
        let voice_activity = voice_activity();
        let runtime = test_runtime();
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let transcript = assemble_transcript(TranscriptAssembly {
            cancel_rx: &cancel_rx,
            context: None,
            engine_duration_ms: 7,
            engine_output: engine_output(),
            family_capabilities: &whisper_caps(),
            is_final: true,
            pause_ms_before_utterance: Some(420),
            processors: &[],
            stage_enablement: &StageEnablement::default(),
            tokio_runtime: &runtime,
            utterance_id: Uuid::nil(),
            vad_probabilities: &[],
            voice_activity,
        });

        let payload = transcript.stage_history[0]
            .payload
            .as_ref()
            .expect("engine stage should carry payload")
            .clone();
        assert_eq!(
            serde_json::from_value::<EngineStagePayload>(payload).unwrap(),
            EngineStagePayload {
                pause_ms_before_utterance: Some(420),
                voice_activity,
            }
        );
    }

    #[test]
    fn stage_context_exposes_pause_ms_before_utterance_to_processors() {
        let processors: Vec<Box<dyn StageProcessor>> = vec![Box::new(PauseReadingProcessor)];
        let runtime = test_runtime();
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let transcript = assemble_transcript(TranscriptAssembly {
            cancel_rx: &cancel_rx,
            context: None,
            engine_duration_ms: 7,
            engine_output: engine_output(),
            family_capabilities: &whisper_caps(),
            is_final: true,
            pause_ms_before_utterance: Some(150),
            processors: &processors,
            stage_enablement: &StageEnablement::default(),
            tokio_runtime: &runtime,
            utterance_id: Uuid::nil(),
            vad_probabilities: &[],
            voice_activity: voice_activity(),
        });

        assert_payload_with_measured_duration(
            &transcript.stage_history[1].payload,
            serde_json::json!({ "pauseMsBeforeUtterance": 150 }),
        );
    }

    #[test]
    fn stage_context_exposes_per_frame_trace_for_voiced_fraction() {
        // 50 frames (1 s) where the first 35 are voiced and the last 15
        // are silent. The single segment covers the full second.
        let mut trace = vec![1.0_f32; 35];
        trace.extend(std::iter::repeat_n(0.0_f32, 15));
        let processors: Vec<Box<dyn StageProcessor>> = vec![Box::new(VoicedFractionProcessor)];

        let voice_activity = voice_activity();
        let runtime = test_runtime();
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let transcript = assemble_transcript(TranscriptAssembly {
            cancel_rx: &cancel_rx,
            context: None,
            engine_duration_ms: 7,
            engine_output: engine_output(),
            family_capabilities: &whisper_caps(),
            is_final: true,
            pause_ms_before_utterance: None,
            processors: &processors,
            stage_enablement: &StageEnablement::default(),
            tokio_runtime: &runtime,
            utterance_id: Uuid::nil(),
            vad_probabilities: &trace,
            voice_activity,
        });

        assert_payload_with_measured_duration(
            &transcript.stage_history[1].payload,
            serde_json::json!({ "voicedFraction": 0.7_f32 }),
        );
    }

    #[test]
    fn stage_context_exposes_session_family_capabilities_to_processors() {
        let processors: Vec<Box<dyn StageProcessor>> =
            vec![Box::new(FamilyCapabilitiesReadingProcessor)];
        let runtime = test_runtime();
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let transcript = assemble_transcript(TranscriptAssembly {
            cancel_rx: &cancel_rx,
            context: None,
            engine_duration_ms: 7,
            engine_output: engine_output(),
            family_capabilities: &whisper_caps(),
            is_final: true,
            pause_ms_before_utterance: None,
            processors: &processors,
            stage_enablement: &StageEnablement::default(),
            tokio_runtime: &runtime,
            utterance_id: Uuid::nil(),
            vad_probabilities: &[],
            voice_activity: voice_activity(),
        });

        assert_payload_with_measured_duration(
            &transcript.stage_history[1].payload,
            serde_json::json!({
                "supportsInitialPrompt": true,
                "supportsLanguageSelection": false,
            }),
        );
    }

    fn engine_output() -> EngineTranscriptOutput {
        EngineTranscriptOutput {
            diagnostics: Vec::new(),
            segments: vec![TranscriptSegment {
                start_ms: 0,
                end_ms: 1_000,
                speaker: None,
                text: "hello".to_string(),
                timestamp_granularity: TimestampGranularity::Segment,
                timestamp_source: TimestampSource::Engine,
            }],
        }
    }

    fn voice_activity() -> crate::audio_metadata::VoiceActivityEvidence {
        crate::audio_metadata::VoiceActivityEvidence {
            audio_start_ms: 2_000,
            audio_end_ms: 3_000,
            speech_start_ms: 2_100,
            speech_end_ms: 2_900,
            voiced_ms: 800,
            unvoiced_ms: 200,
            mean_probability: 0.75,
            max_probability: 0.95,
        }
    }

    fn test_runtime() -> Runtime {
        Builder::new_current_thread().enable_all().build().unwrap()
    }

    fn whisper_caps() -> ModelFamilyCapabilities {
        ModelFamilyCapabilities {
            supports_segment_timestamps: true,
            supports_word_timestamps: false,
            supports_initial_prompt: true,
            supports_streaming: false,
            supports_language_selection: false,
            supported_languages: LanguageSupport::EnglishOnly,
            max_audio_duration_secs: None,
            produces_punctuation: true,
        }
    }

    fn diarize_transcript(text: &str) -> Transcript {
        let segments = if text.is_empty() {
            Vec::new()
        } else {
            vec![TranscriptSegment {
                start_ms: 0,
                end_ms: 1_000,
                speaker: None,
                text: text.to_string(),
                timestamp_granularity: TimestampGranularity::Segment,
                timestamp_source: TimestampSource::Engine,
            }]
        };
        Transcript {
            utterance_id: Uuid::nil(),
            revision: 0,
            segments,
            stage_history: Vec::new(),
        }
    }

    fn speech_like(samples: usize) -> Vec<f32> {
        (0..samples)
            .map(|n| (2.0 * std::f32::consts::PI * 180.0 * n as f32 / 16_000.0).sin() * 0.4)
            .collect()
    }

    #[test]
    fn diarize_utterance_returns_none_when_disabled() {
        let mut transcript = diarize_transcript("hello there");
        let speaker = diarize_utterance(None, &mut transcript, &speech_like(16_000));
        assert_eq!(speaker, None);
        assert!(
            !transcript
                .stage_history
                .iter()
                .any(|stage| stage.stage_id == StageId::Diarization),
            "no diarization stage should be recorded when disabled"
        );
    }

    #[test]
    fn diarize_utterance_skips_empty_text_without_recording_a_stage() {
        let mut diarizer = SessionDiarizer::new().expect("model should load");
        let mut transcript = diarize_transcript("");
        let speaker = diarize_utterance(Some(&mut diarizer), &mut transcript, &speech_like(16_000));
        assert_eq!(speaker, None);
        assert!(
            !transcript
                .stage_history
                .iter()
                .any(|stage| stage.stage_id == StageId::Diarization),
            "a fully-filtered utterance must not register a speaker"
        );
    }

    #[test]
    fn diarize_utterance_assigns_first_speaker_and_records_stage() {
        let mut diarizer = SessionDiarizer::new().expect("model should load");
        let mut transcript = diarize_transcript("hello there");
        let speaker = diarize_utterance(Some(&mut diarizer), &mut transcript, &speech_like(16_000));
        assert_eq!(speaker, Some(0));
        let stage = transcript
            .stage_history
            .iter()
            .find(|stage| stage.stage_id == StageId::Diarization)
            .expect("a diarization stage should be recorded");
        assert_eq!(stage.status, StageStatus::Ok);
        assert_eq!(
            stage
                .payload
                .as_ref()
                .and_then(|payload| payload.get("speakerIndex")),
            Some(&serde_json::json!(0))
        );
    }

    #[test]
    fn diarize_utterance_records_embedding_failure_in_stage_history() {
        let mut diarizer = SessionDiarizer::new().expect("model should load");
        let mut transcript = diarize_transcript("hello there");
        let speaker = diarize_utterance(Some(&mut diarizer), &mut transcript, &[0.0; 100]);

        assert_eq!(speaker, None);
        let stage = transcript
            .stage_history
            .iter()
            .find(|stage| stage.stage_id == StageId::Diarization)
            .expect("a failed diarization stage should be recorded");
        assert!(matches!(
            &stage.status,
            StageStatus::Failed { error } if error.contains("speaker embedding failed")
        ));
        assert_eq!(stage.revision_out, None);
    }
}
