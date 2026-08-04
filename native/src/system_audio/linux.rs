//! Linux system-audio capture via the PulseAudio client API.
//!
//! Records the monitor of the default output sink (`@DEFAULT_MONITOR@`) through
//! the synchronous `pa_simple` API. PipeWire ships a PulseAudio-compatible
//! server, so this one client path covers both PipeWire and PulseAudio systems.
//!
//! libpulse is loaded at runtime with `dlopen` rather than linked, so a machine
//! without it still runs the sidecar (microphone dictation keeps working) and
//! only system-audio capture reports [`SystemAudioError::Capture`]. We ask the
//! server for 16 kHz mono S16LE directly and let it resample. Pulse/PipeWire's
//! default record fragment can be multiple seconds, so we request one protocol
//! frame per fragment to keep VAD and transcription fed in real time.

use std::ffi::{c_char, c_int, c_void};
use std::ptr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use libloading::{Library, Symbol};

use super::{AudioFrameSink, CaptureHandle, SystemAudioError};
use crate::protocol::{AudioFrame, PCM_BYTES_PER_FRAME, PCM_SAMPLE_RATE_HZ};

/// `pa_stream_direction_t::PA_STREAM_RECORD`.
const PA_STREAM_RECORD: c_int = 2;
/// `pa_sample_format_t::PA_SAMPLE_S16LE` — matches the little-endian i16 PCM the
/// rest of the pipeline expects.
const PA_SAMPLE_S16LE: c_int = 3;

const INIT_TIMEOUT: Duration = Duration::from_secs(10);

/// `pa_sample_spec` from `<pulse/sample.h>`. `#[repr(C)]` reproduces the C
/// layout the server reads across the FFI boundary; the fields look unread to
/// Rust because only the C side dereferences them.
#[repr(C)]
#[allow(dead_code)]
struct PaSampleSpec {
    format: c_int,
    rate: u32,
    channels: u8,
}

/// `pa_buffer_attr` from `<pulse/def.h>`.
#[repr(C)]
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PaBufferAttr {
    maxlength: u32,
    tlength: u32,
    prebuf: u32,
    minreq: u32,
    fragsize: u32,
}

const PA_BUFFER_ATTR_UNSPECIFIED: u32 = u32::MAX;

// The three `pa_simple` entry points we use. `pa_simple` itself and the
// channel-map / buffer-attr arguments are opaque to us (NULL is passed for the
// channel-map argument), so the map is typed as `c_void`.
type PaSimpleNew = unsafe extern "C" fn(
    server: *const c_char,
    name: *const c_char,
    dir: c_int,
    dev: *const c_char,
    stream_name: *const c_char,
    ss: *const PaSampleSpec,
    map: *const c_void,
    attr: *const PaBufferAttr,
    error: *mut c_int,
) -> *mut c_void;

type PaSimpleRead = unsafe extern "C" fn(
    s: *mut c_void,
    data: *mut c_void,
    bytes: usize,
    error: *mut c_int,
) -> c_int;

type PaSimpleFree = unsafe extern "C" fn(s: *mut c_void);

pub(crate) fn spawn_capture(
    session_id: String,
    sink: AudioFrameSink,
) -> Result<CaptureHandle, SystemAudioError> {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let (init_tx, init_rx) = mpsc::channel::<Result<(), SystemAudioError>>();

    let join = thread::spawn(move || capture_thread(session_id, sink, thread_stop, init_tx));

    match init_rx.recv_timeout(INIT_TIMEOUT) {
        Ok(Ok(())) => Ok(CaptureHandle::new(stop, join)),
        Ok(Err(error)) => {
            let _ = join.join();
            Err(error)
        }
        Err(_) => {
            // The thread may have finished initializing in the race window after
            // the timeout fired; signal it to stop so it can't run orphaned.
            stop.store(true, Ordering::Relaxed);
            Err(SystemAudioError::Capture(
                "timed out opening the system-audio monitor source".into(),
            ))
        }
    }
}

fn capture_thread(
    session_id: String,
    sink: AudioFrameSink,
    stop: Arc<AtomicBool>,
    init_tx: mpsc::Sender<Result<(), SystemAudioError>>,
) {
    // `lib` must outlive every call through the resolved function pointers, so
    // it stays bound until this function returns (after `pa_simple_free`).
    let lib = match unsafe { Library::new("libpulse-simple.so.0") } {
        Ok(lib) => lib,
        Err(error) => {
            let _ = init_tx.send(Err(unavailable(format!(
                "libpulse-simple not loadable: {error}"
            ))));
            return;
        }
    };

    let (pa_simple_new, pa_simple_read, pa_simple_free) = match unsafe { load_symbols(&lib) } {
        Ok(symbols) => symbols,
        Err(error) => {
            let _ = init_tx.send(Err(unavailable(format!(
                "missing pa_simple symbol: {error}"
            ))));
            return;
        }
    };

    let ss = PaSampleSpec {
        format: PA_SAMPLE_S16LE,
        rate: PCM_SAMPLE_RATE_HZ as u32,
        channels: 1,
    };
    let attr = capture_buffer_attr();
    let mut error: c_int = 0;
    // `dev = "@DEFAULT_MONITOR@"` resolves to the monitor of the current default
    // sink on both PulseAudio and pipewire-pulse — the loopback of this
    // computer's output, mirroring the Windows default-render-endpoint capture.
    let simple = unsafe {
        pa_simple_new(
            ptr::null(),
            c"Speech Kit".as_ptr(),
            PA_STREAM_RECORD,
            c"@DEFAULT_MONITOR@".as_ptr(),
            c"system audio".as_ptr(),
            &ss,
            ptr::null(),
            &attr,
            &mut error,
        )
    };
    if simple.is_null() {
        let _ = init_tx.send(Err(SystemAudioError::Capture(format!(
            "could not open the default output monitor (PulseAudio error {error}); \
             route this computer's output through a virtual device instead"
        ))));
        return;
    }

    if init_tx.send(Ok(())).is_err() {
        unsafe { pa_simple_free(simple) };
        return;
    }

    // `attr.fragsize` requests one 20 ms protocol frame per server fragment, so
    // each blocking read returns promptly instead of waiting for the server's
    // default multi-second capture fragment.
    while !stop.load(Ordering::Relaxed) {
        let mut frame_bytes = vec![0_u8; PCM_BYTES_PER_FRAME];
        let mut error: c_int = 0;
        let result = unsafe {
            pa_simple_read(
                simple,
                frame_bytes.as_mut_ptr().cast::<c_void>(),
                PCM_BYTES_PER_FRAME,
                &mut error,
            )
        };
        if result < 0 {
            eprintln!("system-audio capture: pa_simple_read failed (PulseAudio error {error})");
            break;
        }
        (sink)(AudioFrame {
            frame_bytes,
            session_id: session_id.clone(),
        });
    }

    unsafe { pa_simple_free(simple) };
    // Explicit so the library is unloaded only after the connection is freed.
    drop(lib);
}

fn capture_buffer_attr() -> PaBufferAttr {
    PaBufferAttr {
        maxlength: PA_BUFFER_ATTR_UNSPECIFIED,
        tlength: PA_BUFFER_ATTR_UNSPECIFIED,
        prebuf: PA_BUFFER_ATTR_UNSPECIFIED,
        minreq: PA_BUFFER_ATTR_UNSPECIFIED,
        fragsize: PCM_BYTES_PER_FRAME as u32,
    }
}

/// Resolve the `pa_simple` entry points from `lib`. The returned function
/// pointers borrow nothing, so the caller must keep `lib` loaded for as long as
/// it calls them.
///
/// # Safety
/// The caller must ensure `lib` is a real libpulse-simple object and stays
/// loaded while the returned pointers are used.
unsafe fn load_symbols(
    lib: &Library,
) -> Result<(PaSimpleNew, PaSimpleRead, PaSimpleFree), libloading::Error> {
    let new: Symbol<PaSimpleNew> = unsafe { lib.get(b"pa_simple_new\0")? };
    let read: Symbol<PaSimpleRead> = unsafe { lib.get(b"pa_simple_read\0")? };
    let free: Symbol<PaSimpleFree> = unsafe { lib.get(b"pa_simple_free\0")? };
    Ok((*new, *read, *free))
}

fn unavailable(details: String) -> SystemAudioError {
    SystemAudioError::Capture(format!(
        "PulseAudio/PipeWire not available ({details}); \
         route this computer's output through a virtual device instead"
    ))
}

#[cfg(test)]
mod tests {
    use super::{PA_BUFFER_ATTR_UNSPECIFIED, capture_buffer_attr};
    use crate::protocol::PCM_BYTES_PER_FRAME;

    #[test]
    fn capture_buffer_attr_requests_one_protocol_frame_per_fragment() {
        let attr = capture_buffer_attr();

        assert_eq!(attr.maxlength, PA_BUFFER_ATTR_UNSPECIFIED);
        assert_eq!(attr.tlength, PA_BUFFER_ATTR_UNSPECIFIED);
        assert_eq!(attr.prebuf, PA_BUFFER_ATTR_UNSPECIFIED);
        assert_eq!(attr.minreq, PA_BUFFER_ATTR_UNSPECIFIED);
        assert_eq!(attr.fragsize, PCM_BYTES_PER_FRAME as u32);
    }
}
