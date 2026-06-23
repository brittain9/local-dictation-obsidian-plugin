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
use crate::engine::traits::LoadedModel;
use crate::panic_util::format_panic_message;
use crate::protocol::{
    ContextWindow, EngineStagePayload, StageId, StageOutcome, StageStatus, TranscriptSegment,
};
use crate::session::FinalizedUtterance;
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
    BeginSession(SessionMetadata),
    EndSession {
        session_id: String,
    },
    Shutdown,
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
    loaded_model: Box<dyn LoadedModel>,
    processors: Vec<Box<dyn StageProcessor>>,
    diarizer: Option<SessionDiarizer>,
}

struct LoadedSessionResources {
    family_capabilities: ModelFamilyCapabilities,
    loaded_model: Box<dyn LoadedModel>,
}

fn load_session_resources(
    registry: &EngineRegistry,
    metadata: &SessionMetadata,
) -> Result<LoadedSessionResources, TranscriptionError> {
    let adapter = registry
        .adapter(metadata.runtime_id, metadata.family_id)
        .ok_or_else(|| missing_adapter_error(metadata.runtime_id, metadata.family_id))?;
    let family_capabilities = adapter.capabilities().clone();
    let loaded_model = adapter.load(&metadata.model_file_path, metadata.gpu_config)?;

    Ok(LoadedSessionResources {
        family_capabilities,
        loaded_model,
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

    while let Ok(command) = command_rx.recv() {
        match command {
            WorkerCommand::BeginSession(metadata) => {
                let load_result = panic::catch_unwind(AssertUnwindSafe(|| {
                    load_session_resources(registry.as_ref(), &metadata)
                }));

                match load_result {
                    Ok(Ok(resources)) => {
                        let diarizer = if metadata.diarization_enabled {
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
                                loaded_model: resources.loaded_model,
                                processors: post_engine_processors(),
                                diarizer,
                            },
                        );
                    }
                    Ok(Err(error)) => {
                        let _ = event_tx.send(WorkerEvent::SessionError {
                            code: error.code.to_string(),
                            details: error.details,
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
                let result = panic::catch_unwind(AssertUnwindSafe(|| {
                    session.loaded_model.transcribe(&request)
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
    use crate::protocol::{TimestampGranularity, TimestampSource, TranscriptSegment};
    use crate::stages::StageProcess;

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
