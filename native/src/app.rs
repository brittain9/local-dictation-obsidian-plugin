use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::watch;
use uuid::Uuid;

use crate::audio_mixer::{AudioMixer, AudioMixerError, MixedAudioFrame};
use crate::catalog::{ArtifactRole, ModelCatalog, TranslationSupport};
use crate::engine::capabilities::{
    AcceleratorId, LanguageSupport, ModelFamilyId, ModelTask, RuntimeId,
};
use crate::engine::registry::EngineRegistry;
use crate::installer::{InstallRequest, ModelInstallManager, ModelProbe};
use crate::model_store::{
    remove_installed_model, resolve_catalog_model_runtime_path, resolve_model_install_dir,
    resolve_model_store_info, scan_installed_models,
};
use crate::protocol::{
    AccelerationPreference, AudioFrame, Command, CompiledAdapterInfo, CompiledRuntimeInfo,
    ContextWindow, Event, HealthStatus, ListeningMode, ModelInstallState, ModelProbeStatus,
    QueueBackpressureTier, SelectedModel, SessionState, SessionStopReason, system_info_string,
};
use crate::session::{
    FinalizedUtterance, ListeningSession, SessionAction, SessionBaseState, SessionConfig,
    SessionInitError,
};
use crate::stages::StageEnablement;
use crate::synthesis::SynthesisCancellation;
use crate::synthesis_worker::{
    PrepareModelRemoval, StartSynthesis as WorkerStartSynthesis, SynthesisWorker,
};
use crate::system_audio::{AudioFrameSink, SystemAudioCapture, SystemAudioController};
use crate::transcription::{ENGLISH_LANGUAGE_TAG, GpuConfig};
use crate::translation_worker::{StartTranslation as WorkerStartTranslation, TranslationWorker};
use crate::worker::{SessionMetadata, TranscriptionWorker, WorkerCommand, WorkerEvent};

/// Queue depth that marks a session as `saturated` and triggers an overload
/// drain (capture stops; queued work finishes; session ends with
/// `SessionStopReason::QueueOverload`).
const QUEUE_OVERLOAD_DEPTH: usize = 30;
// Note-glossary extraction emits ASCII terms only. Keeping the entire prompt
// at or below Whisper's 224-token ceiling prevents silent tokenizer truncation.
// Non-English and automatic sessions do not request glossary context.
const CONTEXT_BUDGET_CHARS: u32 = 224;
const CONTEXT_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const AUDIO_LEVEL_EVENT_INTERVAL: Duration = Duration::from_millis(50);
const MAX_ACTIVE_SESSIONS: usize = 5;
type SessionFactory = fn(SessionConfig) -> Result<ListeningSession, SessionInitError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlFlow {
    Continue,
    Shutdown,
}

/// Top-level sidecar state machine. Owns the worker channel, model
/// registry, and pending-context queue.
///
/// Hosts must drive this on a loop: handle each incoming command/audio
/// frame, then call `drain_pending_outputs` to flush worker events and
/// any expired context-request dispatches before blocking on the next
/// read.
pub struct AppState {
    active_sessions: HashMap<String, ActiveSession>,
    catalog: Arc<ModelCatalog>,
    install_manager: ModelInstallManager,
    registry: Arc<EngineRegistry>,
    session_factory: SessionFactory,
    sidecar_version: String,
    system_audio: Box<dyn SystemAudioCapture>,
    synthesis_worker: SynthesisWorker,
    translation_worker: TranslationWorker,
    transcription_worker: TranscriptionWorker,
}

struct ActiveSession {
    audio_mixer: AudioMixer,
    context_required: bool,
    context_budget_chars: u32,
    cancel_tx: watch::Sender<bool>,
    draining: bool,
    drain_reason: Option<SessionStopReason>,
    last_reported_queue_tier: QueueBackpressureTier,
    last_reported_state: Option<SessionState>,
    last_reported_audio_level_at: Option<Instant>,
    overload_draining: bool,
    pending_context_requests: Vec<PendingContextRequest>,
    queued_utterances: usize,
    session: ListeningSession,
    streaming: bool,
    streaming_open: Option<StreamingOpenUtterance>,
    transcription_active: bool,
}

#[derive(Clone, Copy)]
struct StreamingOpenUtterance {
    utterance_id: Uuid,
    utterance_index: u64,
}

struct PendingContextRequest {
    correlation_id: Uuid,
    deadline: Instant,
    session_id: String,
    utterance: FinalizedUtterance,
    utterance_id: Uuid,
}

struct ResolvedModelSelection {
    display_name: String,
    runtime_id: RuntimeId,
    family_id: ModelFamilyId,
    installed: bool,
    language_support: LanguageSupport,
    supports_automatic_language_detection: bool,
    model_id: Option<String>,
    resolved_path: PathBuf,
    selection: SelectedModel,
    size_bytes: u64,
}

#[derive(Default)]
struct ProbeErrorFields {
    details: Option<String>,
    display_name: Option<String>,
    installed: bool,
    model_id: Option<String>,
    resolved_path: Option<String>,
}

impl AppState {
    pub fn new(sidecar_version: impl Into<String>, catalog: ModelCatalog) -> Self {
        let registry = Arc::new(EngineRegistry::build());
        Self::with_registry(sidecar_version, catalog, registry, ListeningSession::new)
    }

    fn with_registry(
        sidecar_version: impl Into<String>,
        catalog: ModelCatalog,
        registry: Arc<EngineRegistry>,
        session_factory: SessionFactory,
    ) -> Self {
        Self::with_system_audio(
            sidecar_version,
            catalog,
            registry,
            session_factory,
            Box::new(SystemAudioController::new()),
        )
    }

    fn with_system_audio(
        sidecar_version: impl Into<String>,
        catalog: ModelCatalog,
        registry: Arc<EngineRegistry>,
        session_factory: SessionFactory,
        system_audio: Box<dyn SystemAudioCapture>,
    ) -> Self {
        let model_probe: Arc<ModelProbe> = {
            let registry = Arc::clone(&registry);
            Arc::new(move |runtime_id, family_id, path| {
                registry.probe_model(runtime_id, family_id, path)
            })
        };

        let synthesis_worker = SynthesisWorker::spawn(Arc::clone(&registry));

        Self {
            active_sessions: HashMap::new(),
            catalog: Arc::new(catalog),
            install_manager: ModelInstallManager::new(model_probe),
            registry: Arc::clone(&registry),
            session_factory,
            sidecar_version: sidecar_version.into(),
            system_audio,
            synthesis_worker,
            translation_worker: TranslationWorker::spawn(),
            transcription_worker: TranscriptionWorker::spawn(Arc::clone(&registry)),
        }
    }

    /// Install the sink native system-audio capture delivers frames to. The
    /// host wires this to the same channel renderer audio frames arrive on, so
    /// captured frames flow through the identical ingestion path.
    pub fn set_system_audio_sink(&mut self, sink: AudioFrameSink) {
        self.system_audio.set_sink(sink);
    }

    /// Drain all pending outputs the host should write before its next
    /// blocking read: queued worker events plus any context-request
    /// dispatches whose deadline has elapsed. Hosts driving `AppState`
    /// MUST call this each iteration of their main loop — context-request
    /// timeouts only fire from here, and skipping a tick will eventually
    /// wedge the worker queue.
    pub fn drain_pending_outputs(&mut self) -> Vec<Event> {
        let mut events = self.drain_worker_events();
        events.extend(self.tick());
        events
    }

    pub(crate) fn drain_worker_events(&mut self) -> Vec<Event> {
        let mut events = Vec::new();

        while let Some(worker_event) = self.transcription_worker.poll_event() {
            self.handle_worker_event(worker_event, &mut events);
        }

        while let Some(install_event) = self.install_manager.poll_event() {
            events.push(install_event);
        }

        while let Some(synthesis_event) = self.synthesis_worker.poll_event() {
            events.push(synthesis_event);
        }

        while let Some(translation_event) = self.translation_worker.poll_event() {
            events.push(translation_event);
        }

        events
    }

    pub fn handle_audio_frame(&mut self, audio_frame: AudioFrame) -> Vec<Event> {
        let mut events = Vec::new();
        let session_id = audio_frame.session_id;

        let result = {
            let Some(active_session) = self.active_sessions.get_mut(&session_id) else {
                return events;
            };

            if active_session.draining || active_session.overload_draining {
                return events;
            }

            let mixed = match active_session
                .audio_mixer
                .push_microphone_frame(audio_frame.frame_bytes)
            {
                Ok(Some(mixed)) => mixed,
                Ok(None) => return events,
                Err(error) => {
                    events.push(invalid_audio_frame_event(&session_id, error));
                    return events;
                }
            };
            let audio_level_event = audio_level_event_if_due(active_session, &mixed);
            let streaming_frame = mixed.frame_bytes.clone();

            active_session
                .session
                .ingest_audio_frame(&mixed.frame_bytes)
                .map(|actions| (actions, audio_level_event, streaming_frame))
        };

        match result {
            Ok((actions, audio_level_event, streaming_frame)) => {
                if let Some(event) = audio_level_event {
                    events.push(event);
                }
                for action in actions {
                    self.handle_session_action(&session_id, action, &mut events);
                }
                self.dispatch_streaming_audio(&session_id, &streaming_frame, &mut events);

                self.emit_state_if_changed(&session_id, &mut events);
            }
            Err(error) => {
                events.push(Event::Error {
                    code: error.code.to_string(),
                    details: error.details,
                    message: error.message.to_string(),
                    session_id: Some(session_id),
                });
            }
        }

        events
    }

    pub fn handle_system_audio_frame(&mut self, audio_frame: AudioFrame) -> Vec<Event> {
        let mut events = Vec::new();
        let session_id = audio_frame.session_id;

        let Some(active_session) = self.active_sessions.get_mut(&session_id) else {
            return events;
        };

        if active_session.draining || active_session.overload_draining {
            return events;
        }

        if let Err(error) = active_session
            .audio_mixer
            .push_system_frame(audio_frame.frame_bytes)
        {
            events.push(invalid_audio_frame_event(&session_id, error));
        }

        events
    }

    pub fn handle_command(&mut self, command: Command) -> (ControlFlow, Vec<Event>) {
        let mut events = Vec::new();

        match command {
            Command::Health => {
                events.push(Event::HealthOk {
                    sidecar_version: self.sidecar_version.clone(),
                    status: HealthStatus::Ready,
                });

                (ControlFlow::Continue, events)
            }
            Command::ProbeSystemAudio => (ControlFlow::Continue, events),
            Command::ContextResponse {
                correlation_id,
                context,
            } => {
                self.handle_context_response(correlation_id, context, &mut events);
                (ControlFlow::Continue, events)
            }
            Command::GetModelStore {
                model_store_path_override,
            } => {
                match resolve_model_store_info(model_store_path_override.as_deref()) {
                    Ok(info) => events.push(Event::ModelStore {
                        override_path: info.override_path.map(|path| path.display().to_string()),
                        path: info.path.display().to_string(),
                        using_default_path: info.using_default_path,
                    }),
                    Err(error) => events.push(internal_error_event(
                        "invalid_model_store",
                        "Failed to resolve the configured model store path.",
                        Some(format!("{error:#}")),
                    )),
                }

                (ControlFlow::Continue, events)
            }
            Command::ListModelCatalog => {
                events.push(Event::ModelCatalog {
                    catalog_version: self.catalog.catalog_version,
                    collections: self.catalog.collections.clone(),
                    runtimes: self.catalog.runtimes.clone(),
                    families: self.catalog.families.clone(),
                    models: self.catalog.models.clone(),
                });

                (ControlFlow::Continue, events)
            }
            Command::ListInstalledModels {
                model_store_path_override,
            } => {
                match resolve_model_store_info(model_store_path_override.as_deref())
                    .and_then(|info| scan_installed_models(&self.catalog, &info.path))
                {
                    Ok(models) => events.push(Event::InstalledModels { models }),
                    Err(error) => events.push(internal_error_event(
                        "invalid_model_store",
                        "Failed to scan installed models.",
                        Some(format!("{error:#}")),
                    )),
                }

                (ControlFlow::Continue, events)
            }
            Command::ProbeModelSelection {
                model_selection,
                model_store_path_override,
            } => {
                events.push(
                    self.build_probe_event(model_selection, model_store_path_override.as_deref()),
                );
                (ControlFlow::Continue, events)
            }
            Command::RemoveModel {
                runtime_id,
                family_id,
                model_id,
                model_store_path_override,
            } => {
                match resolve_model_store_info(model_store_path_override.as_deref()).and_then(
                    |info| {
                        let install_dir = resolve_model_install_dir(
                            &info.path, runtime_id, family_id, &model_id,
                        )?;
                        match self.synthesis_worker.prepare_model_removal(
                            runtime_id,
                            family_id,
                            &install_dir,
                        ) {
                            PrepareModelRemoval::Ready => {
                                remove_installed_model(&info.path, runtime_id, family_id, &model_id)
                            }
                            PrepareModelRemoval::InUse | PrepareModelRemoval::WorkerUnavailable => {
                                Ok(false)
                            }
                        }
                    },
                ) {
                    Ok(removed) => events.push(Event::ModelRemoved {
                        runtime_id,
                        family_id,
                        model_id,
                        removed,
                    }),
                    Err(_error) => events.push(Event::ModelRemoved {
                        runtime_id,
                        family_id,
                        model_id,
                        removed: false,
                    }),
                }

                (ControlFlow::Continue, events)
            }
            Command::InstallModel {
                runtime_id,
                family_id,
                install_id,
                model_id,
                artifact_ids,
                model_store_path_override,
            } => {
                match self
                    .catalog
                    .find_model(runtime_id, family_id, &model_id)
                    .cloned()
                {
                    None => events.push(Event::ModelInstallUpdate {
                        details: None,
                        downloaded_bytes: None,
                        runtime_id,
                        family_id,
                        install_id,
                        message: Some(
                            "The requested model does not exist in the bundled catalog."
                                .to_string(),
                        ),
                        model_id,
                        state: ModelInstallState::Failed,
                        total_bytes: None,
                    }),
                    Some(model) => {
                        let incremental = !artifact_ids.is_empty();
                        let artifacts = if incremental {
                            let requested = artifact_ids
                                .iter()
                                .collect::<std::collections::HashSet<_>>();
                            let artifacts = model
                                .artifacts
                                .iter()
                                .filter(|artifact| requested.contains(&artifact.artifact_id))
                                .cloned()
                                .collect::<Vec<_>>();
                            let only_optional_voices = artifacts.len() == requested.len()
                                && artifacts.iter().all(|artifact| {
                                    !artifact.required
                                        && artifact.role == crate::catalog::ArtifactRole::Voice
                                });
                            if !only_optional_voices {
                                events.push(Event::ModelInstallUpdate {
                                    details: Some(
                                        "Artifact subsets may contain only declared optional voice artifacts."
                                            .to_string(),
                                    ),
                                    downloaded_bytes: None,
                                    runtime_id,
                                    family_id,
                                    install_id,
                                    message: Some("The requested voice install is invalid.".to_string()),
                                    model_id,
                                    state: ModelInstallState::Failed,
                                    total_bytes: None,
                                });
                                return (ControlFlow::Continue, events);
                            }
                            artifacts
                        } else {
                            model
                                .artifacts
                                .iter()
                                .filter(|artifact| artifact.required)
                                .cloned()
                                .collect()
                        };
                        match resolve_model_store_info(model_store_path_override.as_deref()) {
                            Ok(info) => {
                                events.push(self.install_manager.start_install(InstallRequest {
                                    artifacts,
                                    catalog: Arc::clone(&self.catalog),
                                    before_model_replace: {
                                        let invalidator = self.synthesis_worker.cache_invalidator();
                                        Arc::new(move |runtime_id, family_id, install_dir| {
                                            invalidator.invalidate_and_wait(
                                                runtime_id,
                                                family_id,
                                                install_dir,
                                            )
                                        })
                                    },
                                    runtime_id,
                                    family_id,
                                    install_id,
                                    incremental,
                                    model,
                                    model_id,
                                    store_root: info.path,
                                }))
                            }
                            Err(error) => events.push(Event::ModelInstallUpdate {
                                details: Some(format!("{error:#}")),
                                downloaded_bytes: None,
                                runtime_id,
                                family_id,
                                install_id,
                                message: Some("The model store path is invalid.".to_string()),
                                model_id,
                                state: ModelInstallState::Failed,
                                total_bytes: None,
                            }),
                        }
                    }
                }

                (ControlFlow::Continue, events)
            }
            Command::CancelModelInstall { install_id } => {
                if let Some(event) = self.install_manager.cancel_install(&install_id) {
                    events.push(event);
                }

                (ControlFlow::Continue, events)
            }
            Command::StartSynthesis {
                synthesis_id,
                model_selection,
                voice_id,
                language,
                speed,
                chunks,
                model_store_path_override,
            } => {
                type SynthesisStartFailure = (&'static str, &'static str, Option<String>);
                let result = (|| -> Result<WorkerStartSynthesis, SynthesisStartFailure> {
                    let SelectedModel::CatalogModel {
                        runtime_id,
                        family_id,
                        model_id,
                    } = &model_selection
                    else {
                        return Err((
                            "invalid_synthesis_request",
                            "Read aloud requires an installed catalog model.",
                            None,
                        ));
                    };
                    let model = self
                        .catalog
                        .find_model(*runtime_id, *family_id, model_id)
                        .ok_or({
                            (
                                "missing_model_file",
                                "The selected read-aloud model is not in the bundled catalog.",
                                None,
                            )
                        })?;
                    if model.task != ModelTask::Tts {
                        return Err((
                            "invalid_synthesis_request",
                            "The selected model is a dictation model, not a read-aloud model.",
                            None,
                        ));
                    }
                    let voice = model
                        .artifacts
                        .iter()
                        .find(|artifact| {
                            artifact.role == ArtifactRole::Voice
                                && artifact.voice_id.as_deref() == Some(voice_id.as_str())
                        })
                        .ok_or_else(|| {
                            (
                                "invalid_synthesis_request",
                                "The selected voice is not available for this model.",
                                Some(voice_id.clone()),
                            )
                        })?;
                    let store = resolve_model_store_info(model_store_path_override.as_deref())
                        .map_err(|error| {
                            (
                                "invalid_model_store",
                                "The configured model store is invalid.",
                                Some(format!("{error:#}")),
                            )
                        })?;
                    let model_path = resolve_catalog_model_runtime_path(
                        &self.catalog,
                        &store.path,
                        *runtime_id,
                        *family_id,
                        model_id,
                    )
                    .map_err(|error| {
                        (
                            "missing_model_file",
                            "Install the selected read-aloud model before using it.",
                            Some(format!("{error:#}")),
                        )
                    })?;
                    let install_dir =
                        resolve_model_install_dir(&store.path, *runtime_id, *family_id, model_id)
                            .map_err(|error| {
                            (
                                "invalid_model_store",
                                "The installed model path is invalid.",
                                Some(format!("{error:#}")),
                            )
                        })?;
                    let voice_path = install_dir.join(&voice.filename);
                    if !voice_path.is_file() {
                        return Err((
                            "missing_voice_file",
                            "Install the selected voice before using it.",
                            Some(voice.filename.clone()),
                        ));
                    }
                    Ok(WorkerStartSynthesis {
                        synthesis_id,
                        runtime_id: *runtime_id,
                        family_id: *family_id,
                        model_path,
                        voice_path,
                        language,
                        speed,
                        chunks,
                        cancellation: SynthesisCancellation::new(),
                    })
                })();
                match result {
                    Ok(request) => {
                        if let Err(message) = self.synthesis_worker.start(request) {
                            events.push(synthesis_error_event(
                                synthesis_id,
                                "synthesis_worker_unavailable",
                                &message,
                                None,
                            ));
                        }
                    }
                    Err((code, message, details)) => {
                        events.push(synthesis_error_event(synthesis_id, code, message, details));
                    }
                }
                (ControlFlow::Continue, events)
            }
            Command::CancelSynthesis { synthesis_id } => {
                self.synthesis_worker.cancel(synthesis_id);
                (ControlFlow::Continue, events)
            }
            Command::StartTranslation {
                translation_id,
                model_selection,
                source_language,
                target_language,
                texts,
                acceleration_preference,
                model_store_path_override,
            } => {
                let result = (|| -> anyhow::Result<WorkerStartTranslation> {
                    anyhow::ensure!(
                        !translation_id.trim().is_empty(),
                        "translationId must not be empty"
                    );
                    anyhow::ensure!(
                        !texts.is_empty() && texts.len() <= 4096,
                        "translation text unit count is invalid"
                    );
                    anyhow::ensure!(
                        texts.iter().all(|text| text.len() <= 50_000),
                        "a translation text unit exceeds the size limit"
                    );
                    let SelectedModel::CatalogModel {
                        runtime_id,
                        family_id,
                        model_id,
                    } = &model_selection
                    else {
                        anyhow::bail!("Translation requires an installed catalog model");
                    };
                    anyhow::ensure!(
                        *runtime_id == RuntimeId::LlamaCpp
                            && *family_id == ModelFamilyId::TencentHyMt,
                        "the selected model is not Tencent HY-MT 2"
                    );
                    let model = self
                        .catalog
                        .find_model(*runtime_id, *family_id, model_id)
                        .ok_or_else(|| {
                            anyhow::anyhow!("the selected translation model is not in the catalog")
                        })?;
                    anyhow::ensure!(
                        model.task == ModelTask::Translation,
                        "the selected model is not a translation model"
                    );
                    let supports_pair = match model.translation_support.as_ref() {
                        Some(TranslationSupport::Pairs { pairs }) => pairs.iter().any(|pair| {
                            pair.source == source_language && pair.target == target_language
                        }),
                        Some(TranslationSupport::AllToAll { languages }) => {
                            source_language != target_language
                                && languages.contains(&source_language)
                                && languages.contains(&target_language)
                        }
                        None => false,
                    };
                    anyhow::ensure!(
                        supports_pair,
                        "the selected model does not support this language pair"
                    );
                    let store = resolve_model_store_info(model_store_path_override.as_deref())?;
                    let model_path = resolve_catalog_model_runtime_path(
                        &self.catalog,
                        &store.path,
                        *runtime_id,
                        *family_id,
                        model_id,
                    )?;
                    Ok(WorkerStartTranslation {
                        translation_id: translation_id.clone(),
                        model_path,
                        source_language,
                        target_language,
                        texts,
                        use_gpu: acceleration_preference == AccelerationPreference::Auto,
                    })
                })();
                match result {
                    Ok(request) => {
                        if let Err(message) = self.translation_worker.start(request) {
                            events.push(Event::TranslationError {
                                translation_id,
                                code: "translation_worker_unavailable".into(),
                                message,
                                details: None,
                            });
                        }
                    }
                    Err(error) => events.push(Event::TranslationError {
                        translation_id,
                        code: "invalid_translation_request".into(),
                        message: "Translation could not be started.".into(),
                        details: Some(format!("{error:#}")),
                    }),
                }
                (ControlFlow::Continue, events)
            }
            Command::CancelTranslation { translation_id } => {
                self.translation_worker.cancel(&translation_id);
                (ControlFlow::Continue, events)
            }
            Command::SynthesisPlaybackPosition {
                synthesis_id,
                played_through_seq,
            } => {
                self.synthesis_worker
                    .update_playback_position(synthesis_id, played_through_seq);
                (ControlFlow::Continue, events)
            }
            Command::GetSystemInfo => {
                events.push(self.build_system_info_event());

                (ControlFlow::Continue, events)
            }
            Command::StartSession {
                acceleration_preference,
                detailed_timestamps_enabled,
                diarization_enabled,
                diarization_max_speakers,
                include_system_audio,
                language,
                mode,
                model_selection,
                model_store_path_override,
                session_start_unix_ms,
                session_id,
                speaking_style,
            } => {
                if self.active_sessions.len() >= MAX_ACTIVE_SESSIONS {
                    events.push(Event::Error {
                        code: "session_capacity_exceeded".to_string(),
                        details: Some(format!("maximum active sessions: {MAX_ACTIVE_SESSIONS}")),
                        message: "Speech Kit already has the maximum number of active sessions."
                            .to_string(),
                        session_id: Some(session_id),
                    });
                    return (ControlFlow::Continue, events);
                }

                if self.active_sessions.contains_key(&session_id) {
                    events.push(Event::Error {
                        code: "session_already_exists".to_string(),
                        details: None,
                        message: "A dictation session with this id already exists.".to_string(),
                        session_id: Some(session_id),
                    });
                    return (ControlFlow::Continue, events);
                }

                if diarization_max_speakers == Some(0) {
                    events.push(Event::Error {
                        code: "invalid_diarization_speaker_limit".to_string(),
                        details: Some(
                            "diarizationMaxSpeakers must be a positive integer".to_string(),
                        ),
                        message: "Maximum speakers must be at least 1 or set to Automatic."
                            .to_string(),
                        session_id: Some(session_id),
                    });
                    return (ControlFlow::Continue, events);
                }

                match self.resolve_runtime_model_path(
                    &language,
                    &model_selection,
                    model_store_path_override.as_deref(),
                ) {
                    Ok(resolved_model) => {
                        if self
                            .registry
                            .adapter(resolved_model.runtime_id, resolved_model.family_id)
                            .is_some_and(|adapter| adapter.capabilities().task != ModelTask::Stt)
                        {
                            events.push(Event::Error {
                                code: "invalid_model_task".to_string(),
                                details: Some(format!(
                                    "family={} task=tts",
                                    resolved_model.family_id.as_str()
                                )),
                                message: "The selected model is not a dictation model.".to_string(),
                                session_id: Some(session_id),
                            });
                            return (ControlFlow::Continue, events);
                        }
                        let use_gpu = resolve_use_gpu(
                            resolved_model.runtime_id,
                            resolved_model.family_id,
                            acceleration_preference,
                            self.registry.as_ref(),
                        );
                        let config = SessionConfig {
                            mode,
                            session_start_unix_ms,
                            session_id: session_id.clone(),
                            style: speaking_style,
                        };
                        let (cancel_tx, cancel_rx) = watch::channel(false);
                        let session = match (self.session_factory)(config) {
                            Ok(session) => session,
                            Err(SessionInitError::VadLoad(details)) => {
                                events.push(Event::Error {
                                    code: "vad_init_failed".to_string(),
                                    details: Some(details),
                                    message: "Failed to initialize the bundled Silero VAD."
                                        .to_string(),
                                    session_id: None,
                                });

                                return (ControlFlow::Continue, events);
                            }
                        };

                        let engine_context_supported = resolved_model_supports_initial_prompt(
                            self.registry.as_ref(),
                            resolved_model.runtime_id,
                            resolved_model.family_id,
                        );
                        let context_required =
                            should_request_initial_prompt(engine_context_supported, &language);
                        let context_budget_chars = if context_required {
                            CONTEXT_BUDGET_CHARS
                        } else {
                            0
                        };
                        let streaming = self
                            .registry
                            .adapter(resolved_model.runtime_id, resolved_model.family_id)
                            .is_some_and(|adapter| adapter.capabilities().supports_streaming);

                        if self
                            .transcription_worker
                            .send(WorkerCommand::BeginSession(SessionMetadata {
                                runtime_id: resolved_model.runtime_id,
                                family_id: resolved_model.family_id,
                                gpu_config: GpuConfig { use_gpu },
                                detailed_timestamps_enabled,
                                diarization_enabled,
                                diarization_max_speakers,
                                language,
                                model_file_path: resolved_model.resolved_path.clone(),
                                cancel_rx,
                                session_start_unix_ms,
                                session_id: session_id.clone(),
                                stage_enablement: StageEnablement::default(),
                            }))
                            .is_err()
                        {
                            events.push(internal_error_event(
                                "internal_error",
                                "Failed to start the transcription worker session.",
                                None,
                            ));

                            return (ControlFlow::Continue, events);
                        }

                        self.active_sessions.insert(
                            session_id.clone(),
                            ActiveSession {
                                audio_mixer: if include_system_audio {
                                    AudioMixer::microphone_with_system(session_id.clone())
                                } else {
                                    AudioMixer::microphone_only(session_id.clone())
                                },
                                cancel_tx,
                                context_budget_chars,
                                context_required,
                                draining: false,
                                drain_reason: None,
                                last_reported_queue_tier: QueueBackpressureTier::Normal,
                                last_reported_state: None,
                                last_reported_audio_level_at: None,
                                overload_draining: false,
                                pending_context_requests: Vec::new(),
                                queued_utterances: 0,
                                session,
                                streaming,
                                streaming_open: None,
                                transcription_active: false,
                            },
                        );

                        // For system-audio sessions the sidecar produces the
                        // frames itself. Start capture before announcing the
                        // session so a device/platform failure surfaces as an
                        // error instead of a started-then-silent session.
                        if include_system_audio
                            && let Err(error) = self.system_audio.start(session_id.clone())
                        {
                            self.tear_down_session(&session_id);
                            events.push(Event::Error {
                                code: error.code().to_string(),
                                details: None,
                                message: error.message(),
                                session_id: Some(session_id),
                            });
                            return (ControlFlow::Continue, events);
                        }

                        events.push(Event::SessionStarted {
                            mode,
                            session_id: session_id.clone(),
                        });
                        self.emit_state_if_changed(&session_id, &mut events);
                    }
                    Err(error_event) => events.push(*error_event),
                }

                (ControlFlow::Continue, events)
            }
            Command::StopSession { session_id } => {
                if let Some(stop_events) =
                    self.graceful_stop(&session_id, SessionStopReason::UserStop)
                {
                    events.extend(stop_events);
                } else {
                    events.push(Event::Warning {
                        code: "no_active_session".to_string(),
                        details: None,
                        message: "Stop session was requested without an active session."
                            .to_string(),
                        session_id: Some(session_id),
                    });
                }

                (ControlFlow::Continue, events)
            }
            Command::CancelSession { session_id } => {
                if let Some(stop_events) =
                    self.finish_session(&session_id, SessionStopReason::UserCancel)
                {
                    events.extend(stop_events);
                } else {
                    events.push(Event::Warning {
                        code: "no_active_session".to_string(),
                        details: None,
                        message: "Cancel session was requested without an active session."
                            .to_string(),
                        session_id: Some(session_id),
                    });
                }

                (ControlFlow::Continue, events)
            }
            // Shutdown is a hard process-level cancel, not a graceful session
            // drain. Hosts that need final transcripts must stop sessions
            // first, wait for `session_stopped`, then terminate the process.
            Command::Shutdown => {
                for (_, active_session) in self.active_sessions.drain() {
                    let _ = active_session.cancel_tx.send(true);
                }
                let _ = self.transcription_worker.send(WorkerCommand::Shutdown);

                (ControlFlow::Shutdown, events)
            }
        }
    }

    fn build_system_info_event(&self) -> Event {
        let mut compiled_runtimes: Vec<CompiledRuntimeInfo> = self
            .registry
            .runtimes()
            .map(|runtime| CompiledRuntimeInfo {
                runtime_id: runtime.id(),
                display_name: runtime.id().display_name().to_string(),
                runtime_capabilities: runtime.capabilities().clone(),
            })
            .collect();
        compiled_runtimes.sort_by_key(|runtime| runtime.runtime_id.as_str());

        let mut compiled_adapters: Vec<CompiledAdapterInfo> = self
            .registry
            .adapters()
            .map(|adapter| CompiledAdapterInfo {
                runtime_id: adapter.runtime_id(),
                family_id: adapter.family_id(),
                display_name: adapter.family_id().display_name().to_string(),
                family_capabilities: adapter.capabilities().clone(),
            })
            .collect();
        compiled_adapters
            .sort_by_key(|adapter| (adapter.runtime_id.as_str(), adapter.family_id.as_str()));

        Event::SystemInfo {
            sidecar_version: self.sidecar_version.clone(),
            compiled_runtimes,
            compiled_adapters,
            system_info: system_info_string(),
        }
    }

    fn build_probe_event(
        &self,
        selection: SelectedModel,
        model_store_path_override: Option<&str>,
    ) -> Event {
        match self.resolve_selected_model(&selection, model_store_path_override) {
            Ok(resolved_model) => {
                let mut merged_capabilities = self
                    .registry
                    .merged_capabilities(resolved_model.runtime_id, resolved_model.family_id);
                if let Some(capabilities) = &mut merged_capabilities {
                    capabilities.family.supports_language_selection = !matches!(
                        resolved_model.language_support,
                        LanguageSupport::EnglishOnly | LanguageSupport::Unknown
                    );
                    capabilities.family.supported_languages =
                        resolved_model.language_support.clone();
                    capabilities.family.supports_automatic_language_detection =
                        resolved_model.supports_automatic_language_detection;
                }
                Event::ModelProbeResult {
                    available: true,
                    details: None,
                    display_name: Some(resolved_model.display_name),
                    runtime_id: resolved_model.runtime_id,
                    family_id: resolved_model.family_id,
                    installed: resolved_model.installed,
                    merged_capabilities,
                    message: "Model selection is ready.".to_string(),
                    model_id: resolved_model.model_id,
                    resolved_path: Some(resolved_model.resolved_path.display().to_string()),
                    selection: resolved_model.selection,
                    size_bytes: Some(resolved_model.size_bytes),
                    status: ModelProbeStatus::Ready,
                }
            }
            Err(event) => *event,
        }
    }

    fn emit_state_if_changed(&mut self, session_id: &str, events: &mut Vec<Event>) {
        let Some(active_session) = self.active_sessions.get_mut(session_id) else {
            return;
        };
        let next_state = derive_session_state(
            active_session.transcription_active,
            active_session.queued_utterances,
            &active_session.session,
        );

        if active_session.last_reported_state != Some(next_state) {
            active_session.last_reported_state = Some(next_state);
            events.push(Event::SessionStateChanged {
                session_id: active_session.session.config().session_id.clone(),
                state: next_state,
            });
        }
    }

    /// Remove a session and release everything it owns: cancel its worker,
    /// end the worker session, and stop any native system-audio capture.
    /// Emits no events; callers decide what to surface. Returns the removed
    /// session, or `None` if it was already gone.
    fn tear_down_session(&mut self, session_id: &str) -> Option<ActiveSession> {
        let active_session = self.active_sessions.remove(session_id)?;
        let _ = active_session.cancel_tx.send(true);
        let _ = self.transcription_worker.send(WorkerCommand::EndSession {
            session_id: session_id.to_owned(),
        });
        self.system_audio.stop(session_id);

        // Sidecar stderr is piped into the plugin's console log, which is
        // what users paste into bug reports. `silent` ~= `received` means
        // the monitor captured an idle/wrong sink; high `dropped` with high
        // `mic_only` means bursty delivery (frames arriving too late/fast to
        // be mixed in). `None` for microphone-only sessions. The session id is
        // deliberately omitted: adjacent lifecycle logs already identify the
        // session, and CodeQL flags logged session ids as cleartext-logging.
        if let Some(diagnostics) = active_session.audio_mixer.system_audio_diagnostics() {
            eprintln!(
                "system-audio diagnostics: received={} silent={} dropped={} mixed={} mic_only={}",
                diagnostics.system_frames_received,
                diagnostics.silent_system_frames,
                diagnostics.system_frames_dropped,
                diagnostics.mixed_ticks,
                diagnostics.mic_only_ticks,
            );
        }

        Some(active_session)
    }

    fn finish_session(
        &mut self,
        session_id: &str,
        reason: SessionStopReason,
    ) -> Option<Vec<Event>> {
        let active_session = self.tear_down_session(session_id)?;
        let session_id = active_session.session.config().session_id.clone();
        Some(vec![Event::SessionStopped { reason, session_id }])
    }

    fn graceful_stop(&mut self, session_id: &str, reason: SessionStopReason) -> Option<Vec<Event>> {
        let active_session = self.active_sessions.get_mut(session_id)?;
        let mut events = Vec::new();

        let final_utterance = active_session.session.maybe_finalize_utterance();
        active_session.session.clear_activity();

        if let Some(utterance) = final_utterance {
            self.enqueue_utterance(session_id, utterance, &mut events);
        }

        let active_session = self.active_sessions.get_mut(session_id)?;
        if !active_session.transcription_active {
            let session_id = active_session.session.config().session_id.clone();
            self.tear_down_session(&session_id)?;
            events.push(Event::SessionStopped { reason, session_id });
            return Some(events);
        }

        // Transcription is still in flight; defer SessionStopped until the last
        // TranscriptReady drains through the worker. Do not signal cancel here —
        // maybe_complete_drain emits the final cancel as teardown once the queue
        // is empty.
        active_session.draining = true;
        active_session.drain_reason = Some(reason);
        self.emit_state_if_changed(session_id, &mut events);
        Some(events)
    }

    /// If the session is draining and no transcription work remains, tear it
    /// down and emit `SessionStopped`. Returns `true` when the drain completed.
    fn maybe_complete_drain(&mut self, session_id: &str, events: &mut Vec<Event>) -> bool {
        let Some(active_session) = self.active_sessions.get(session_id) else {
            return false;
        };

        let draining = active_session.draining;
        let overload_draining = active_session.overload_draining;
        if (!draining && !overload_draining)
            || active_session.transcription_active
            || active_session.queued_utterances > 0
        {
            return false;
        }

        let reason = if overload_draining {
            SessionStopReason::QueueOverload
        } else {
            active_session
                .drain_reason
                .unwrap_or(SessionStopReason::UserStop)
        };

        if self.tear_down_session(session_id).is_none() {
            return false;
        }
        events.push(Event::SessionStopped {
            reason,
            session_id: session_id.to_owned(),
        });
        true
    }

    fn dispatch_streaming_audio(
        &mut self,
        session_id: &str,
        frame_bytes: &[u8],
        events: &mut Vec<Event>,
    ) {
        let Some(active_session) = self.active_sessions.get_mut(session_id) else {
            return;
        };
        if !active_session.streaming {
            return;
        }
        let Some(utterance_index) = active_session.session.live_utterance_index() else {
            return;
        };

        let (command, opened) = match active_session.streaming_open {
            Some(open) if open.utterance_index == utterance_index => (
                WorkerCommand::StreamAudio {
                    samples: decode_pcm_samples(frame_bytes),
                    session_id: session_id.to_string(),
                    utterance_id: open.utterance_id,
                },
                false,
            ),
            _ => {
                let Some(utterance) = active_session.session.live_utterance() else {
                    return;
                };
                let utterance_id = Uuid::new_v4();
                active_session.streaming_open = Some(StreamingOpenUtterance {
                    utterance_id,
                    utterance_index,
                });
                mark_transcription_enqueued(active_session);
                (
                    WorkerCommand::BeginStreamingUtterance {
                        session_id: session_id.to_string(),
                        utterance,
                        utterance_id,
                    },
                    true,
                )
            }
        };

        if self.transcription_worker.send(command).is_err() {
            events.push(Event::Error {
                code: "internal_error".to_string(),
                details: None,
                message: "Failed to stream audio for local transcription.".to_string(),
                session_id: Some(session_id.to_string()),
            });
            if opened {
                active_session.streaming_open = None;
                advance_transcription_queue(active_session);
            }
        }
        emit_queue_tier_if_changed(active_session, events);
    }

    fn handle_session_action(
        &mut self,
        session_id: &str,
        action: SessionAction,
        events: &mut Vec<Event>,
    ) {
        match action {
            SessionAction::FinalizeUtterance(utterance) => {
                self.enqueue_utterance(session_id, utterance, events);
            }
            SessionAction::Stop(reason) => {
                if let Some(stop_events) = self.graceful_stop(session_id, reason) {
                    events.extend(stop_events);
                }
            }
        }
    }

    fn handle_worker_event(&mut self, worker_event: WorkerEvent, events: &mut Vec<Event>) {
        match worker_event {
            WorkerEvent::SessionError {
                code,
                details,
                finalizes_utterance,
                message,
                session_id,
                utterance_id,
            } => {
                if utterance_id.is_none() {
                    // No utterance to attribute this to means the failure is
                    // session-scoped, not per-utterance. Today the only
                    // source is `BeginSession` failing or panicking before
                    // the worker inserts its session record, which leaves
                    // the worker with no session at all for `session_id`.
                    // Tear the app-level session down to match: otherwise it
                    // looks alive to the host forever while the worker
                    // silently ignores every future command for it (#194).
                    events.push(Event::Error {
                        code,
                        details,
                        message,
                        session_id: Some(session_id.clone()),
                    });
                    if self.tear_down_session(&session_id).is_some() {
                        events.push(Event::SessionStopped {
                            reason: SessionStopReason::SessionError,
                            session_id,
                        });
                    }
                    return;
                }

                if !finalizes_utterance {
                    if !self.active_sessions.contains_key(&session_id) {
                        return;
                    }
                    events.push(Event::Warning {
                        code,
                        details,
                        message,
                        session_id: Some(session_id.clone()),
                    });
                    self.emit_state_if_changed(&session_id, events);
                    return;
                }

                {
                    let Some(active_session) = self.active_sessions.get_mut(&session_id) else {
                        return;
                    };

                    advance_transcription_queue(active_session);
                    emit_queue_tier_if_changed(active_session, events);
                }

                events.push(Event::Error {
                    code,
                    details,
                    message,
                    session_id: Some(session_id.clone()),
                });

                if self.maybe_complete_drain(&session_id, events) {
                    return;
                }

                self.emit_state_if_changed(&session_id, events);
            }
            WorkerEvent::TranscriptReady {
                pause_ms_before_utterance,
                processing_duration_ms,
                session_id,
                speaker_index,
                transcript,
                utterance_duration_ms,
                utterance_end_ms_in_session,
                utterance_index,
                utterance_start_ms_in_session,
                warnings,
            } => {
                let is_final = transcript.is_final();
                if is_final {
                    let Some(active_session) = self.active_sessions.get_mut(&session_id) else {
                        return;
                    };

                    advance_transcription_queue(active_session);
                    emit_queue_tier_if_changed(active_session, events);
                }

                let text = transcript.joined_text();
                events.push(Event::TranscriptReady {
                    is_final,
                    pause_ms_before_utterance,
                    processing_duration_ms,
                    revision: transcript.revision,
                    segments: transcript.segments,
                    session_id: session_id.clone(),
                    speaker_index,
                    stage_results: transcript.stage_history,
                    text,
                    utterance_duration_ms,
                    utterance_end_ms_in_session,
                    utterance_id: transcript.utterance_id,
                    utterance_index,
                    utterance_start_ms_in_session,
                    warnings,
                });

                if self.maybe_complete_drain(&session_id, events) {
                    return;
                }

                let should_stop = is_final
                    && self.active_sessions.get(&session_id).is_some_and(|s| {
                        s.session.config().mode == ListeningMode::OneSentence
                            && !s.overload_draining
                    });

                if should_stop {
                    if let Some(stop_events) =
                        self.graceful_stop(&session_id, SessionStopReason::SentenceComplete)
                    {
                        events.extend(stop_events);
                    }
                    return;
                }

                self.emit_state_if_changed(&session_id, events);
            }
        }
    }

    fn enqueue_utterance(
        &mut self,
        session_id: &str,
        utterance: FinalizedUtterance,
        events: &mut Vec<Event>,
    ) {
        let Some(active_session) = self.active_sessions.get_mut(session_id) else {
            return;
        };

        let session_id = active_session.session.config().session_id.clone();

        if active_session.overload_draining {
            // Capture is already stopped; only a buffered finalize (graceful
            // stop, sentence-complete) can race in here. Drop instead of
            // queueing past the hard cap.
            events.push(Event::Warning {
                code: "utterance_dropped_during_overload_drain".to_string(),
                details: None,
                message:
                    "Dropped a finalized utterance while draining the transcription queue overload."
                        .to_string(),
                session_id: Some(session_id),
            });
            return;
        }

        if active_session.streaming {
            let open = active_session.streaming_open.take();
            let utterance_id = open.map_or_else(Uuid::new_v4, |open| open.utterance_id);
            if open.is_none() {
                mark_transcription_enqueued(active_session);
            }
            let send_result =
                self.transcription_worker
                    .send(WorkerCommand::FinalizeStreamingUtterance {
                        session_id: session_id.clone(),
                        utterance,
                        utterance_id,
                    });
            if send_result.is_err() {
                events.push(Event::Error {
                    code: "internal_error".to_string(),
                    details: None,
                    message: "Failed to finalize streaming transcription.".to_string(),
                    session_id: Some(session_id.clone()),
                });
                advance_transcription_queue(active_session);
            }
            emit_queue_tier_if_changed(active_session, events);
            enter_overload_drain_if_saturated(active_session, events);
            return;
        }

        let utterance_id = Uuid::new_v4();
        let correlation_id = Uuid::new_v4();
        let deadline = Instant::now() + CONTEXT_REQUEST_TIMEOUT;

        mark_transcription_enqueued(active_session);

        let pending = PendingContextRequest {
            correlation_id,
            deadline,
            session_id: session_id.clone(),
            utterance,
            utterance_id,
        };

        if active_session.context_required {
            active_session.pending_context_requests.push(pending);
            events.push(Event::ContextRequest {
                budget_chars: active_session.context_budget_chars,
                correlation_id,
                session_id: session_id.clone(),
                utterance_id,
            });
        } else {
            self.dispatch_pending(pending, None, events);
        }

        if let Some(active_session) = self.active_sessions.get_mut(&session_id) {
            emit_queue_tier_if_changed(active_session, events);
            enter_overload_drain_if_saturated(active_session, events);
        }
    }

    fn handle_context_response(
        &mut self,
        correlation_id: Uuid,
        context: Option<ContextWindow>,
        events: &mut Vec<Event>,
    ) {
        let Some((session_id, index)) =
            self.active_sessions
                .iter()
                .find_map(|(session_id, active_session)| {
                    active_session
                        .pending_context_requests
                        .iter()
                        .position(|pending| pending.correlation_id == correlation_id)
                        .map(|index| (session_id.clone(), index))
                })
        else {
            return;
        };

        let Some(active_session) = self.active_sessions.get_mut(&session_id) else {
            return;
        };
        let pending = active_session.pending_context_requests.remove(index);
        let context_budget_chars = active_session.context_budget_chars;
        let context = context.filter(|window| {
            window.budget_chars <= context_budget_chars
                && window.text.chars().count() <= context_budget_chars as usize
                && context_source_chars(window) <= context_budget_chars as usize
        });
        self.dispatch_pending(pending, context, events);
    }

    /// Dispatch any pending context requests whose deadline has elapsed.
    pub(crate) fn tick(&mut self) -> Vec<Event> {
        let now = Instant::now();
        let mut expired = Vec::new();
        for active_session in self.active_sessions.values_mut() {
            expired.extend(
                active_session
                    .pending_context_requests
                    .extract_if(.., |pending| pending.deadline <= now),
            );
        }

        let mut events = Vec::new();
        for pending in expired {
            self.dispatch_pending(pending, None, &mut events);
        }
        events
    }

    fn dispatch_pending(
        &mut self,
        pending: PendingContextRequest,
        context: Option<ContextWindow>,
        events: &mut Vec<Event>,
    ) {
        let send_result = self
            .transcription_worker
            .send(WorkerCommand::TranscribeUtterance {
                context,
                session_id: pending.session_id.clone(),
                utterance: pending.utterance,
                utterance_id: pending.utterance_id,
            });

        if send_result.is_err() {
            let session_id = pending.session_id.clone();
            events.push(Event::Error {
                code: "internal_error".to_string(),
                details: None,
                message: "Failed to queue audio for local transcription.".to_string(),
                session_id: Some(session_id.clone()),
            });

            if let Some(active_session) = self.active_sessions.get_mut(&session_id) {
                advance_transcription_queue(active_session);
                emit_queue_tier_if_changed(active_session, events);
            }
        }
    }

    fn resolve_runtime_model_path(
        &self,
        language: &str,
        selection: &SelectedModel,
        model_store_path_override: Option<&str>,
    ) -> Result<ResolvedModelSelection, Box<Event>> {
        let resolved = self
            .resolve_selected_model(selection, model_store_path_override)
            .map_err(|event| match *event {
                Event::ModelProbeResult {
                    details,
                    message,
                    status,
                    ..
                } => Box::new(Event::Error {
                    // A successful probe never reaches this branch: the Err
                    // path only carries Missing or Invalid statuses. Treating
                    // Ready as Invalid keeps the dispatch exhaustive without
                    // falsely signalling success.
                    code: match status {
                        ModelProbeStatus::Missing => "missing_model_file".to_string(),
                        ModelProbeStatus::Invalid | ModelProbeStatus::Ready => {
                            "invalid_model_file".to_string()
                        }
                    },
                    details,
                    message,
                    session_id: None,
                }),
                _ => Box::new(internal_error_event(
                    "internal_error",
                    "Failed to resolve the selected model.",
                    None,
                )),
            })?;
        if !language_supports(
            &resolved.language_support,
            resolved.supports_automatic_language_detection,
            language,
        ) {
            let supported = match &resolved.language_support {
                LanguageSupport::All => "all languages".to_string(),
                LanguageSupport::List { tags } => tags.join(", "),
                LanguageSupport::EnglishOnly => "en".to_string(),
                LanguageSupport::Unknown => "en (safe default)".to_string(),
            };
            return Err(Box::new(Event::Error {
                code: "unsupported_language".to_string(),
                details: Some(format!(
                    "model={}, selected={language}, supported={supported}",
                    resolved.display_name
                )),
                message: format!(
                    "{} does not support {language}. Choose one of: {supported}.",
                    resolved.display_name
                ),
                session_id: None,
            }));
        }
        Ok(resolved)
    }

    fn resolve_selected_model(
        &self,
        selection: &SelectedModel,
        model_store_path_override: Option<&str>,
    ) -> Result<ResolvedModelSelection, Box<Event>> {
        let runtime_id = selection.runtime_id();
        let family_id = selection.family_id();
        let probe_error = |status, message: &str, fields: ProbeErrorFields| {
            Box::new(Event::ModelProbeResult {
                available: false,
                size_bytes: None,
                runtime_id,
                family_id,
                selection: selection.clone(),
                status,
                message: message.to_string(),
                details: fields.details,
                display_name: fields.display_name,
                installed: fields.installed,
                merged_capabilities: None,
                model_id: fields.model_id,
                resolved_path: fields.resolved_path,
            })
        };

        match selection {
            SelectedModel::CatalogModel { model_id, .. } => {
                let model = self
                    .catalog
                    .find_model(runtime_id, family_id, model_id)
                    .cloned()
                    .ok_or_else(|| {
                        probe_error(
                            ModelProbeStatus::Invalid,
                            "The selected managed model does not exist in the bundled catalog.",
                            ProbeErrorFields {
                                model_id: Some(model_id.clone()),
                                ..Default::default()
                            },
                        )
                    })?;
                let store_info =
                    resolve_model_store_info(model_store_path_override).map_err(|error| {
                        probe_error(
                            ModelProbeStatus::Invalid,
                            "The model store path is invalid.",
                            ProbeErrorFields {
                                details: Some(format!("{error:#}")),
                                display_name: Some(model.display_name.clone()),
                                model_id: Some(model_id.clone()),
                                ..Default::default()
                            },
                        )
                    })?;
                let resolved_path = resolve_catalog_model_runtime_path(
                    &self.catalog,
                    &store_info.path,
                    runtime_id,
                    family_id,
                    model_id,
                )
                .map_err(|error| {
                    probe_error(
                        ModelProbeStatus::Missing,
                        "The selected managed model is not installed or is incomplete.",
                        ProbeErrorFields {
                            details: Some(format!("{error:#}")),
                            display_name: Some(model.display_name.clone()),
                            model_id: Some(model_id.clone()),
                            ..Default::default()
                        },
                    )
                })?;
                let adapter_language_support = self
                    .registry
                    .probe_model_and_language_support(runtime_id, family_id, &resolved_path)
                    .map_err(|error| {
                        probe_error(
                            ModelProbeStatus::Invalid,
                            error.message,
                            ProbeErrorFields {
                                details: error.details,
                                display_name: Some(model.display_name.clone()),
                                installed: true,
                                model_id: Some(model_id.clone()),
                                resolved_path: Some(resolved_path.display().to_string()),
                            },
                        )
                    })?;
                if model
                    .language_tags
                    .iter()
                    .any(|tag| !language_supports(&adapter_language_support, false, tag))
                {
                    return Err(probe_error(
                        ModelProbeStatus::Invalid,
                        "The model catalog language metadata does not match the installed model.",
                        ProbeErrorFields {
                            details: Some(format!(
                                "catalog={:?}, adapter={adapter_language_support:?}",
                                model.language_tags
                            )),
                            display_name: Some(model.display_name.clone()),
                            installed: true,
                            model_id: Some(model_id.clone()),
                            resolved_path: Some(resolved_path.display().to_string()),
                        },
                    ));
                }
                let adapter_supports_automatic_language_detection = self
                    .adapter_supports_automatic_language_detection(
                        runtime_id,
                        family_id,
                        &adapter_language_support,
                    );
                if model.supports_automatic_language_detection
                    && !adapter_supports_automatic_language_detection
                {
                    return Err(probe_error(
                        ModelProbeStatus::Invalid,
                        "The model catalog automatic-language metadata does not match the installed model.",
                        ProbeErrorFields {
                            details: Some(format!(
                                "catalog=true, adapter={adapter_supports_automatic_language_detection}"
                            )),
                            display_name: Some(model.display_name.clone()),
                            installed: true,
                            model_id: Some(model_id.clone()),
                            resolved_path: Some(resolved_path.display().to_string()),
                        },
                    ));
                }
                let size_bytes = file_size(&resolved_path);

                Ok(ResolvedModelSelection {
                    display_name: model.display_name,
                    runtime_id,
                    family_id,
                    installed: true,
                    language_support: LanguageSupport::List {
                        tags: model.language_tags,
                    },
                    supports_automatic_language_detection: model
                        .supports_automatic_language_detection,
                    model_id: Some(model_id.clone()),
                    resolved_path,
                    selection: selection.clone(),
                    size_bytes,
                })
            }
            SelectedModel::ExternalFile { file_path, .. } => {
                let trimmed_path = file_path.trim();

                if trimmed_path.is_empty() {
                    return Err(probe_error(
                        ModelProbeStatus::Invalid,
                        "External model file path is not configured.",
                        ProbeErrorFields::default(),
                    ));
                }

                let model_path = Path::new(trimmed_path);

                if !model_path.is_absolute() {
                    return Err(probe_error(
                        ModelProbeStatus::Invalid,
                        "External model file path must be absolute.",
                        ProbeErrorFields {
                            details: Some(trimmed_path.to_string()),
                            display_name: Some(file_name_or_path(model_path)),
                            ..Default::default()
                        },
                    ));
                }

                let language_support = self
                    .registry
                    .probe_model_and_language_support(runtime_id, family_id, model_path)
                    .map_err(|error| {
                        let status = if error.code == "missing_model_file" {
                            ModelProbeStatus::Missing
                        } else {
                            ModelProbeStatus::Invalid
                        };
                        probe_error(
                            status,
                            error.message,
                            ProbeErrorFields {
                                details: error.details,
                                display_name: Some(file_name_or_path(model_path)),
                                resolved_path: Some(model_path.display().to_string()),
                                ..Default::default()
                            },
                        )
                    })?;
                let size_bytes = file_size(model_path);
                let supports_automatic_language_detection = self
                    .adapter_supports_automatic_language_detection(
                        runtime_id,
                        family_id,
                        &language_support,
                    );

                Ok(ResolvedModelSelection {
                    display_name: file_name_or_path(model_path),
                    runtime_id,
                    family_id,
                    installed: false,
                    language_support,
                    supports_automatic_language_detection,
                    model_id: None,
                    resolved_path: model_path.to_path_buf(),
                    selection: selection.clone(),
                    size_bytes,
                })
            }
        }
    }

    // Automatic detection is only trustworthy per exact model: the family may
    // advertise it while the installed weights are English-only (e.g. `.en`
    // Whisper variants).
    fn adapter_supports_automatic_language_detection(
        &self,
        runtime_id: RuntimeId,
        family_id: ModelFamilyId,
        language_support: &LanguageSupport,
    ) -> bool {
        self.registry
            .merged_capabilities(runtime_id, family_id)
            .is_some_and(|capabilities| {
                capabilities.family.supports_automatic_language_detection
                    && !matches!(
                        language_support,
                        LanguageSupport::EnglishOnly | LanguageSupport::Unknown
                    )
            })
    }
}

fn language_supports(
    support: &LanguageSupport,
    supports_automatic_language_detection: bool,
    language: &str,
) -> bool {
    if language == "auto" {
        return supports_automatic_language_detection;
    }
    match support {
        LanguageSupport::All => true,
        LanguageSupport::EnglishOnly | LanguageSupport::Unknown => language == "en",
        LanguageSupport::List { tags } => tags.iter().any(|tag| tag == language),
    }
}

fn advance_transcription_queue(active_session: &mut ActiveSession) {
    if active_session.queued_utterances > 0 {
        active_session.queued_utterances -= 1;
        active_session.transcription_active = true;
    } else {
        active_session.transcription_active = false;
    }
}

fn mark_transcription_enqueued(active_session: &mut ActiveSession) {
    if active_session.transcription_active {
        active_session.queued_utterances += 1;
    } else {
        active_session.transcription_active = true;
    }
}

fn decode_pcm_samples(frame_bytes: &[u8]) -> Vec<i16> {
    frame_bytes
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect()
}

fn queue_backpressure_tier(queued_utterances: usize) -> QueueBackpressureTier {
    match queued_utterances {
        0..=2 => QueueBackpressureTier::Normal,
        3..=9 => QueueBackpressureTier::CatchingUp,
        10..=29 => QueueBackpressureTier::FallingBehind,
        _ => QueueBackpressureTier::Saturated,
    }
}

fn emit_queue_tier_if_changed(active_session: &mut ActiveSession, events: &mut Vec<Event>) {
    let tier = queue_backpressure_tier(active_session.queued_utterances);
    if active_session.last_reported_queue_tier == tier {
        return;
    }
    active_session.last_reported_queue_tier = tier;
    events.push(Event::TranscriptionQueueChanged {
        queued_utterances: active_session.queued_utterances,
        session_id: active_session.session.config().session_id.clone(),
        tier,
    });
}

fn enter_overload_drain_if_saturated(active_session: &mut ActiveSession, events: &mut Vec<Event>) {
    if active_session.queued_utterances < QUEUE_OVERLOAD_DEPTH || active_session.overload_draining {
        return;
    }

    active_session.overload_draining = true;
    events.push(Event::Error {
        code: "utterance_queue_overload".to_string(),
        details: Some(format!(
            "queue depth reached saturation at {QUEUE_OVERLOAD_DEPTH}"
        )),
        message: "Speech Kit stopped because the transcription backlog reached capacity. Already accepted utterances will finish processing.".to_string(),
        session_id: Some(active_session.session.config().session_id.clone()),
    });
}

fn audio_level_event_if_due(
    active_session: &mut ActiveSession,
    mixed: &MixedAudioFrame,
) -> Option<Event> {
    let now = Instant::now();
    if let Some(last_reported) = active_session.last_reported_audio_level_at
        && now.duration_since(last_reported) < AUDIO_LEVEL_EVENT_INTERVAL
    {
        return None;
    }

    active_session.last_reported_audio_level_at = Some(now);
    // The mix path runs every 20 ms frame, but emission is throttled to
    // AUDIO_LEVEL_EVENT_INTERVAL — so analyze only the frames we actually report
    // rather than computing an FFT that gets discarded on most frames.
    let bands = active_session
        .audio_mixer
        .analyze_levels(&mixed.frame_bytes);
    Some(Event::AudioLevel {
        bands,
        session_id: mixed.session_id.clone(),
    })
}

fn invalid_audio_frame_event(session_id: &str, error: AudioMixerError) -> Event {
    Event::Error {
        code: "invalid_audio_frame".to_string(),
        details: Some(format!(
            "expected {} bytes, received {}",
            error.expected_bytes, error.actual_bytes
        )),
        message: "Audio frame size does not match the configured 20 ms PCM format.".to_string(),
        session_id: Some(session_id.to_string()),
    }
}

fn resolved_model_supports_initial_prompt(
    registry: &EngineRegistry,
    runtime_id: RuntimeId,
    family_id: ModelFamilyId,
) -> bool {
    registry
        .adapter(runtime_id, family_id)
        .is_some_and(|adapter| adapter.capabilities().supports_initial_prompt)
}

fn should_request_initial_prompt(engine_supports_initial_prompt: bool, language: &str) -> bool {
    engine_supports_initial_prompt && language == ENGLISH_LANGUAGE_TAG
}

fn context_source_chars(window: &ContextWindow) -> usize {
    window
        .sources
        .iter()
        .map(|source| source.text().chars().count())
        .sum()
}

fn derive_session_state(
    transcription_active: bool,
    queued_utterances: usize,
    session: &ListeningSession,
) -> SessionState {
    let base_state = session.base_state();

    if base_state == SessionBaseState::SpeechDetected {
        return SessionState::SpeechDetected;
    }

    if base_state == SessionBaseState::SpeechEnding {
        return SessionState::SpeechEnding;
    }

    if transcription_active {
        return SessionState::Transcribing;
    }

    if queued_utterances > 0 {
        return SessionState::Transcribing;
    }

    match base_state {
        SessionBaseState::Listening => SessionState::Listening,
        SessionBaseState::SpeechDetected | SessionBaseState::SpeechEnding => {
            unreachable!("handled above")
        }
    }
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn file_name_or_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.display().to_string())
}

fn internal_error_event(code: &str, message: &str, details: Option<String>) -> Event {
    Event::Error {
        code: code.to_string(),
        details,
        message: message.to_string(),
        session_id: None,
    }
}

fn synthesis_error_event(
    synthesis_id: u32,
    code: &str,
    message: &str,
    details: Option<String>,
) -> Event {
    Event::SynthesisError {
        synthesis_id,
        code: code.to_string(),
        message: message.to_string(),
        details,
    }
}

fn resolve_use_gpu(
    runtime_id: RuntimeId,
    family_id: ModelFamilyId,
    acceleration_preference: AccelerationPreference,
    registry: &EngineRegistry,
) -> bool {
    match acceleration_preference {
        AccelerationPreference::CpuOnly => false,
        AccelerationPreference::Auto => {
            let Some(adapter) = registry.adapter(runtime_id, family_id) else {
                debug_assert!(
                    false,
                    "resolve_use_gpu called with unregistered adapter {runtime_id:?}:{family_id:?}"
                );
                return false;
            };
            if !adapter.capabilities().supports_hardware_acceleration {
                return false;
            }

            match registry.runtime(runtime_id) {
                Some(runtime) => runtime
                    .capabilities()
                    .available_accelerators
                    .iter()
                    .any(|accelerator| *accelerator != AcceleratorId::Cpu),
                None => {
                    // Reaching here means dispatch picked a runtime the registry
                    // did not register — a registration bug, not a runtime state.
                    // Crash loudly in debug builds so regressions surface during
                    // development while release builds stay on CPU rather than
                    // panicking on a user's machine.
                    debug_assert!(
                        false,
                        "resolve_use_gpu called with unregistered runtime {runtime_id:?}"
                    );
                    false
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::env::temp_dir;
    use std::fs::{create_dir_all, write};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    use std::time::{Duration, Instant};

    use uuid::Uuid;

    use super::{AppState, ControlFlow, should_request_initial_prompt};
    use crate::catalog::{
        ArtifactRole, CatalogModel, ModelArtifact, ModelCatalog, ModelCollection,
        ModelFamilyDescriptor, ModelRuntimeDescriptor,
    };
    use crate::engine::capabilities::{
        AcceleratorAvailability, AcceleratorId, LanguageSupport, ModelFamilyCapabilities,
        ModelFamilyId, ModelFormat, ModelTask, RuntimeCapabilities, RuntimeId,
    };
    use crate::engine::registry::EngineRegistry;
    use crate::engine::traits::{LoadedModel, ModelFamilyAdapter, Runtime};
    use crate::protocol::{
        AccelerationPreference, AudioFrame, Command, ContextWindow, ContextWindowSource, Event,
        HealthStatus, ListeningMode, ModelProbeStatus, PCM_BYTES_PER_FRAME, QueueBackpressureTier,
        SelectedModel, SessionState, SessionStopReason, SourceRange, StageId, StageOutcome,
        StageStatus, SynthesisTextChunk,
    };
    use crate::session::{FinalizedUtterance, ListeningSession, SessionInitError, SpeakingStyle};
    use crate::system_audio::{AudioFrameSink, SystemAudioCapture, SystemAudioError};
    use crate::transcription::{
        EngineTranscriptOutput, GpuConfig, Transcript, TranscriptionError, TranscriptionRequest,
        validate_model_path,
    };
    use crate::worker::WorkerEvent;

    struct FakeRuntime {
        id: RuntimeId,
        capabilities: RuntimeCapabilities,
    }

    impl FakeRuntime {
        fn cpu_only() -> Self {
            let mut accelerator_details = std::collections::HashMap::new();
            accelerator_details.insert(
                AcceleratorId::Cpu,
                AcceleratorAvailability {
                    available: true,
                    unavailable_reason: None,
                },
            );
            Self {
                id: RuntimeId::WhisperCpp,
                capabilities: RuntimeCapabilities {
                    available_accelerators: vec![AcceleratorId::Cpu],
                    accelerator_details,
                    supported_model_formats: vec![ModelFormat::Ggml, ModelFormat::Gguf],
                },
            }
        }

        fn with_cuda() -> Self {
            let mut accelerator_details = std::collections::HashMap::new();
            accelerator_details.insert(
                AcceleratorId::Cpu,
                AcceleratorAvailability {
                    available: true,
                    unavailable_reason: None,
                },
            );
            accelerator_details.insert(
                AcceleratorId::Cuda,
                AcceleratorAvailability {
                    available: true,
                    unavailable_reason: None,
                },
            );
            Self {
                id: RuntimeId::WhisperCpp,
                capabilities: RuntimeCapabilities {
                    available_accelerators: vec![AcceleratorId::Cpu, AcceleratorId::Cuda],
                    accelerator_details,
                    supported_model_formats: vec![ModelFormat::Ggml, ModelFormat::Gguf],
                },
            }
        }

        fn onnx() -> Self {
            let mut runtime = Self::cpu_only();
            runtime.id = RuntimeId::OnnxRuntime;
            runtime.capabilities.supported_model_formats = vec![ModelFormat::Onnx];
            runtime
        }
    }

    impl Runtime for FakeRuntime {
        fn id(&self) -> RuntimeId {
            self.id
        }

        fn capabilities(&self) -> &RuntimeCapabilities {
            &self.capabilities
        }
    }

    #[derive(Clone, Copy)]
    enum FakeLoadBehavior {
        Succeed,
        Fail,
        Panic,
    }

    struct FakeAdapter {
        family_id: ModelFamilyId,
        runtime_id: RuntimeId,
        capabilities: ModelFamilyCapabilities,
        load_behavior: FakeLoadBehavior,
        probed_language_support: Option<LanguageSupport>,
    }

    impl FakeAdapter {
        fn new() -> Self {
            Self::with_initial_prompt(true)
        }

        fn with_initial_prompt(supports_initial_prompt: bool) -> Self {
            Self {
                family_id: ModelFamilyId::Whisper,
                runtime_id: RuntimeId::WhisperCpp,
                capabilities: ModelFamilyCapabilities {
                    task: ModelTask::Stt,
                    supports_hardware_acceleration: true,
                    available_voices: Vec::new(),
                    supports_speed_control: false,
                    output_sample_rate: None,
                    supports_segment_timestamps: true,
                    supports_word_timestamps: false,
                    supports_initial_prompt,
                    supports_streaming: false,
                    supports_language_selection: false,
                    supports_automatic_language_detection: false,
                    supported_languages: LanguageSupport::EnglishOnly,
                    max_audio_duration_secs: None,
                    produces_punctuation: true,
                },
                load_behavior: FakeLoadBehavior::Succeed,
                probed_language_support: None,
            }
        }

        /// A family that advertises multilingual + automatic detection while
        /// the probed model file contains English-only weights — the `.en`
        /// Whisper variant shape.
        fn multilingual_family_with_english_only_model() -> Self {
            let mut adapter = Self::new();
            adapter.capabilities.supports_language_selection = true;
            adapter.capabilities.supports_automatic_language_detection = true;
            adapter.capabilities.supported_languages = LanguageSupport::List {
                tags: vec!["en".to_string(), "es".to_string()],
            };
            adapter.probed_language_support = Some(LanguageSupport::EnglishOnly);
            adapter
        }

        fn for_family(runtime_id: RuntimeId, family_id: ModelFamilyId) -> Self {
            let mut adapter = Self::new();
            adapter.runtime_id = runtime_id;
            adapter.family_id = family_id;
            adapter
        }

        fn without_hardware_acceleration() -> Self {
            let mut adapter = Self::new();
            adapter.capabilities.supports_hardware_acceleration = false;
            adapter
        }

        fn tts() -> Self {
            let mut adapter = Self::for_family(RuntimeId::OnnxRuntime, ModelFamilyId::PocketTts);
            adapter.capabilities.task = ModelTask::Tts;
            adapter.capabilities.supports_streaming = true;
            adapter
        }

        /// Probe succeeds (so `StartSession` proceeds past model resolution),
        /// but the worker's async `load()` returns an error — simulating a
        /// corrupt or incompatible model file discovered only once the
        /// worker thread actually loads it.
        fn failing_load() -> Self {
            let mut adapter = Self::new();
            adapter.load_behavior = FakeLoadBehavior::Fail;
            adapter
        }

        /// Same as `failing_load`, but the worker thread panics instead of
        /// returning `Err` — simulating a crash inside a third-party engine
        /// library during model load.
        fn panicking_load() -> Self {
            let mut adapter = Self::new();
            adapter.load_behavior = FakeLoadBehavior::Panic;
            adapter
        }
    }

    struct FakeLoadedModel;

    impl LoadedModel for FakeLoadedModel {
        fn transcribe(
            &mut self,
            _request: &TranscriptionRequest,
        ) -> Result<EngineTranscriptOutput, TranscriptionError> {
            Ok(EngineTranscriptOutput {
                detected_language: None,
                diagnostics: Vec::new(),
                segments: Vec::new(),
            })
        }
    }

    impl ModelFamilyAdapter for FakeAdapter {
        fn runtime_id(&self) -> RuntimeId {
            self.runtime_id
        }

        fn family_id(&self) -> ModelFamilyId {
            self.family_id
        }

        fn capabilities(&self) -> &ModelFamilyCapabilities {
            &self.capabilities
        }

        fn probe_model(&self, path: &std::path::Path) -> Result<(), TranscriptionError> {
            validate_model_path(path)
        }

        fn probe_model_and_language_support(
            &self,
            path: &std::path::Path,
        ) -> Result<LanguageSupport, TranscriptionError> {
            self.probe_model(path)?;
            Ok(self
                .probed_language_support
                .clone()
                .unwrap_or_else(|| self.capabilities.supported_languages.clone()))
        }

        fn load(
            &self,
            _path: &std::path::Path,
            _gpu: GpuConfig,
        ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
            match self.load_behavior {
                FakeLoadBehavior::Succeed => Ok(Box::new(FakeLoadedModel)),
                FakeLoadBehavior::Fail => {
                    Err(TranscriptionError::invalid_model("fake model load failure"))
                }
                FakeLoadBehavior::Panic => panic!("fake model load panicked"),
            }
        }
    }

    fn fake_registry_with_failing_load() -> Arc<EngineRegistry> {
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::cpu_only()));
        registry.register_adapter(Box::new(FakeAdapter::failing_load()));
        Arc::new(registry)
    }

    fn fake_registry_with_panicking_load() -> Arc<EngineRegistry> {
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::cpu_only()));
        registry.register_adapter(Box::new(FakeAdapter::panicking_load()));
        Arc::new(registry)
    }

    fn fake_registry() -> Arc<EngineRegistry> {
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::cpu_only()));
        registry.register_adapter(Box::new(FakeAdapter::new()));
        Arc::new(registry)
    }

    fn fake_registry_without_context_support() -> Arc<EngineRegistry> {
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::cpu_only()));
        registry.register_adapter(Box::new(FakeAdapter::with_initial_prompt(false)));
        Arc::new(registry)
    }

    fn fake_registry_with_cuda() -> Arc<EngineRegistry> {
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::with_cuda()));
        registry.register_adapter(Box::new(FakeAdapter::new()));
        Arc::new(registry)
    }

    fn fake_registry_with_cuda_and_cpu_only_adapter() -> Arc<EngineRegistry> {
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::with_cuda()));
        registry.register_adapter(Box::new(FakeAdapter::without_hardware_acceleration()));
        Arc::new(registry)
    }

    fn fake_registry_with_all_engines() -> Arc<EngineRegistry> {
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::cpu_only()));
        registry.register_runtime(Box::new(FakeRuntime::onnx()));
        registry.register_adapter(Box::new(FakeAdapter::for_family(
            RuntimeId::WhisperCpp,
            ModelFamilyId::Whisper,
        )));
        registry.register_adapter(Box::new(FakeAdapter::for_family(
            RuntimeId::OnnxRuntime,
            ModelFamilyId::Moonshine,
        )));
        registry.register_adapter(Box::new(FakeAdapter::for_family(
            RuntimeId::OnnxRuntime,
            ModelFamilyId::CohereTranscribe,
        )));
        registry.register_adapter(Box::new(FakeAdapter::for_family(
            RuntimeId::OnnxRuntime,
            ModelFamilyId::NemotronAsr,
        )));
        Arc::new(registry)
    }

    fn test_app() -> AppState {
        test_app_with_registry(fake_registry())
    }

    #[test]
    fn start_synthesis_rejects_a_dictation_catalog_model_with_a_typed_error() {
        let (_, events) = test_app().handle_command(Command::StartSynthesis {
            synthesis_id: 42,
            model_selection: SelectedModel::CatalogModel {
                runtime_id: RuntimeId::WhisperCpp,
                family_id: ModelFamilyId::Whisper,
                model_id: "small".to_string(),
            },
            voice_id: "alba".to_string(),
            language: "en".to_string(),
            speed: 1.0,
            chunks: vec![SynthesisTextChunk {
                text: "Hello.".to_string(),
                source_range: SourceRange { from: 0, to: 6 },
            }],
            model_store_path_override: None,
        });

        assert!(matches!(
            events.as_slice(),
            [Event::SynthesisError { synthesis_id: 42, code, .. }]
                if code == "invalid_synthesis_request"
        ));
    }

    fn test_app_with_registry(registry: Arc<EngineRegistry>) -> AppState {
        AppState::with_registry("0.1.0", sample_catalog(), registry, ListeningSession::new)
    }

    /// Polls the real worker thread's event channel via `drain_worker_events`
    /// until it yields at least one event or the timeout elapses. Needed for
    /// tests that exercise the actual worker thread (rather than injecting a
    /// synthetic `WorkerEvent` directly) since `BeginSession` is fire-and-
    /// forget across a channel.
    fn wait_for_worker_events(app: &mut AppState) -> Vec<Event> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let events = app.drain_worker_events();
            if !events.is_empty() || Instant::now() >= deadline {
                return events;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn test_app_with_system_audio(system_audio: FakeSystemAudioState) -> AppState {
        AppState::with_system_audio(
            "0.1.0",
            sample_catalog(),
            fake_registry(),
            ListeningSession::new,
            Box::new(FakeSystemAudio::new(system_audio)),
        )
    }

    #[derive(Clone, Default)]
    struct FakeSystemAudioState {
        sink: Arc<Mutex<Option<AudioFrameSink>>>,
        start_error: Arc<Mutex<Option<SystemAudioError>>>,
        starts: Arc<Mutex<Vec<String>>>,
        stops: Arc<Mutex<Vec<String>>>,
    }

    impl FakeSystemAudioState {
        fn fail_start(&self, error: SystemAudioError) {
            *self.start_error.lock().expect("start error lock") = Some(error);
        }

        fn emit(&self, frame: AudioFrame) {
            let sink = self
                .sink
                .lock()
                .expect("sink lock")
                .clone()
                .expect("system-audio sink should be installed");
            sink(frame);
        }

        fn starts(&self) -> Vec<String> {
            self.starts.lock().expect("starts lock").clone()
        }

        fn stops(&self) -> Vec<String> {
            self.stops.lock().expect("stops lock").clone()
        }
    }

    struct FakeSystemAudio {
        state: FakeSystemAudioState,
    }

    impl FakeSystemAudio {
        fn new(state: FakeSystemAudioState) -> Self {
            Self { state }
        }
    }

    impl SystemAudioCapture for FakeSystemAudio {
        fn set_sink(&mut self, sink: AudioFrameSink) {
            *self.state.sink.lock().expect("sink lock") = Some(sink);
        }

        fn start(&mut self, session_id: String) -> Result<(), SystemAudioError> {
            self.state
                .starts
                .lock()
                .expect("starts lock")
                .push(session_id);
            if let Some(error) = self
                .state
                .start_error
                .lock()
                .expect("start error lock")
                .take()
            {
                return Err(error);
            }
            Ok(())
        }

        fn stop(&mut self, session_id: &str) {
            self.state
                .stops
                .lock()
                .expect("stops lock")
                .push(session_id.to_owned());
        }
    }

    #[test]
    fn health_returns_ready_event() {
        let (control_flow, events) = test_app().handle_command(Command::Health);

        assert_eq!(control_flow, ControlFlow::Continue);
        assert_eq!(
            events,
            vec![Event::HealthOk {
                sidecar_version: "0.1.0".to_string(),
                status: HealthStatus::Ready,
            }]
        );
    }

    #[test]
    fn get_system_info_returns_compiled_runtimes_and_adapters() {
        let mut app = AppState::with_registry(
            "0.1.0",
            sample_catalog(),
            fake_registry_with_all_engines(),
            ListeningSession::new,
        );
        let (control_flow, events) = app.handle_command(Command::GetSystemInfo);

        assert_eq!(control_flow, ControlFlow::Continue);
        assert_eq!(events.len(), 1);
        match &events[0] {
            Event::SystemInfo {
                sidecar_version,
                compiled_runtimes,
                compiled_adapters,
                system_info: _,
            } => {
                assert_eq!(sidecar_version, "0.1.0");
                assert_eq!(
                    compiled_runtimes
                        .iter()
                        .map(|runtime| runtime.runtime_id)
                        .collect::<Vec<_>>(),
                    vec![RuntimeId::OnnxRuntime, RuntimeId::WhisperCpp]
                );
                assert_eq!(
                    compiled_adapters
                        .iter()
                        .map(|adapter| (adapter.runtime_id, adapter.family_id))
                        .collect::<Vec<_>>(),
                    vec![
                        (RuntimeId::OnnxRuntime, ModelFamilyId::CohereTranscribe),
                        (RuntimeId::OnnxRuntime, ModelFamilyId::Moonshine),
                        (RuntimeId::OnnxRuntime, ModelFamilyId::NemotronAsr),
                        (RuntimeId::WhisperCpp, ModelFamilyId::Whisper),
                    ]
                );
            }
            other => panic!("expected SystemInfo event, got {other:?}"),
        }
    }

    #[test]
    fn start_session_returns_started_and_state_events() {
        let model_file_path = create_model_file();
        let (_, events) =
            test_app().handle_command(start_session_command("session-1", &model_file_path));

        assert_eq!(
            events,
            vec![
                Event::SessionStarted {
                    mode: ListeningMode::AlwaysOn,
                    session_id: "session-1".to_string(),
                },
                Event::SessionStateChanged {
                    session_id: "session-1".to_string(),
                    state: SessionState::Listening,
                },
            ]
        );
    }

    #[test]
    fn system_audio_session_starts_capture_and_stops_with_session() {
        let model_file_path = create_model_file();
        let system_audio = FakeSystemAudioState::default();
        let mut app = test_app_with_system_audio(system_audio.clone());

        let (_, start_events) = app.handle_command(start_session_command_with_system_audio(
            "session-1",
            &model_file_path,
            true,
        ));

        assert!(start_events.contains(&Event::SessionStarted {
            mode: ListeningMode::AlwaysOn,
            session_id: "session-1".to_string(),
        }));
        assert_eq!(system_audio.starts(), vec!["session-1"]);
        assert!(system_audio.stops().is_empty());

        let (_, stop_events) = app.handle_command(Command::StopSession {
            session_id: "session-1".to_string(),
        });

        assert_eq!(
            stop_events,
            vec![Event::SessionStopped {
                reason: SessionStopReason::UserStop,
                session_id: "session-1".to_string(),
            }]
        );
        assert_eq!(system_audio.stops(), vec!["session-1"]);
    }

    #[test]
    fn microphone_only_session_does_not_start_system_audio_capture() {
        let model_file_path = create_model_file();
        let system_audio = FakeSystemAudioState::default();
        let mut app = test_app_with_system_audio(system_audio.clone());

        let (_, start_events) =
            app.handle_command(start_session_command("session-1", &model_file_path));

        assert!(start_events.contains(&Event::SessionStarted {
            mode: ListeningMode::AlwaysOn,
            session_id: "session-1".to_string(),
        }));
        assert!(
            system_audio.starts().is_empty(),
            "microphone-only sessions must not open loopback capture"
        );
    }

    #[test]
    fn system_audio_start_failure_reports_error_without_announcing_session() {
        let model_file_path = create_model_file();
        let system_audio = FakeSystemAudioState::default();
        system_audio.fail_start(SystemAudioError::Capture("device unavailable".to_string()));
        let mut app = test_app_with_system_audio(system_audio.clone());

        let (_, events) = app.handle_command(start_session_command_with_system_audio(
            "session-1",
            &model_file_path,
            true,
        ));

        assert_eq!(
            events,
            vec![Event::Error {
                code: "system_audio_capture_failed".to_string(),
                details: None,
                message: "Could not start system-audio capture: device unavailable".to_string(),
                session_id: Some("session-1".to_string()),
            }]
        );
        assert_eq!(system_audio.starts(), vec!["session-1"]);
        assert_eq!(system_audio.stops(), vec!["session-1"]);
        assert!(
            !app.active_sessions.contains_key("session-1"),
            "failed system-audio start must tear down the partially-created session"
        );
    }

    #[test]
    fn system_audio_permission_denied_reports_permission_code() {
        let model_file_path = create_model_file();
        let system_audio = FakeSystemAudioState::default();
        system_audio.fail_start(SystemAudioError::PermissionDenied);
        let mut app = test_app_with_system_audio(system_audio.clone());

        let (_, events) = app.handle_command(start_session_command_with_system_audio(
            "session-1",
            &model_file_path,
            true,
        ));

        assert_eq!(
            events,
            vec![Event::Error {
                code: "system_audio_permission_denied".to_string(),
                details: None,
                message: "System-audio recording permission is off for Obsidian. Open System Settings → Privacy & Security → Screen & System Audio Recording, enable Obsidian, and try again.".to_string(),
                session_id: Some("session-1".to_string()),
            }]
        );
        assert_eq!(system_audio.starts(), vec!["session-1"]);
        assert_eq!(system_audio.stops(), vec!["session-1"]);
    }

    #[test]
    fn system_audio_sink_frames_queue_until_microphone_tick() {
        let model_file_path = create_model_file();
        let system_audio = FakeSystemAudioState::default();
        let mut app = test_app_with_system_audio(system_audio.clone());
        let (tx, rx) = std::sync::mpsc::channel();
        app.set_system_audio_sink(Arc::new(move |frame| {
            tx.send(frame).expect("test receiver should stay open");
        }));
        let _ = app.handle_command(start_session_command_with_system_audio(
            "session-1",
            &model_file_path,
            true,
        ));

        system_audio.emit(AudioFrame {
            frame_bytes: vec![0_u8; PCM_BYTES_PER_FRAME],
            session_id: "session-1".to_string(),
        });
        let frame = rx
            .recv_timeout(Duration::from_millis(100))
            .expect("system-audio sink should receive frame");
        let system_events = app.handle_system_audio_frame(frame);

        assert!(
            system_events.is_empty(),
            "system audio must not advance the transcription timeline by itself"
        );

        let mic_events = app.handle_audio_frame(AudioFrame {
            frame_bytes: vec![0_u8; PCM_BYTES_PER_FRAME],
            session_id: "session-1".to_string(),
        });

        assert!(matches!(
            mic_events.first(),
            Some(Event::AudioLevel {
                session_id,
                ..
            }) if session_id == "session-1"
        ));
    }

    #[test]
    fn start_session_rejects_missing_model() {
        let missing = temp_dir().join("definitely-missing-model.bin");
        let (_, events) = test_app().handle_command(start_session_command("session-1", &missing));

        assert!(
            matches!(events.first(), Some(Event::Error { code, .. }) if code == "missing_model_file")
        );
    }

    #[test]
    fn start_session_rejects_a_tts_model_before_starting_a_worker_session() {
        let model_file_path = create_model_file();
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::onnx()));
        registry.register_adapter(Box::new(FakeAdapter::tts()));
        let mut command = start_session_command("session-1", &model_file_path);
        let Command::StartSession {
            model_selection, ..
        } = &mut command
        else {
            panic!("expected start session command");
        };
        *model_selection = SelectedModel::ExternalFile {
            runtime_id: RuntimeId::OnnxRuntime,
            family_id: ModelFamilyId::PocketTts,
            file_path: model_file_path.display().to_string(),
        };

        let (_, events) = test_app_with_registry(Arc::new(registry)).handle_command(command);

        assert!(matches!(
            events.as_slice(),
            [Event::Error { code, .. }] if code == "invalid_model_task"
        ));
    }

    #[test]
    fn start_session_rejects_language_unsupported_by_the_exact_model() {
        let model_file_path = create_model_file();
        let mut command = start_session_command("session-1", &model_file_path);
        let Command::StartSession { language, .. } = &mut command else {
            panic!("expected start session command");
        };
        *language = "ja".to_string();

        let (_, events) = test_app().handle_command(command);

        assert!(matches!(
            events.first(),
            Some(Event::Error { code, details, .. })
                if code == "unsupported_language"
                    && details.as_deref().is_some_and(|value| {
                        value.contains("selected=ja") && value.contains("supported=en")
                    })
        ));
    }

    #[test]
    fn start_session_rejects_zero_max_speakers() {
        let model_file_path = create_model_file();
        let mut command = start_session_command("session-1", &model_file_path);
        let Command::StartSession {
            diarization_max_speakers,
            ..
        } = &mut command
        else {
            panic!("expected start session command");
        };
        *diarization_max_speakers = Some(0);

        let (_, events) = test_app().handle_command(command);

        assert!(matches!(
            events.first(),
            Some(Event::Error { code, .. }) if code == "invalid_diarization_speaker_limit"
        ));
    }

    #[test]
    fn probe_model_selection_reports_missing_managed_model() {
        let (_, events) = test_app().handle_command(Command::ProbeModelSelection {
            model_selection: SelectedModel::CatalogModel {
                runtime_id: RuntimeId::WhisperCpp,
                family_id: ModelFamilyId::Whisper,
                model_id: "small".to_string(),
            },
            model_store_path_override: Some(
                temp_dir().join("missing-model-store").display().to_string(),
            ),
        });

        match events.first() {
            Some(Event::ModelProbeResult {
                status,
                merged_capabilities,
                ..
            }) => {
                assert_eq!(*status, ModelProbeStatus::Missing);
                assert!(
                    merged_capabilities.is_none(),
                    "missing probes must not carry merged capabilities"
                );
            }
            other => panic!("expected missing ModelProbeResult, got {other:?}"),
        }
    }

    #[test]
    fn probe_model_selection_reports_ready_with_merged_capabilities() {
        let model_file_path = create_model_file();
        let (_, events) = test_app().handle_command(Command::ProbeModelSelection {
            model_selection: SelectedModel::ExternalFile {
                runtime_id: RuntimeId::WhisperCpp,
                family_id: ModelFamilyId::Whisper,
                file_path: model_file_path.display().to_string(),
            },
            model_store_path_override: None,
        });

        match events.first() {
            Some(Event::ModelProbeResult {
                status,
                merged_capabilities,
                ..
            }) => {
                assert_eq!(*status, ModelProbeStatus::Ready);
                let caps = merged_capabilities
                    .as_ref()
                    .expect("ready probes must carry merged capabilities");
                assert_eq!(caps.runtime_id, RuntimeId::WhisperCpp);
                assert_eq!(caps.family_id, ModelFamilyId::Whisper);
                assert!(caps.family.supports_initial_prompt);
                assert!(
                    caps.runtime
                        .available_accelerators
                        .contains(&AcceleratorId::Cpu)
                );
            }
            other => panic!("expected ready ModelProbeResult, got {other:?}"),
        }
    }

    #[test]
    fn probe_downgrades_language_capabilities_to_the_exact_model() {
        let mut registry = EngineRegistry::default();
        registry.register_runtime(Box::new(FakeRuntime::cpu_only()));
        registry.register_adapter(Box::new(
            FakeAdapter::multilingual_family_with_english_only_model(),
        ));
        let model_file_path = create_model_file();
        let (_, events) = test_app_with_registry(Arc::new(registry)).handle_command(
            Command::ProbeModelSelection {
                model_selection: SelectedModel::ExternalFile {
                    runtime_id: RuntimeId::WhisperCpp,
                    family_id: ModelFamilyId::Whisper,
                    file_path: model_file_path.display().to_string(),
                },
                model_store_path_override: None,
            },
        );

        match events.first() {
            Some(Event::ModelProbeResult {
                status,
                merged_capabilities,
                ..
            }) => {
                assert_eq!(*status, ModelProbeStatus::Ready);
                let caps = merged_capabilities
                    .as_ref()
                    .expect("ready probes must carry merged capabilities");
                assert_eq!(
                    caps.family.supported_languages,
                    LanguageSupport::EnglishOnly
                );
                assert!(!caps.family.supports_language_selection);
                assert!(
                    !caps.family.supports_automatic_language_detection,
                    "English-only weights must not advertise the family's automatic detection"
                );
            }
            other => panic!("expected ready ModelProbeResult, got {other:?}"),
        }
    }

    #[test]
    fn probe_model_selection_reports_invalid_without_capabilities() {
        let (_, events) = test_app().handle_command(Command::ProbeModelSelection {
            model_selection: SelectedModel::ExternalFile {
                runtime_id: RuntimeId::WhisperCpp,
                family_id: ModelFamilyId::Whisper,
                file_path: "relative/path.bin".to_string(),
            },
            model_store_path_override: None,
        });

        match events.first() {
            Some(Event::ModelProbeResult {
                status,
                merged_capabilities,
                ..
            }) => {
                assert_eq!(*status, ModelProbeStatus::Invalid);
                assert!(
                    merged_capabilities.is_none(),
                    "invalid probes must not carry merged capabilities"
                );
            }
            other => panic!("expected invalid ModelProbeResult, got {other:?}"),
        }
    }

    #[test]
    fn auto_acceleration_uses_available_gpu_accelerator() {
        assert!(super::resolve_use_gpu(
            RuntimeId::WhisperCpp,
            ModelFamilyId::Whisper,
            AccelerationPreference::Auto,
            fake_registry_with_cuda().as_ref(),
        ));
    }

    #[test]
    fn auto_acceleration_skips_when_only_cpu_available() {
        assert!(!super::resolve_use_gpu(
            RuntimeId::WhisperCpp,
            ModelFamilyId::Whisper,
            AccelerationPreference::Auto,
            fake_registry().as_ref(),
        ));
    }

    #[test]
    fn auto_acceleration_skips_when_family_cannot_use_hardware_acceleration() {
        assert!(!super::resolve_use_gpu(
            RuntimeId::WhisperCpp,
            ModelFamilyId::Whisper,
            AccelerationPreference::Auto,
            fake_registry_with_cuda_and_cpu_only_adapter().as_ref(),
        ));
    }

    #[test]
    fn cpu_only_acceleration_disables_gpu_even_when_available() {
        assert!(!super::resolve_use_gpu(
            RuntimeId::WhisperCpp,
            ModelFamilyId::Whisper,
            AccelerationPreference::CpuOnly,
            fake_registry_with_cuda().as_ref(),
        ));
    }

    #[test]
    fn starting_a_second_session_keeps_the_first_session_active() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let (_, events) = app.handle_command(start_session_command("session-2", &model_file_path));

        assert!(events.contains(&Event::SessionStarted {
            mode: ListeningMode::AlwaysOn,
            session_id: "session-2".to_string(),
        }));
        assert!(app.active_sessions.contains_key("session-1"));
        assert!(app.active_sessions.contains_key("session-2"));
    }

    #[test]
    fn start_session_enforces_five_session_capacity() {
        let model_file_path = create_model_file();
        let mut app = test_app();

        for index in 0..5 {
            let _ = app.handle_command(start_session_command(
                &format!("session-{index}"),
                &model_file_path,
            ));
        }

        let (_, events) =
            app.handle_command(start_session_command("session-overflow", &model_file_path));

        assert!(matches!(
            events.first(),
            Some(Event::Error {
                code,
                session_id: Some(session_id),
                ..
            }) if code == "session_capacity_exceeded" && session_id == "session-overflow"
        ));
        assert!(!app.active_sessions.contains_key("session-overflow"));
    }

    #[test]
    fn stop_session_emits_stopped_event() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let (_, events) = app.handle_command(Command::StopSession {
            session_id: "session-1".to_string(),
        });

        assert_eq!(
            events,
            vec![Event::SessionStopped {
                reason: SessionStopReason::UserStop,
                session_id: "session-1".to_string(),
            }]
        );
    }

    #[test]
    fn start_session_surfaces_vad_initialization_failure() {
        let model_file_path = create_model_file();
        let mut app = AppState::with_registry("0.1.0", sample_catalog(), fake_registry(), |_| {
            Err(SessionInitError::VadLoad(
                "model bootstrap failed".to_string(),
            ))
        });

        let (_, events) = app.handle_command(start_session_command("session-1", &model_file_path));

        assert_eq!(
            events,
            vec![Event::Error {
                code: "vad_init_failed".to_string(),
                details: Some("model bootstrap failed".to_string()),
                message: "Failed to initialize the bundled Silero VAD.".to_string(),
                session_id: None,
            }]
        );
    }

    #[test]
    fn enqueue_utterance_emits_context_request_and_records_pending_entry() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);

        assert_eq!(events.len(), 1, "expected exactly one ContextRequest event");
        let (correlation_id, utterance_id) = match &events[0] {
            Event::ContextRequest {
                budget_chars,
                correlation_id,
                session_id,
                utterance_id,
            } => {
                assert_eq!(*budget_chars, 224);
                assert_eq!(session_id, "session-1");
                (*correlation_id, *utterance_id)
            }
            other => panic!("expected ContextRequest, got {other:?}"),
        };

        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session should still be present after enqueue");
        assert_eq!(active.pending_context_requests.len(), 1);
        let pending = &active.pending_context_requests[0];
        assert_eq!(pending.correlation_id, correlation_id);
        assert_eq!(pending.utterance_id, utterance_id);
        assert_eq!(pending.session_id, "session-1");
        assert_eq!(pending.utterance.duration_ms(), 1000);
        assert!(active.transcription_active);
    }

    #[test]
    fn enqueue_utterance_dispatches_immediately_when_context_is_not_supported() {
        let model_file_path = create_model_file();
        let mut app = AppState::with_registry(
            "0.1.0",
            sample_catalog(),
            fake_registry_without_context_support(),
            ListeningSession::new,
        );
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);

        assert!(events.is_empty(), "no context_request should be emitted");
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert!(active.pending_context_requests.is_empty());
        assert!(active.transcription_active);
    }

    #[test]
    fn over_budget_context_response_dispatches_none() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);
        let correlation_id = match &events[0] {
            Event::ContextRequest { correlation_id, .. } => *correlation_id,
            other => panic!("expected ContextRequest, got {other:?}"),
        };

        let context_window = ContextWindow {
            budget_chars: 224,
            sources: vec![ContextWindowSource::NoteGlossary {
                text: "x".repeat(225),
                truncated: true,
            }],
            text: "x".repeat(225),
            truncated: true,
        };
        let (_control_flow, response_events) = app.handle_command(Command::ContextResponse {
            correlation_id,
            context: Some(context_window),
        });

        assert!(response_events.is_empty());
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert!(active.pending_context_requests.is_empty());
    }

    #[test]
    fn initial_prompt_context_is_limited_to_manually_selected_english() {
        assert!(should_request_initial_prompt(true, "en"));
        assert!(!should_request_initial_prompt(false, "en"));
        assert!(!should_request_initial_prompt(true, "auto"));
        assert!(!should_request_initial_prompt(true, "ja"));
    }

    #[test]
    fn context_response_with_window_clears_pending_request() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);
        let correlation_id = match &events[0] {
            Event::ContextRequest { correlation_id, .. } => *correlation_id,
            other => panic!("expected ContextRequest, got {other:?}"),
        };

        let context_window = ContextWindow {
            budget_chars: 224,
            sources: vec![ContextWindowSource::NoteGlossary {
                text: "previous note text".to_string(),
                truncated: false,
            }],
            text: "previous note text".to_string(),
            truncated: false,
        };
        let (control_flow, response_events) = app.handle_command(Command::ContextResponse {
            correlation_id,
            context: Some(context_window),
        });

        assert_eq!(control_flow, ControlFlow::Continue);
        assert!(
            response_events.is_empty(),
            "ContextResponse should dispatch silently on success: {response_events:?}"
        );
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert!(active.pending_context_requests.is_empty());
    }

    #[test]
    fn context_response_with_null_window_clears_pending_request() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);
        let correlation_id = match &events[0] {
            Event::ContextRequest { correlation_id, .. } => *correlation_id,
            other => panic!("expected ContextRequest, got {other:?}"),
        };

        let (control_flow, response_events) = app.handle_command(Command::ContextResponse {
            correlation_id,
            context: None,
        });

        assert_eq!(control_flow, ControlFlow::Continue);
        assert!(response_events.is_empty());
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert!(active.pending_context_requests.is_empty());
    }

    #[test]
    fn context_response_with_unknown_correlation_id_is_a_no_op() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);

        let (control_flow, response_events) = app.handle_command(Command::ContextResponse {
            correlation_id: Uuid::new_v4(),
            context: None,
        });

        assert_eq!(control_flow, ControlFlow::Continue);
        assert!(response_events.is_empty());
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert_eq!(active.pending_context_requests.len(), 1);
    }

    #[test]
    fn tick_dispatches_pending_requests_past_their_deadline() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);

        if let Some(active) = app.active_sessions.get_mut("session-1") {
            for pending in active.pending_context_requests.iter_mut() {
                pending.deadline = Instant::now() - Duration::from_millis(1);
            }
        }

        let tick_events = app.tick();
        assert!(
            tick_events.is_empty(),
            "tick should dispatch silently on the timeout path: {tick_events:?}"
        );
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert!(active.pending_context_requests.is_empty());
    }

    #[test]
    fn tick_leaves_pending_requests_in_place_before_their_deadline() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);

        let tick_events = app.tick();
        assert!(tick_events.is_empty());
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert_eq!(active.pending_context_requests.len(), 1);
    }

    #[test]
    fn queue_backpressure_tier_maps_depths_to_tiers() {
        assert_eq!(
            super::queue_backpressure_tier(0),
            QueueBackpressureTier::Normal
        );
        assert_eq!(
            super::queue_backpressure_tier(2),
            QueueBackpressureTier::Normal
        );
        assert_eq!(
            super::queue_backpressure_tier(3),
            QueueBackpressureTier::CatchingUp
        );
        assert_eq!(
            super::queue_backpressure_tier(9),
            QueueBackpressureTier::CatchingUp
        );
        assert_eq!(
            super::queue_backpressure_tier(10),
            QueueBackpressureTier::FallingBehind
        );
        assert_eq!(
            super::queue_backpressure_tier(29),
            QueueBackpressureTier::FallingBehind
        );
        assert_eq!(
            super::queue_backpressure_tier(30),
            QueueBackpressureTier::Saturated
        );
        assert_eq!(
            super::queue_backpressure_tier(99),
            QueueBackpressureTier::Saturated
        );
    }

    fn count_tier_events(events: &[Event], tier: QueueBackpressureTier) -> usize {
        events
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    Event::TranscriptionQueueChanged { tier: t, .. } if *t == tier
                )
            })
            .count()
    }

    fn enqueue_n_utterances(app: &mut AppState, n: usize) -> Vec<Event> {
        let mut events = Vec::new();
        for _ in 0..n {
            app.enqueue_utterance("session-1", fake_utterance(), &mut events);
        }
        events
    }

    #[test]
    fn enqueue_below_catching_up_threshold_emits_no_tier_events() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let events = enqueue_n_utterances(&mut app, 3);

        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, Event::TranscriptionQueueChanged { .. }))
                .count(),
            0,
            "no tier events expected while remaining in normal: {events:?}"
        );
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert_eq!(active.queued_utterances, 2);
        assert!(active.transcription_active);
    }

    #[test]
    fn enqueue_emits_catching_up_when_queue_reaches_three() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let events = enqueue_n_utterances(&mut app, 4);

        assert_eq!(
            count_tier_events(&events, QueueBackpressureTier::CatchingUp),
            1
        );
        let last_tier = events
            .iter()
            .rev()
            .find_map(|event| match event {
                Event::TranscriptionQueueChanged {
                    tier,
                    queued_utterances,
                    ..
                } => Some((*tier, *queued_utterances)),
                _ => None,
            })
            .expect("expected a tier event");
        assert_eq!(last_tier, (QueueBackpressureTier::CatchingUp, 3));
    }

    #[test]
    fn enqueue_emits_falling_behind_at_depth_ten_only_once() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let events = enqueue_n_utterances(&mut app, 11);

        assert_eq!(
            count_tier_events(&events, QueueBackpressureTier::CatchingUp),
            1
        );
        assert_eq!(
            count_tier_events(&events, QueueBackpressureTier::FallingBehind),
            1
        );
    }

    #[test]
    fn enqueue_at_saturation_accepts_and_enters_overload_drain() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let events = enqueue_n_utterances(&mut app, 31);

        assert_eq!(
            count_tier_events(&events, QueueBackpressureTier::Saturated),
            1
        );

        let overload_errors = events
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    Event::Error { code, .. } if code == "utterance_queue_overload"
                )
            })
            .count();
        assert_eq!(overload_errors, 1, "exactly one overload error expected");

        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert!(active.overload_draining);
        assert_eq!(active.queued_utterances, 30);
        assert_eq!(
            active.pending_context_requests.len(),
            31,
            "all accepted utterances should still be tracked through their context flow"
        );
    }

    #[test]
    fn streaming_enqueue_escalates_tiers_and_enters_overload_drain() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));
        app.active_sessions
            .get_mut("session-1")
            .expect("active session")
            .streaming = true;

        let mut events = enqueue_n_utterances(&mut app, 31);

        assert_eq!(
            events
                .iter()
                .filter_map(|event| match event {
                    Event::TranscriptionQueueChanged { tier, .. } => Some(*tier),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            vec![
                QueueBackpressureTier::CatchingUp,
                QueueBackpressureTier::FallingBehind,
                QueueBackpressureTier::Saturated,
            ]
        );
        assert!(events.iter().any(
            |event| matches!(event, Event::Error { code, .. } if code == "utterance_queue_overload")
        ));
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert!(active.overload_draining);
        assert_eq!(active.queued_utterances, super::QUEUE_OVERLOAD_DEPTH);

        // Drain the active transcription plus every queued utterance.
        for _ in 0..=super::QUEUE_OVERLOAD_DEPTH {
            app.handle_worker_event(fake_worker_transcript_ready("session-1", None), &mut events);
        }
        assert!(events.iter().any(|event| matches!(
            event,
            Event::SessionStopped {
                reason: SessionStopReason::QueueOverload,
                ..
            }
        )));
        assert!(!app.active_sessions.contains_key("session-1"));
    }

    #[test]
    fn partial_worker_error_is_recoverable_and_a_later_final_still_lands() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));
        let mut events = Vec::new();

        app.handle_worker_event(
            WorkerEvent::SessionError {
                code: "engine_inference_failed".to_string(),
                details: Some("transient partial decode".to_string()),
                finalizes_utterance: false,
                message: "Partial decode failed.".to_string(),
                session_id: "session-1".to_string(),
                utterance_id: Some(Uuid::new_v4()),
            },
            &mut events,
        );

        assert!(matches!(
            events.as_slice(),
            [Event::Warning { code, .. }] if code == "engine_inference_failed"
        ));
        assert!(app.active_sessions.contains_key("session-1"));

        app.handle_worker_event(fake_worker_transcript_ready("session-1", None), &mut events);
        assert!(events.iter().any(
            |event| matches!(event, Event::TranscriptReady { session_id, .. } if session_id == "session-1")
        ));
    }

    /// Regression test for issue #194 finding 2: a `SessionError` with no
    /// `utterance_id` is session-scoped (today, only `BeginSession` failing
    /// or panicking before the worker inserts its session record reaches
    /// this path), so the app must tear the session down rather than leaving
    /// a session that looks active to the host while the worker silently
    /// ignores every future command for it.
    #[test]
    fn session_scoped_worker_error_tears_down_the_active_session() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));
        assert!(app.active_sessions.contains_key("session-1"));
        let mut events = Vec::new();

        app.handle_worker_event(
            WorkerEvent::SessionError {
                code: "invalid_model_file".to_string(),
                details: Some("fake model load failure".to_string()),
                finalizes_utterance: false,
                message: "Model file is missing, unreadable, or unsupported.".to_string(),
                session_id: "session-1".to_string(),
                utterance_id: None,
            },
            &mut events,
        );

        assert!(
            events.iter().any(
                |event| matches!(event, Event::Error { code, session_id, .. } if code == "invalid_model_file" && session_id.as_deref() == Some("session-1"))
            ),
            "expected an Error event, got: {events:?}"
        );
        assert!(
            matches!(
                events.iter().find(|event| matches!(event, Event::SessionStopped { .. })),
                Some(Event::SessionStopped {
                    reason: SessionStopReason::SessionError,
                    session_id,
                }) if session_id == "session-1"
            ),
            "expected SessionStopped{{SessionError}} so the host sees the session end, got: {events:?}"
        );
        assert!(
            !app.active_sessions.contains_key("session-1"),
            "a session-scoped worker error must remove the zombie app-level session"
        );
    }

    /// A session-scoped worker error can race with a user-initiated stop/
    /// cancel that already tore the session down. The event must still
    /// surface (so the host sees the underlying failure) without emitting a
    /// second, spurious `SessionStopped` for a session that is already gone.
    #[test]
    fn session_scoped_worker_error_after_session_already_gone_emits_only_error() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));
        let _ = app.handle_command(Command::CancelSession {
            session_id: "session-1".to_string(),
        });
        assert!(!app.active_sessions.contains_key("session-1"));
        let mut events = Vec::new();

        app.handle_worker_event(
            WorkerEvent::SessionError {
                code: "worker_panic".to_string(),
                details: None,
                finalizes_utterance: false,
                message: "Worker thread panicked loading model".to_string(),
                session_id: "session-1".to_string(),
                utterance_id: None,
            },
            &mut events,
        );

        assert!(matches!(
            events.as_slice(),
            [Event::Error { code, .. }] if code == "worker_panic"
        ));
    }

    /// End-to-end version of `session_scoped_worker_error_tears_down_the_
    /// active_session`, driven through the real (spawned-thread) worker with
    /// a `FakeAdapter` whose `probe_model` succeeds but `load` fails. This
    /// exercises the production `BeginSession` -> `load_session_resources`
    /// path in worker.rs, not just the app-side event handling.
    #[test]
    fn start_session_tears_down_when_worker_model_load_fails() {
        let model_file_path = create_model_file();
        let mut app = test_app_with_registry(fake_registry_with_failing_load());
        let (_, start_events) =
            app.handle_command(start_session_command("session-1", &model_file_path));
        assert!(
            start_events
                .iter()
                .any(|event| matches!(event, Event::SessionStarted { .. })),
            "StartSession is fire-and-forget and must optimistically report started"
        );
        assert!(app.active_sessions.contains_key("session-1"));

        let events = wait_for_worker_events(&mut app);

        assert!(
            events.iter().any(
                |event| matches!(event, Event::Error { code, .. } if code == "invalid_model_file")
            ),
            "expected the load failure to surface as an Error event, got: {events:?}"
        );
        assert!(
            matches!(
                events.iter().find(|event| matches!(event, Event::SessionStopped { .. })),
                Some(Event::SessionStopped {
                    reason: SessionStopReason::SessionError,
                    session_id,
                }) if session_id == "session-1"
            ),
            "expected SessionStopped{{SessionError}}, got: {events:?}"
        );
        assert!(
            !app.active_sessions.contains_key("session-1"),
            "a worker model-load failure must not leave a zombie app-level session"
        );
    }

    /// Same as `start_session_tears_down_when_worker_model_load_fails`, but
    /// the worker thread panics inside `load()` instead of returning `Err`.
    /// `worker_main` catches the panic with `catch_unwind`, so the worker
    /// thread survives and still reports the failure through the normal
    /// `SessionError` path.
    #[test]
    fn start_session_tears_down_when_worker_model_load_panics() {
        let model_file_path = create_model_file();
        let mut app = test_app_with_registry(fake_registry_with_panicking_load());
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));
        assert!(app.active_sessions.contains_key("session-1"));

        let events = wait_for_worker_events(&mut app);

        assert!(
            events
                .iter()
                .any(|event| matches!(event, Event::Error { code, .. } if code == "worker_panic")),
            "expected the load panic to surface as an Error event, got: {events:?}"
        );
        assert!(
            matches!(
                events.iter().find(|event| matches!(event, Event::SessionStopped { .. })),
                Some(Event::SessionStopped {
                    reason: SessionStopReason::SessionError,
                    session_id,
                }) if session_id == "session-1"
            ),
            "expected SessionStopped{{SessionError}}, got: {events:?}"
        );
        assert!(
            !app.active_sessions.contains_key("session-1"),
            "a worker model-load panic must not leave a zombie app-level session"
        );
    }

    #[test]
    fn shutdown_hard_cancels_sessions_and_ignores_late_worker_output() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));
        let _ = enqueue_n_utterances(&mut app, 1);

        let (control_flow, shutdown_events) = app.handle_command(Command::Shutdown);
        assert_eq!(control_flow, ControlFlow::Shutdown);
        assert!(
            shutdown_events.is_empty(),
            "shutdown is a hard cancel and must not emit graceful stop events"
        );
        assert!(
            !app.active_sessions.contains_key("session-1"),
            "shutdown must drop active sessions immediately"
        );

        let mut late_events = Vec::new();
        app.handle_worker_event(
            fake_worker_transcript_ready("session-1", None),
            &mut late_events,
        );

        assert!(
            late_events.is_empty(),
            "late worker output after shutdown must be ignored"
        );
    }

    #[test]
    fn enqueue_during_overload_drain_drops_with_warning() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let _ = enqueue_n_utterances(&mut app, 31);

        let mut events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut events);

        assert!(events.iter().any(|event| matches!(
            event,
            Event::Warning { code, .. } if code == "utterance_dropped_during_overload_drain"
        )));
        let active = app
            .active_sessions
            .get("session-1")
            .expect("active session");
        assert_eq!(
            active.queued_utterances, 30,
            "overflow utterance must not bump depth"
        );
        assert_eq!(active.pending_context_requests.len(), 31);
    }

    #[test]
    fn stop_with_queued_utterances_defers_session_stopped_until_drain() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let _ = enqueue_n_utterances(&mut app, 3);

        let (_, events) = app.handle_command(Command::StopSession {
            session_id: "session-1".to_string(),
        });

        assert!(
            !events
                .iter()
                .any(|event| matches!(event, Event::SessionStopped { .. })),
            "graceful stop must defer SessionStopped until the queue drains: {events:?}"
        );
        let active = app
            .active_sessions
            .get("session-1")
            .expect("session should still exist while draining");
        assert!(active.draining, "graceful_stop must set draining=true");
        assert!(active.transcription_active);
        assert_eq!(active.queued_utterances, 2);
    }

    #[test]
    fn drain_completes_via_transcript_ready_with_user_stop_reason() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let _ = enqueue_n_utterances(&mut app, 3);
        let _ = app.handle_command(Command::StopSession {
            session_id: "session-1".to_string(),
        });

        let mut events = Vec::new();
        for _ in 0..3 {
            app.handle_worker_event(fake_worker_transcript_ready("session-1", None), &mut events);
        }

        let stop = events
            .iter()
            .find(|event| matches!(event, Event::SessionStopped { .. }));
        assert!(
            matches!(
                stop,
                Some(Event::SessionStopped {
                    reason: SessionStopReason::UserStop,
                    ..
                })
            ),
            "drain must complete with UserStop, got: {stop:?}"
        );
        assert!(
            !app.active_sessions.contains_key("session-1"),
            "session must be cleared when drain completes"
        );
    }

    #[test]
    fn cancel_with_queued_utterances_drops_queue_immediately() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let _ = enqueue_n_utterances(&mut app, 3);

        let (_, events) = app.handle_command(Command::CancelSession {
            session_id: "session-1".to_string(),
        });

        let stop = events
            .iter()
            .find(|event| matches!(event, Event::SessionStopped { .. }));
        assert!(
            matches!(
                stop,
                Some(Event::SessionStopped {
                    reason: SessionStopReason::UserCancel,
                    ..
                })
            ),
            "cancel must emit SessionStopped{{UserCancel}} immediately, got: {stop:?}"
        );
        assert!(
            !app.active_sessions.contains_key("session-1"),
            "cancel must drop the active session and its pending context requests"
        );
    }

    #[test]
    fn overload_drain_completes_with_queue_overload_reason() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let _ = enqueue_n_utterances(&mut app, 31);

        let mut events = Vec::new();
        for _ in 0..31 {
            app.handle_worker_event(fake_worker_transcript_ready("session-1", None), &mut events);
        }

        let stop = events
            .iter()
            .find(|event| matches!(event, Event::SessionStopped { .. }));
        assert!(
            matches!(
                stop,
                Some(Event::SessionStopped {
                    reason: SessionStopReason::QueueOverload,
                    ..
                })
            ),
            "overload drain must complete with QueueOverload, got: {stop:?}"
        );
        assert!(
            !app.active_sessions.contains_key("session-1"),
            "session must be cleared after overload drain completes"
        );
    }

    #[test]
    fn tier_events_fire_on_downward_transitions_during_drain() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut events = enqueue_n_utterances(&mut app, 31);
        for _ in 0..31 {
            app.handle_worker_event(fake_worker_transcript_ready("session-1", None), &mut events);
        }

        let tier_sequence: Vec<QueueBackpressureTier> = events
            .iter()
            .filter_map(|event| match event {
                Event::TranscriptionQueueChanged { tier, .. } => Some(*tier),
                _ => None,
            })
            .collect();

        assert_eq!(
            tier_sequence,
            vec![
                QueueBackpressureTier::CatchingUp,
                QueueBackpressureTier::FallingBehind,
                QueueBackpressureTier::Saturated,
                QueueBackpressureTier::FallingBehind,
                QueueBackpressureTier::CatchingUp,
                QueueBackpressureTier::Normal,
            ],
            "drain must emit downward tier events as the queue depth crosses each threshold"
        );
    }

    #[test]
    fn cancel_during_overload_drain_reports_user_cancel_not_queue_overload() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let _ = enqueue_n_utterances(&mut app, 31);
        assert!(
            app.active_sessions
                .get("session-1")
                .map(|s| s.overload_draining)
                .unwrap_or(false),
            "test setup must enter overload drain"
        );

        let (_, events) = app.handle_command(Command::CancelSession {
            session_id: "session-1".to_string(),
        });

        let stop = events
            .iter()
            .find(|event| matches!(event, Event::SessionStopped { .. }));
        assert!(
            matches!(
                stop,
                Some(Event::SessionStopped {
                    reason: SessionStopReason::UserCancel,
                    ..
                })
            ),
            "cancel must win over the overload state machine, got: {stop:?}"
        );
        assert!(!app.active_sessions.contains_key("session-1"));
    }

    #[test]
    fn pause_ms_before_utterance_threads_through_transcript_ready_event() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut enqueue_events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut enqueue_events);

        let mut events = Vec::new();
        app.handle_worker_event(
            fake_worker_transcript_ready("session-1", Some(320)),
            &mut events,
        );

        let pause_ms = events.iter().find_map(|event| match event {
            Event::TranscriptReady {
                pause_ms_before_utterance,
                ..
            } => Some(*pause_ms_before_utterance),
            _ => None,
        });
        assert_eq!(
            pause_ms,
            Some(Some(320)),
            "pause_ms_before_utterance must thread through to the wire event"
        );
    }

    #[test]
    fn stale_transcript_ready_after_cancel_is_dropped() {
        let model_file_path = create_model_file();
        let mut app = test_app();
        let _ = app.handle_command(start_session_command("session-1", &model_file_path));

        let mut enqueue_events = Vec::new();
        app.enqueue_utterance("session-1", fake_utterance(), &mut enqueue_events);
        let _ = app.handle_command(Command::CancelSession {
            session_id: "session-1".to_string(),
        });
        assert!(!app.active_sessions.contains_key("session-1"));

        let mut events = Vec::new();
        app.handle_worker_event(fake_worker_transcript_ready("session-1", None), &mut events);

        assert!(
            events.is_empty(),
            "worker events for a cancelled session must be dropped silently: {events:?}"
        );
    }

    fn start_session_command(session_id: &str, model_file_path: &std::path::Path) -> Command {
        start_session_command_with_system_audio(session_id, model_file_path, false)
    }

    fn start_session_command_with_system_audio(
        session_id: &str,
        model_file_path: &std::path::Path,
        include_system_audio: bool,
    ) -> Command {
        Command::StartSession {
            acceleration_preference: AccelerationPreference::Auto,
            detailed_timestamps_enabled: false,
            diarization_enabled: false,
            diarization_max_speakers: None,
            include_system_audio,
            language: "en".to_string(),
            mode: ListeningMode::AlwaysOn,
            model_selection: SelectedModel::ExternalFile {
                runtime_id: RuntimeId::WhisperCpp,
                family_id: ModelFamilyId::Whisper,
                file_path: model_file_path.display().to_string(),
            },
            model_store_path_override: None,
            session_start_unix_ms: 1_700_000_000_000,
            session_id: session_id.to_string(),
            speaking_style: SpeakingStyle::Balanced,
        }
    }

    fn create_model_file() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should move forward")
            .as_nanos();
        let directory = temp_dir().join(format!("local-dictation-sidecar-tests-{unique}"));
        create_dir_all(&directory).expect("temp dir should create");
        let path = directory.join("model.bin");
        write(&path, b"model").expect("model file should write");
        path
    }

    fn fake_utterance() -> FinalizedUtterance {
        FinalizedUtterance {
            carries_audio_forward: false,
            pause_ms_before_utterance: None,
            samples: vec![0i16; 16000],
            utterance_index: 0,
            vad_probabilities: Vec::new(),
            voice_activity: fake_voice_activity(),
        }
    }

    fn fake_voice_activity() -> crate::audio_metadata::VoiceActivityEvidence {
        crate::audio_metadata::VoiceActivityEvidence {
            audio_start_ms: 0,
            audio_end_ms: 1000,
            speech_start_ms: 100,
            speech_end_ms: 900,
            voiced_ms: 800,
            unvoiced_ms: 200,
            mean_probability: 0.75,
            max_probability: 0.95,
        }
    }

    fn fake_worker_transcript_ready(
        session_id: &str,
        pause_ms_before_utterance: Option<u64>,
    ) -> WorkerEvent {
        WorkerEvent::TranscriptReady {
            pause_ms_before_utterance,
            processing_duration_ms: 75,
            session_id: session_id.to_string(),
            speaker_index: None,
            transcript: Transcript {
                utterance_id: Uuid::new_v4(),
                revision: 0,
                segments: Vec::new(),
                stage_history: vec![StageOutcome {
                    duration_ms: 75,
                    is_final: true,
                    payload: None,
                    revision_in: 0,
                    revision_out: Some(0),
                    stage_id: StageId::Engine,
                    status: StageStatus::Ok,
                }],
            },
            utterance_duration_ms: 1000,
            utterance_end_ms_in_session: 1000,
            utterance_index: 0,
            utterance_start_ms_in_session: 0,
            warnings: Vec::new(),
        }
    }

    fn sample_catalog() -> ModelCatalog {
        ModelCatalog {
            catalog_version: 2,
            collections: vec![ModelCollection {
                collection_id: "english".to_string(),
                display_name: "English".to_string(),
                summary: "summary".to_string(),
            }],
            runtimes: vec![ModelRuntimeDescriptor {
                runtime_id: RuntimeId::WhisperCpp,
                display_name: "whisper.cpp".to_string(),
                summary: "summary".to_string(),
            }],
            families: vec![ModelFamilyDescriptor {
                family_id: ModelFamilyId::Whisper,
                runtime_id: RuntimeId::WhisperCpp,
                task: ModelTask::Stt,
                display_name: "Whisper".to_string(),
                summary: "summary".to_string(),
            }],
            models: vec![CatalogModel {
                artifacts: vec![ModelArtifact {
                    artifact_id: "transcription".to_string(),
                    download_url: "https://example.com/model.bin".to_string(),
                    filename: "model.bin".to_string(),
                    required: true,
                    role: ArtifactRole::TranscriptionModel,
                    voice_id: None,
                    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                        .to_string(),
                    size_bytes: 10,
                }],
                collection_id: "english".to_string(),
                display_name: "Model".to_string(),
                runtime_id: RuntimeId::WhisperCpp,
                family_id: ModelFamilyId::Whisper,
                task: ModelTask::Stt,
                language_tags: vec!["en".to_string()],
                translation_support: None,
                supports_automatic_language_detection: false,
                default_voice: None,
                license_label: "MIT".to_string(),
                license_url: "https://example.com/license".to_string(),
                model_card_url: None,
                model_id: "small".to_string(),
                notes: vec![],
                source_url: "https://example.com".to_string(),
                summary: "summary".to_string(),
                ux_tags: vec![],
            }],
        }
    }
}
#[test]
fn exact_language_support_never_promotes_english_only_models() {
    assert!(language_supports(
        &LanguageSupport::EnglishOnly,
        false,
        "en"
    ));
    assert!(!language_supports(
        &LanguageSupport::EnglishOnly,
        false,
        "ja"
    ));
    assert!(language_supports(
        &LanguageSupport::List {
            tags: vec!["en".to_string(), "ja".to_string()],
        },
        false,
        "ja"
    ));
    assert!(language_supports(
        &LanguageSupport::List {
            tags: vec!["en".to_string(), "ja".to_string()],
        },
        true,
        "auto"
    ));
    assert!(!language_supports(
        &LanguageSupport::List {
            tags: vec!["en".to_string()],
        },
        false,
        "auto"
    ));
}
