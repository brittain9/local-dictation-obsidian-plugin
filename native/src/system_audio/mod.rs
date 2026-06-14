//! Native system-audio (loopback) capture.
//!
//! The renderer captures the microphone and streams PCM in over the protocol;
//! the sidecar is otherwise a passive consumer. This module lets the sidecar
//! *produce* audio frames too, by capturing this computer's audio output
//! natively and feeding the identical `AudioFrame` path — so VAD,
//! transcription, and everything downstream stay unchanged.
//!
//! Capture is inherently per-OS. Windows uses WASAPI loopback of the default
//! render endpoint (zero user setup). Other platforms return
//! [`SystemAudioError::Unsupported`]; users there route output through a virtual
//! audio device and pick it in the normal microphone list instead.

mod resample;

#[cfg(windows)]
mod windows;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

use crate::protocol::AudioFrame;

pub(crate) use resample::LoopbackFrameResampler;

/// Receives 640-byte (320×i16 mono 16 kHz) frames produced by a capture
/// thread. Wired by the host to the same ingestion path renderer audio uses.
pub type AudioFrameSink = Arc<dyn Fn(AudioFrame) + Send + Sync>;

/// Why native system-audio capture could not start.
#[derive(Debug)]
pub enum SystemAudioError {
    /// This platform has no native loopback backend yet.
    Unsupported,
    /// The OS audio backend failed to open or initialize the loopback stream.
    Capture(String),
}

impl SystemAudioError {
    /// Stable machine code, surfaced to the plugin as an error event code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unsupported => "system_audio_unsupported",
            Self::Capture(_) => "system_audio_capture_failed",
        }
    }

    /// Human-readable, user-facing explanation.
    pub fn message(&self) -> String {
        match self {
            Self::Unsupported => "System-audio capture isn't available on this platform yet. \
                Route this computer's output through a virtual audio device and pick it as your \
                microphone — see the System audio guide."
                .to_string(),
            Self::Capture(details) => format!("Could not start system-audio capture: {details}"),
        }
    }
}

impl std::fmt::Display for SystemAudioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for SystemAudioError {}

/// A running capture thread for one session. Dropping or stopping signals the
/// thread to exit and joins it.
pub(crate) struct CaptureHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl CaptureHandle {
    /// Build a handle from a shared stop flag and the thread it controls. Used
    /// by platform backends after they spawn their capture loop.
    pub(crate) fn new(stop: Arc<AtomicBool>, join: JoinHandle<()>) -> Self {
        Self {
            stop,
            join: Some(join),
        }
    }

    fn stop_and_join(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Owns the active system-audio capture threads, keyed by session id, and the
/// sink frames are delivered to. Captures stop when their session ends and when
/// the controller is dropped (sidecar shutdown).
pub struct SystemAudioController {
    sink: AudioFrameSink,
    captures: HashMap<String, CaptureHandle>,
}

impl SystemAudioController {
    /// A controller with a no-op sink. The host installs the real sink with
    /// [`set_sink`](Self::set_sink) once its ingestion channel exists.
    pub fn new() -> Self {
        Self {
            sink: Arc::new(|_frame| {}),
            captures: HashMap::new(),
        }
    }

    /// Install the sink capture threads deliver frames to.
    pub fn set_sink(&mut self, sink: AudioFrameSink) {
        self.sink = sink;
    }

    /// Start capturing system audio for `session_id`. Returns synchronously once
    /// the backend has opened the device, so device/platform failures surface
    /// before the session is announced. Idempotent per session.
    pub fn start(&mut self, session_id: String) -> Result<(), SystemAudioError> {
        if self.captures.contains_key(&session_id) {
            return Ok(());
        }
        let handle = spawn_capture(session_id.clone(), Arc::clone(&self.sink))?;
        self.captures.insert(session_id, handle);
        Ok(())
    }

    /// Stop and join the capture for `session_id`, if any. No-op otherwise.
    pub fn stop(&mut self, session_id: &str) {
        if let Some(handle) = self.captures.remove(session_id) {
            handle.stop_and_join();
        }
    }
}

impl Default for SystemAudioController {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for SystemAudioController {
    fn drop(&mut self) {
        for (_session_id, handle) in self.captures.drain() {
            handle.stop_and_join();
        }
    }
}

#[cfg(windows)]
fn spawn_capture(
    session_id: String,
    sink: AudioFrameSink,
) -> Result<CaptureHandle, SystemAudioError> {
    windows::spawn_capture(session_id, sink)
}

#[cfg(not(windows))]
fn spawn_capture(
    _session_id: String,
    _sink: AudioFrameSink,
) -> Result<CaptureHandle, SystemAudioError> {
    Err(SystemAudioError::Unsupported)
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::{SystemAudioController, SystemAudioError};

    #[test]
    fn start_is_unsupported_without_a_native_backend() {
        let mut controller = SystemAudioController::new();
        assert!(matches!(
            controller.start("session-1".to_string()),
            Err(SystemAudioError::Unsupported)
        ));
    }
}
