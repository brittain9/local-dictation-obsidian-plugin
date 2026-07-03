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
    accepted_samples: Vec<i16>,
    cadence: PartialCadence,
    last_emitted_text: String,
    next_revision: u32,
    pause_ms_before_utterance: Option<u64>,
    utterance_id: Uuid,
    utterance_index: u64,
    vad_probabilities: Vec<f32>,
    voice_activity: crate::audio_metadata::VoiceActivityEvidence,
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
                if let Some(session) = sessions.get_mut(&session_id)
                    && let Err(error) =
                        begin_streaming_utterance(session, utterance, utterance_id, now_ms)
                {
                    send_worker_error(&event_tx, session_id, Some(utterance_id), false, error);
                }
            }
            WorkerCommand::BeginSession(metadata) => {
                let load_result = panic::catch_unwind(AssertUnwindSafe(|| {
                    load_session_resources(registry.as_ref(), &metadata)
                }));

                match load_result {
                    Ok(Ok(resources)) => {
                        let streaming = resources.family_capabilities.supports_streaming;
                        let warnings =
                            session_request_warnings(streaming, metadata.diarization_enabled);
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
                        sessions.insert(
                            metadata.session_id.clone(),
                            WorkerSession {
                                metadata,
                                family_capabilities: resources.family_capabilities,
                                model: resources.model,
                                processors: post_engine_processors(),
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
                if let Some(session) = sessions.get_mut(&session_id)
                    && let Err(error) = stream_audio(
                        session,
                        &event_tx,
                        &tokio_runtime,
                        &session_id,
                        utterance_id,
                        &samples,
                        now_ms,
                    )
                {
                    send_worker_error(&event_tx, session_id, Some(utterance_id), false, error);
                }
            }
            WorkerCommand::FinalizeStreamingUtterance {
                session_id,
                utterance,
                utterance_id,
            } => {
                if let Some(session) = sessions.get_mut(&session_id)
                    && let Err(error) = finalize_streaming_utterance(
                        session,
                        &event_tx,
                        &tokio_runtime,
                        &session_id,
                        utterance,
                        utterance_id,
                    )
                {
                    send_worker_error(&event_tx, session_id, Some(utterance_id), true, error);
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
        accepted_samples: utterance.samples,
        cadence: PartialCadence::new(now_ms, initial_samples),
        last_emitted_text: String::new(),
        next_revision: 0,
        pause_ms_before_utterance: utterance.pause_ms_before_utterance,
        utterance_id,
        utterance_index: utterance.utterance_index,
        vad_probabilities: utterance.vad_probabilities,
        voice_activity: utterance.voice_activity,
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
    open.accepted_samples.extend_from_slice(samples);
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
    let utterance_duration_ms = (open.accepted_samples.len() as u64 * 1_000) / 16_000;
    let utterance_start_ms_in_session = open.voice_activity.audio_start_ms;
    let utterance_end_ms_in_session =
        utterance_start_ms_in_session.saturating_add(utterance_duration_ms);
    let mut voice_activity = open.voice_activity;
    voice_activity.audio_end_ms = utterance_end_ms_in_session;

    let transcript = offset_transcript_revision(
        assemble_transcript(TranscriptAssembly {
            utterance_id,
            engine_output,
            engine_duration_ms,
            is_final: false,
            pause_ms_before_utterance: open.pause_ms_before_utterance,
            vad_probabilities: &open.vad_probabilities,
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
        pause_ms_before_utterance: open.pause_ms_before_utterance,
        processing_duration_ms: started_at.elapsed().as_millis() as u64,
        session_id: session_id.to_string(),
        speaker_index: None,
        transcript,
        utterance_duration_ms,
        utterance_end_ms_in_session,
        utterance_index: open.utterance_index,
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
    if open
        .as_ref()
        .is_none_or(|open| open.utterance_id != utterance_id || open.accepted_samples != samples)
    {
        model.reset_utterance();
        model.accept_audio(&samples)?;
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

fn session_request_warnings(streaming: bool, diarization_enabled: bool) -> Vec<RequestWarning> {
    if streaming && diarization_enabled {
        vec![RequestWarning {
            field: "diarizationEnabled".to_string(),
            reason:
                "diarization dropped because streaming sessions do not support speaker attribution"
                    .to_string(),
        }]
    } else {
        Vec::new()
    }
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
    use super::*;
    use crate::audio_metadata::voiced_fraction;
    use crate::engine::capabilities::LanguageSupport;
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
        };
        let mut worker_session = WorkerSession {
            metadata,
            family_capabilities: streaming_caps(),
            model: SessionModel::Streaming {
                model: Box::new(FixtureStreamingModel::default()),
                utterance: None,
            },
            processors: post_engine_processors(),
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
    fn streaming_session_warns_when_diarization_is_requested() {
        assert_eq!(
            session_request_warnings(true, true),
            vec![RequestWarning {
                field: "diarizationEnabled".to_string(),
                reason: "diarization dropped because streaming sessions do not support speaker attribution"
                    .to_string(),
            }]
        );
        assert!(session_request_warnings(false, true).is_empty());
        assert!(session_request_warnings(true, false).is_empty());
    }

    #[derive(Default)]
    struct FixtureStreamingModel {
        samples: Vec<i16>,
    }

    struct FixtureVad {
        calls: usize,
        speech_frames: usize,
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
