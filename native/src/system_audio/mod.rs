//! Native system-audio (loopback) capture.
//!
//! The renderer captures the microphone and streams PCM in over the protocol;
//! the sidecar is otherwise a passive consumer. This module lets the sidecar
//! *produce* audio frames too, by capturing this computer's audio output
//! natively and feeding the identical `AudioFrame` path — so VAD,
//! transcription, and everything downstream stay unchanged.
//!
//! Capture is inherently per-OS. Windows uses WASAPI loopback of the default
//! render endpoint; Linux records the monitor of the default PulseAudio/PipeWire
//! sink (`@DEFAULT_MONITOR@`); macOS 14.2+ uses CoreAudio process taps attached
//! to a private aggregate device. Older macOS and other platforms return
//! [`SystemAudioError::Unsupported`], and users route output through a virtual
//! audio device and pick it in the normal microphone list instead.
//!
//! The real controller and [`CaptureHandle`] therefore compile on Windows,
//! Linux, and macOS. Elsewhere only the stub and the shared error type compile.
//! The resampler is shared by Windows and macOS; Linux asks PulseAudio for
//! 16 kHz mono directly, so no client-side resampling is needed.

#[cfg(any(windows, target_os = "macos", test))]
mod resample;

#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(any(target_os = "macos", test))]
mod macos;

#[cfg(target_os = "linux")]
use self::linux as backend;
#[cfg(target_os = "macos")]
use self::macos as backend;
#[cfg(windows)]
use self::windows as backend;

use std::sync::Arc;

use crate::protocol::AudioFrame;

/// Receives 640-byte (320×i16 mono 16 kHz) frames produced by a capture
/// thread. Wired by the host to the same ingestion path renderer audio uses.
pub type AudioFrameSink = Arc<dyn Fn(AudioFrame) + Send + Sync>;

/// Minimal control surface AppState needs from a native system-audio backend.
pub trait SystemAudioCapture: Send {
    fn set_sink(&mut self, sink: AudioFrameSink);
    fn start(&mut self, session_id: String) -> Result<(), SystemAudioError>;
    fn stop(&mut self, session_id: &str);
}

/// Why native system-audio capture could not start.
#[derive(Debug)]
pub enum SystemAudioError {
    /// This platform has no native loopback backend yet.
    Unsupported,
    /// macOS has not granted the host app system-audio recording permission.
    PermissionDenied,
    /// The OS audio backend failed to open or initialize the loopback stream.
    Capture(String),
}

impl SystemAudioError {
    /// Stable machine code, surfaced to the plugin as an error event code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unsupported => "system_audio_unsupported",
            Self::PermissionDenied => "system_audio_permission_denied",
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
            Self::PermissionDenied => "System-audio recording permission is off for Obsidian. \
                Open System Settings → Privacy & Security → Screen & System Audio Recording, \
                enable Obsidian, and try again."
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
#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
pub(crate) struct CaptureHandle {
    stop: Arc<std::sync::atomic::AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
}

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
impl CaptureHandle {
    /// Build a handle from a shared stop flag and the thread it controls. Used
    /// by platform backends after they spawn their capture loop.
    pub(crate) fn new(
        stop: Arc<std::sync::atomic::AtomicBool>,
        join: std::thread::JoinHandle<()>,
    ) -> Self {
        Self {
            stop,
            join: Some(join),
        }
    }

    fn stop_and_join(mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Owns the active system-audio capture threads, keyed by session id, and the
/// sink frames are delivered to. Captures stop when their session ends and when
/// the controller is dropped (sidecar shutdown).
#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
pub struct SystemAudioController {
    sink: AudioFrameSink,
    captures: std::collections::HashMap<String, CaptureHandle>,
}

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
impl SystemAudioController {
    /// A controller with a no-op sink. The host installs the real sink with
    /// [`set_sink`](Self::set_sink) once its ingestion channel exists.
    pub fn new() -> Self {
        Self {
            sink: Arc::new(|_frame| {}),
            captures: std::collections::HashMap::new(),
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
        let handle = backend::spawn_capture(session_id.clone(), Arc::clone(&self.sink))?;
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

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
impl Drop for SystemAudioController {
    fn drop(&mut self) {
        for (_session_id, handle) in self.captures.drain() {
            handle.stop_and_join();
        }
    }
}

/// Stub controller for platforms without a native loopback backend. The API
/// matches the native controller so the host wires it identically; `start`
/// reports the feature unavailable so callers fall back to the documented
/// virtual-device method.
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
pub struct SystemAudioController;

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
impl SystemAudioController {
    pub fn new() -> Self {
        Self
    }

    pub fn set_sink(&mut self, _sink: AudioFrameSink) {}

    pub fn start(&mut self, _session_id: String) -> Result<(), SystemAudioError> {
        Err(SystemAudioError::Unsupported)
    }

    pub fn stop(&mut self, _session_id: &str) {}
}

impl SystemAudioCapture for SystemAudioController {
    fn set_sink(&mut self, sink: AudioFrameSink) {
        SystemAudioController::set_sink(self, sink);
    }

    fn start(&mut self, session_id: String) -> Result<(), SystemAudioError> {
        SystemAudioController::start(self, session_id)
    }

    fn stop(&mut self, session_id: &str) {
        SystemAudioController::stop(self, session_id);
    }
}

impl Default for SystemAudioController {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
pub fn probe_system_audio() -> Result<(), SystemAudioError> {
    let handle = backend::spawn_capture_with_timeout(
        uuid::Uuid::new_v4().to_string(),
        Arc::new(|_frame| {}),
        std::time::Duration::from_secs(75),
    )?;
    handle.stop_and_join();
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn probe_system_audio() -> Result<(), SystemAudioError> {
    Err(SystemAudioError::Unsupported)
}

#[cfg(all(test, not(any(windows, target_os = "linux", target_os = "macos"))))]
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
