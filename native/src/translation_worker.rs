use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

use crate::protocol::{Event, read_json_frame, write_json_frame};
use crate::translation_helper_protocol::{HelperCommand, HelperEvent};

const HELPER_IDLE_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug)]
pub struct StartTranslation {
    pub translation_id: String,
    pub model_path: PathBuf,
    pub source_language: String,
    pub target_language: String,
    pub texts: Vec<String>,
    pub use_gpu: bool,
}

enum WorkerCommand {
    Start(StartTranslation),
    Cancel(String),
    Shutdown,
}

pub struct TranslationWorker {
    command_tx: Sender<WorkerCommand>,
    event_rx: Receiver<Event>,
}

impl TranslationWorker {
    pub fn spawn() -> Self {
        let (command_tx, command_rx) = mpsc::channel();
        let (event_tx, event_rx) = mpsc::channel();
        thread::spawn(move || worker_main(command_rx, event_tx));
        Self {
            command_tx,
            event_rx,
        }
    }

    pub fn start(&self, request: StartTranslation) -> Result<(), String> {
        self.command_tx
            .send(WorkerCommand::Start(request))
            .map_err(|_| "The translation worker is unavailable.".to_string())
    }

    pub fn cancel(&self, translation_id: &str) {
        let _ = self
            .command_tx
            .send(WorkerCommand::Cancel(translation_id.to_string()));
    }

    pub fn poll_event(&self) -> Option<Event> {
        self.event_rx.try_recv().ok()
    }
}

impl Drop for TranslationWorker {
    fn drop(&mut self) {
        let _ = self.command_tx.send(WorkerCommand::Shutdown);
    }
}

struct HelperProcess {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    event_rx: Receiver<anyhow::Result<HelperEvent>>,
}

impl HelperProcess {
    fn spawn() -> anyhow::Result<Self> {
        let executable = std::env::current_exe()?;
        let filename = if cfg!(windows) {
            "local-dictation-translation-helper.exe"
        } else {
            "local-dictation-translation-helper"
        };
        let helper_path = executable
            .parent()
            .ok_or_else(|| anyhow::anyhow!("sidecar executable has no parent directory"))?
            .join(filename);
        let mut child = Command::new(&helper_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                anyhow::anyhow!(
                    "failed to launch packaged helper at {}: {error}",
                    helper_path.display()
                )
            })?;
        let stdin = BufWriter::new(
            child
                .stdin
                .take()
                .ok_or_else(|| anyhow::anyhow!("helper stdin unavailable"))?,
        );
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("helper stdout unavailable"))?;
        let (event_tx, event_rx) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_json_frame::<_, HelperEvent>(&mut reader) {
                    Ok(Some(event)) => {
                        if event_tx.send(Ok(event)).is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = event_tx.send(Err(error));
                        break;
                    }
                }
            }
        });
        match event_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(HelperEvent::Ready { helper_version }))
                if helper_version == env!("CARGO_PKG_VERSION") => {}
            Ok(Ok(HelperEvent::Ready { helper_version })) => {
                let _ = child.kill();
                let _ = child.wait();
                anyhow::bail!(
                    "translation helper version {helper_version} does not match sidecar version {}",
                    env!("CARGO_PKG_VERSION")
                );
            }
            Ok(Ok(_)) => {
                let _ = child.kill();
                let _ = child.wait();
                anyhow::bail!("translation helper did not send its startup handshake");
            }
            Ok(Err(error)) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.context("translation helper startup handshake failed"));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                anyhow::bail!("translation helper startup handshake timed out: {error}");
            }
        }
        Ok(Self {
            child,
            stdin,
            event_rx,
        })
    }

    fn send(&mut self, command: &HelperCommand) -> anyhow::Result<()> {
        write_json_frame(&mut self.stdin, command)
    }
    fn stop(&mut self) {
        let _ = self.send(&HelperCommand::Shutdown);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn worker_main(commands: Receiver<WorkerCommand>, events: Sender<Event>) {
    let mut helper: Option<HelperProcess> = None;
    let mut active: Option<String> = None;
    let mut idle_since: Option<Instant> = None;
    loop {
        let mut helper_failed = false;
        if let Some(process) = helper.as_mut() {
            loop {
                match process.event_rx.try_recv() {
                    Ok(event) => match event {
                        Ok(event) => {
                            let terminal = matches!(
                                event,
                                HelperEvent::Complete { .. }
                                    | HelperEvent::Cancelled { .. }
                                    | HelperEvent::Error { .. }
                            );
                            let _ = events.send(map_helper_event(event));
                            if terminal {
                                active = None;
                                idle_since = Some(Instant::now());
                            }
                        }
                        Err(error) => {
                            if let Some(translation_id) = active.take() {
                                let _ = events.send(Event::TranslationError {
                                    translation_id,
                                    code: "helper_protocol_error".into(),
                                    message: "The translation helper returned invalid data.".into(),
                                    details: Some(format!("{error:#}")),
                                });
                            }
                            helper_failed = true;
                            break;
                        }
                    },
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        if let Some(translation_id) = active.take() {
                            let _ = events.send(Event::TranslationError {
                                translation_id,
                                code: "helper_unavailable".into(),
                                message: "The translation helper stopped unexpectedly.".into(),
                                details: None,
                            });
                        }
                        helper_failed = true;
                        break;
                    }
                }
            }
        }
        if helper_failed {
            if let Some(mut process) = helper.take() {
                process.stop();
            }
            idle_since = None;
        }
        let helper_exited = helper
            .as_mut()
            .and_then(|process| process.child.try_wait().ok().flatten())
            .is_some();
        if helper_exited {
            if let Some(translation_id) = active.take() {
                let _ = events.send(Event::TranslationError {
                    translation_id,
                    code: "helper_unavailable".into(),
                    message: "The translation helper stopped unexpectedly.".into(),
                    details: None,
                });
            }
            helper = None;
            idle_since = None;
        }
        if active.is_none() && idle_since.is_some_and(|time| time.elapsed() >= HELPER_IDLE_TTL) {
            if let Some(mut process) = helper.take() {
                process.stop();
            }
            idle_since = None;
        }
        match commands.recv_timeout(Duration::from_millis(10)) {
            Ok(WorkerCommand::Start(request)) => {
                if active.is_some() {
                    let _ = events.send(Event::TranslationError {
                        translation_id: request.translation_id,
                        code: "translation_busy".into(),
                        message: "Another Natural translation is already running.".into(),
                        details: None,
                    });
                    continue;
                }
                if helper.is_none() {
                    match HelperProcess::spawn() {
                        Ok(process) => helper = Some(process),
                        Err(error) => {
                            let _ = events.send(Event::TranslationError {
                                translation_id: request.translation_id,
                                code: "helper_unavailable".into(),
                                message: "The packaged translation helper could not be started."
                                    .into(),
                                details: Some(format!("{error:#}")),
                            });
                            continue;
                        }
                    }
                }
                let command = HelperCommand::Translate {
                    translation_id: request.translation_id.clone(),
                    model_path: request.model_path,
                    source_language: request.source_language,
                    target_language: request.target_language,
                    texts: request.texts,
                    use_gpu: request.use_gpu,
                };
                if let Err(error) = helper.as_mut().expect("created").send(&command) {
                    let _ = events.send(Event::TranslationError {
                        translation_id: request.translation_id,
                        code: "helper_write_failed".into(),
                        message: "The translation helper stopped unexpectedly.".into(),
                        details: Some(format!("{error:#}")),
                    });
                    if let Some(mut process) = helper.take() {
                        process.stop();
                    }
                } else {
                    active = Some(request.translation_id);
                    idle_since = None;
                }
            }
            Ok(WorkerCommand::Cancel(translation_id)) => {
                if active.as_deref() == Some(translation_id.as_str())
                    && let Some(process) = helper.as_mut()
                {
                    let _ = process.send(&HelperCommand::Cancel { translation_id });
                }
            }
            Ok(WorkerCommand::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    if let Some(mut process) = helper {
        process.stop();
    }
}

fn map_helper_event(event: HelperEvent) -> Event {
    match event {
        HelperEvent::Ready { .. } => {
            unreachable!("startup handshake is consumed before the worker starts")
        }
        HelperEvent::Started {
            translation_id,
            total,
        } => Event::TranslationStarted {
            translation_id,
            total,
        },
        HelperEvent::Progress {
            translation_id,
            completed,
            total,
        } => Event::TranslationProgress {
            translation_id,
            completed,
            total,
        },
        HelperEvent::Complete {
            translation_id,
            translations,
        } => Event::TranslationComplete {
            translation_id,
            translations,
        },
        HelperEvent::Cancelled { translation_id } => Event::TranslationCancelled { translation_id },
        HelperEvent::Error {
            translation_id,
            code,
            message,
        } => Event::TranslationError {
            translation_id,
            code,
            message,
            details: None,
        },
    }
}
