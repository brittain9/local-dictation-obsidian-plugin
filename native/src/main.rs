use std::io::{self, Write};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::{Context, Result};
use local_dictation_sidecar::app::{AppState, ControlFlow};
use local_dictation_sidecar::catalog::ModelCatalog;
use local_dictation_sidecar::protocol::{
    AudioFrame, Command, Event, IncomingFrame, read_frame, write_event_frame,
};
#[cfg(feature = "engine-whisper")]
use whisper_rs::install_logging_hooks;

enum InputMessage {
    Eof,
    Frame(IncomingFrame),
    ProtocolError(String),
    SystemAudio(AudioFrame),
    SystemAudioProbeResult(Event),
}

fn main() -> Result<()> {
    #[cfg(feature = "engine-whisper")]
    install_logging_hooks();

    let catalog = ModelCatalog::load_bundled()?;
    run_stdio(catalog, env!("CARGO_PKG_VERSION").to_string())
}

fn run_stdio(catalog: ModelCatalog, sidecar_version: String) -> Result<()> {
    let stdout = io::stdout();
    let mut writer = io::BufWriter::new(stdout.lock());
    let (input_tx, input_rx) = mpsc::channel();
    spawn_input_reader(input_tx.clone());
    let mut app_state = AppState::new(sidecar_version, catalog);

    // Native system-audio capture produces frames on its own threads; route them
    // into the same channel the stdin reader feeds, so they flow through the
    // identical command/audio dispatch path. `Sender` is `!Sync`, so a `Mutex`
    // makes the sink satisfy the `Send + Sync` bound.
    let sink_tx = Mutex::new(input_tx.clone());
    app_state.set_system_audio_sink(Arc::new(move |frame| {
        if let Ok(tx) = sink_tx.lock() {
            let _ = tx.send(InputMessage::SystemAudio(frame));
        }
    }));

    loop {
        write_events(&mut writer, app_state.drain_pending_outputs())?;

        match input_rx.recv_timeout(Duration::from_millis(10)) {
            Ok(InputMessage::Frame(frame)) => {
                let (control_flow, events) = match frame {
                    IncomingFrame::Audio(audio_frame) => (
                        ControlFlow::Continue,
                        app_state.handle_audio_frame(audio_frame),
                    ),
                    IncomingFrame::Command(Command::ProbeSystemAudio) => {
                        spawn_system_audio_probe(input_tx.clone());
                        (ControlFlow::Continue, Vec::new())
                    }
                    IncomingFrame::Command(command) => app_state.handle_command(command),
                };

                write_events(&mut writer, events)?;

                if control_flow == ControlFlow::Shutdown {
                    break;
                }
            }
            Ok(InputMessage::SystemAudio(audio_frame)) => {
                write_events(
                    &mut writer,
                    app_state.handle_system_audio_frame(audio_frame),
                )?;
            }
            Ok(InputMessage::SystemAudioProbeResult(event)) => {
                write_events(&mut writer, vec![event])?;
            }
            Ok(InputMessage::ProtocolError(details)) => {
                write_events(
                    &mut writer,
                    vec![Event::Error {
                        code: "invalid_frame".to_string(),
                        details: Some(details),
                        message: "Failed to parse an incoming protocol frame.".to_string(),
                        session_id: None,
                    }],
                )?;
            }
            Ok(InputMessage::Eof) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    Ok(())
}

fn spawn_input_reader(tx: Sender<InputMessage>) {
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut reader = stdin.lock();

        loop {
            match read_frame(&mut reader) {
                Ok(Some(frame)) => {
                    if tx.send(InputMessage::Frame(frame)).is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    let _ = tx.send(InputMessage::Eof);
                    break;
                }
                Err(error) => {
                    if tx
                        .send(InputMessage::ProtocolError(format!("{error:#}")))
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    });
}

fn spawn_system_audio_probe(tx: Sender<InputMessage>) {
    thread::spawn(move || {
        let event = match local_dictation_sidecar::system_audio::probe_system_audio() {
            Ok(()) => Event::SystemAudioProbeResult {
                ok: true,
                code: None,
                message: None,
            },
            Err(error) => Event::SystemAudioProbeResult {
                ok: false,
                code: Some(error.code().to_string()),
                message: Some(error.message()),
            },
        };

        let _ = tx.send(InputMessage::SystemAudioProbeResult(event));
    });
}

fn write_events(writer: &mut impl Write, events: Vec<Event>) -> Result<()> {
    for event in events {
        write_event_frame(writer, &event).context("failed to write event frame")?;
    }

    Ok(())
}
