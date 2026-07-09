//! macOS system-audio capture via CoreAudio process taps.
//!
//! The tap entry points arrived in macOS 14.2, so they are resolved with
//! `dlsym` instead of linked. The older aggregate-device and IOProc APIs are
//! linked normally through CoreAudio.
//!
//! Everything that touches CoreAudio lives in the `platform` module, gated on
//! macOS as one unit. The items above it are pure format/description helpers
//! that also compile under `cfg(test)` so the host test suite covers them.

use super::SystemAudioError;

type OSStatus = i32;
type AudioObjectPropertySelector = u32;
type AudioObjectPropertyScope = u32;
type AudioObjectPropertyElement = u32;
type AudioFormatID = u32;
type AudioFormatFlags = u32;

const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: AudioObjectPropertyScope = 0x676c_6f62;
const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: AudioObjectPropertyElement = 0;
const K_AUDIO_TAP_PROPERTY_FORMAT: AudioObjectPropertySelector = 0x7466_6d74;
const K_AUDIO_FORMAT_LINEAR_PCM: AudioFormatID = 0x6c70_636d;
const K_AUDIO_FORMAT_FLAG_IS_FLOAT: AudioFormatFlags = 1 << 0;
const K_AUDIO_FORMAT_FLAG_IS_PACKED: AudioFormatFlags = 1 << 3;
const K_AUDIO_FORMAT_FLAG_IS_NON_INTERLEAVED: AudioFormatFlags = 1 << 5;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct AudioObjectPropertyAddress {
    m_selector: AudioObjectPropertySelector,
    m_scope: AudioObjectPropertyScope,
    m_element: AudioObjectPropertyElement,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct AudioStreamBasicDescription {
    m_sample_rate: f64,
    m_format_id: AudioFormatID,
    m_format_flags: AudioFormatFlags,
    m_bytes_per_packet: u32,
    m_frames_per_packet: u32,
    m_bytes_per_frame: u32,
    m_channels_per_frame: u32,
    m_bits_per_channel: u32,
    m_reserved: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MacLoopbackFormat {
    sample_rate: u32,
    channels: usize,
    non_interleaved: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AggregateDeviceDescription {
    name: &'static str,
    uid: String,
    is_private: bool,
    tap_auto_start: bool,
    tap_uid: String,
    drift_compensation: bool,
}

fn parse_tap_format(
    asbd: &AudioStreamBasicDescription,
) -> Result<MacLoopbackFormat, SystemAudioError> {
    if asbd.m_sample_rate <= 0.0 || !asbd.m_sample_rate.is_finite() {
        return Err(SystemAudioError::Capture(
            "tap reported an invalid sample rate".into(),
        ));
    }

    if asbd.m_format_id != K_AUDIO_FORMAT_LINEAR_PCM
        || asbd.m_bits_per_channel != 32
        || asbd.m_bytes_per_frame == 0
        || asbd.m_channels_per_frame == 0
        || (asbd.m_format_flags & K_AUDIO_FORMAT_FLAG_IS_FLOAT) == 0
        || (asbd.m_format_flags & K_AUDIO_FORMAT_FLAG_IS_PACKED) == 0
    {
        return Err(SystemAudioError::Capture(format!(
            "unsupported tap format: {}",
            describe_tap_format(asbd)
        )));
    }

    let sample_rate = asbd.m_sample_rate.round();
    if sample_rate < 1.0 || sample_rate > u32::MAX as f64 {
        return Err(SystemAudioError::Capture(
            "tap reported an out-of-range sample rate".into(),
        ));
    }

    Ok(MacLoopbackFormat {
        sample_rate: sample_rate as u32,
        channels: asbd.m_channels_per_frame as usize,
        non_interleaved: (asbd.m_format_flags & K_AUDIO_FORMAT_FLAG_IS_NON_INTERLEAVED) != 0,
    })
}

// AudioHardwareCreateAggregateDevice requires kAudioAggregateDeviceNameKey and
// kAudioAggregateDeviceUIDKey at minimum; omitting them fails with 'nope'
// (kAudioHardwareIllegalOperationError).
fn aggregate_device_description(uid: String, tap_uid: String) -> AggregateDeviceDescription {
    AggregateDeviceDescription {
        name: "Local Dictation System Audio",
        uid,
        is_private: true,
        tap_auto_start: false,
        tap_uid,
        drift_compensation: true,
    }
}

fn describe_tap_format(asbd: &AudioStreamBasicDescription) -> String {
    format!(
        "format=0x{:08x} flags=0x{:08x} rate={} bits={} channels={} bytes_per_frame={}",
        asbd.m_format_id,
        asbd.m_format_flags,
        asbd.m_sample_rate,
        asbd.m_bits_per_channel,
        asbd.m_channels_per_frame,
        asbd.m_bytes_per_frame
    )
}

fn tap_property_address(selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        m_selector: selector,
        m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
        m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
    }
}

fn format_os_status(status: OSStatus) -> String {
    let bytes = (status as u32).to_be_bytes();
    if bytes
        .iter()
        .all(|byte| byte.is_ascii_graphic() || *byte == b' ')
    {
        format!("'{}' ({status})", String::from_utf8_lossy(&bytes))
    } else {
        status.to_string()
    }
}

#[cfg(target_os = "macos")]
pub(crate) use platform::{spawn_capture, spawn_capture_with_timeout};

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::{CStr, c_void};
    use std::mem;
    use std::ptr;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, SyncSender};
    use std::thread;
    use std::time::Duration;

    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSUUID};

    use super::{
        AudioObjectPropertyAddress, AudioStreamBasicDescription, K_AUDIO_TAP_PROPERTY_FORMAT,
        MacLoopbackFormat, OSStatus, SystemAudioError, aggregate_device_description,
        format_os_status, parse_tap_format, tap_property_address,
    };
    use crate::protocol::AudioFrame;
    use crate::system_audio::resample::LoopbackFrameResampler;
    use crate::system_audio::{AudioFrameSink, CaptureHandle};

    type AudioObjectID = u32;

    const INIT_TIMEOUT: Duration = Duration::from_secs(10);
    const SAMPLE_CHANNEL_CAPACITY: usize = 8;
    const DRAIN_INTERVAL: Duration = Duration::from_millis(10);

    const MACOS_UNSUPPORTED_MESSAGE: &str = "System-audio capture needs macOS 14.2 or later. \
        Route output through a virtual audio device (BlackHole) and pick it as your microphone \
        instead.";

    const K_AUDIO_HARDWARE_NO_ERROR: OSStatus = 0;
    const K_AUDIO_OBJECT_UNKNOWN: AudioObjectID = 0;
    const K_AUDIO_TAP_PROPERTY_DESCRIPTION: super::AudioObjectPropertySelector = 0x7464_7363;

    const K_AUDIO_AGGREGATE_DEVICE_NAME_KEY: &str = "name";
    const K_AUDIO_AGGREGATE_DEVICE_UID_KEY: &str = "uid";
    const K_AUDIO_AGGREGATE_DEVICE_IS_PRIVATE_KEY: &str = "private";
    const K_AUDIO_AGGREGATE_DEVICE_TAP_LIST_KEY: &str = "taps";
    const K_AUDIO_AGGREGATE_DEVICE_TAP_AUTO_START_KEY: &str = "tapautostart";
    const K_AUDIO_SUB_TAP_UID_KEY: &str = "uid";
    const K_AUDIO_SUB_TAP_DRIFT_COMPENSATION_KEY: &str = "drift";

    #[repr(C)]
    #[derive(Clone, Copy, Debug, PartialEq)]
    struct AudioBuffer {
        m_number_channels: u32,
        m_data_byte_size: u32,
        m_data: *mut c_void,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Debug, PartialEq)]
    struct AudioBufferList {
        m_number_buffers: u32,
        m_buffers: [AudioBuffer; 1],
    }

    type CreateProcessTap = unsafe extern "C" fn(
        in_description: *mut AnyObject,
        out_tap_id: *mut AudioObjectID,
    ) -> OSStatus;
    type DestroyProcessTap = unsafe extern "C" fn(in_tap_id: AudioObjectID) -> OSStatus;

    type AudioDeviceIOProc = unsafe extern "C" fn(
        AudioObjectID,
        *const c_void,
        *const AudioBufferList,
        *const c_void,
        *mut AudioBufferList,
        *const c_void,
        *mut c_void,
    ) -> OSStatus;
    type AudioDeviceIOProcID = Option<AudioDeviceIOProc>;

    #[link(name = "CoreAudio", kind = "framework")]
    unsafe extern "C" {
        fn AudioHardwareCreateAggregateDevice(
            in_description: *const c_void,
            out_device_id: *mut AudioObjectID,
        ) -> OSStatus;
        fn AudioHardwareDestroyAggregateDevice(in_device_id: AudioObjectID) -> OSStatus;
        fn AudioObjectGetPropertyData(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
            in_qualifier_data_size: u32,
            in_qualifier_data: *const c_void,
            io_data_size: *mut u32,
            out_data: *mut c_void,
        ) -> OSStatus;
        fn AudioObjectSetPropertyData(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
            in_qualifier_data_size: u32,
            in_qualifier_data: *const c_void,
            in_data_size: u32,
            in_data: *const c_void,
        ) -> OSStatus;
        fn AudioDeviceCreateIOProcID(
            in_device: AudioObjectID,
            in_proc: AudioDeviceIOProcID,
            in_client_data: *mut c_void,
            out_io_proc_id: *mut AudioDeviceIOProcID,
        ) -> OSStatus;
        fn AudioDeviceDestroyIOProcID(
            in_device: AudioObjectID,
            in_io_proc_id: AudioDeviceIOProcID,
        ) -> OSStatus;
        fn AudioDeviceStart(in_device: AudioObjectID, in_proc_id: AudioDeviceIOProcID) -> OSStatus;
        fn AudioDeviceStop(in_device: AudioObjectID, in_proc_id: AudioDeviceIOProcID) -> OSStatus;
    }

    #[derive(Clone, Copy)]
    struct TapApi {
        create_process_tap: CreateProcessTap,
        destroy_process_tap: DestroyProcessTap,
    }

    struct CaptureResources {
        api: TapApi,
        aggregate_device: Option<AudioObjectID>,
        io_proc_id: Option<AudioDeviceIOProcID>,
        started: bool,
        tap_id: Option<AudioObjectID>,
    }

    impl CaptureResources {
        fn new(api: TapApi) -> Self {
            Self {
                api,
                aggregate_device: None,
                io_proc_id: None,
                started: false,
                tap_id: None,
            }
        }
    }

    impl Drop for CaptureResources {
        fn drop(&mut self) {
            if self.started
                && let (Some(device), Some(io_proc_id)) = (self.aggregate_device, self.io_proc_id)
            {
                let status = unsafe { AudioDeviceStop(device, io_proc_id) };
                if status != 0 {
                    eprintln!(
                        "system-audio capture: AudioDeviceStop failed with CoreAudio status {status}"
                    );
                }
            }

            if let (Some(device), Some(io_proc_id)) = (self.aggregate_device, self.io_proc_id) {
                let status = unsafe { AudioDeviceDestroyIOProcID(device, io_proc_id) };
                if status != 0 {
                    eprintln!(
                        "system-audio capture: AudioDeviceDestroyIOProcID failed with CoreAudio status {status}"
                    );
                }
            }

            if let Some(device) = self.aggregate_device {
                let status = unsafe { AudioHardwareDestroyAggregateDevice(device) };
                if status != 0 {
                    eprintln!(
                        "system-audio capture: AudioHardwareDestroyAggregateDevice failed with CoreAudio status {status}"
                    );
                }
            }

            if let Some(tap_id) = self.tap_id {
                let status = unsafe { (self.api.destroy_process_tap)(tap_id) };
                if status != 0 {
                    eprintln!(
                        "system-audio capture: AudioHardwareDestroyProcessTap failed with CoreAudio status {status}"
                    );
                }
            }
        }
    }

    struct IoProcContext {
        format: MacLoopbackFormat,
        tx: SyncSender<Vec<f32>>,
    }

    pub(crate) fn spawn_capture(
        session_id: String,
        sink: AudioFrameSink,
    ) -> Result<CaptureHandle, SystemAudioError> {
        spawn_capture_with_timeout(session_id, sink, INIT_TIMEOUT)
    }

    pub(crate) fn spawn_capture_with_timeout(
        session_id: String,
        sink: AudioFrameSink,
        init_timeout: Duration,
    ) -> Result<CaptureHandle, SystemAudioError> {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let (init_tx, init_rx) = mpsc::channel::<Result<(), SystemAudioError>>();

        let join = thread::spawn(move || capture_thread(session_id, sink, thread_stop, init_tx));

        match init_rx.recv_timeout(init_timeout) {
            Ok(Ok(())) => Ok(CaptureHandle::new(stop, join)),
            Ok(Err(error)) => {
                let _ = join.join();
                Err(error)
            }
            Err(_) => {
                stop.store(true, Ordering::Relaxed);
                Err(SystemAudioError::Capture(
                    "timed out opening the macOS system-audio tap".into(),
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
        if let Err(error) = run_capture(session_id, sink, stop, init_tx) {
            eprintln!("system-audio capture: {error}");
        }
    }

    fn os_status_result(status: OSStatus, action: &str) -> Result<(), SystemAudioError> {
        if status == K_AUDIO_HARDWARE_NO_ERROR {
            Ok(())
        } else {
            Err(SystemAudioError::Capture(format!(
                "{action} failed with CoreAudio status {}",
                format_os_status(status)
            )))
        }
    }

    fn run_capture(
        session_id: String,
        sink: AudioFrameSink,
        stop: Arc<AtomicBool>,
        init_tx: mpsc::Sender<Result<(), SystemAudioError>>,
    ) -> Result<(), SystemAudioError> {
        let api = match TapApi::resolve() {
            Ok(api) => api,
            Err(error) => {
                let _ = init_tx.send(Err(error));
                return Ok(());
            }
        };

        let mut resources = CaptureResources::new(api);

        let (tap_description, tap_uid) = match create_tap_description() {
            Ok(description) => description,
            Err(error) => {
                let _ = init_tx.send(Err(error));
                return Ok(());
            }
        };

        let mut tap_id = K_AUDIO_OBJECT_UNKNOWN;
        let status = unsafe {
            (api.create_process_tap)(Retained::as_ptr(&tap_description).cast_mut(), &mut tap_id)
        };
        if status != 0 || tap_id == K_AUDIO_OBJECT_UNKNOWN {
            let error = if status == 0 {
                SystemAudioError::Capture("CoreAudio returned an unknown process-tap id".into())
            } else {
                SystemAudioError::Capture(format!(
                    "AudioHardwareCreateProcessTap failed with CoreAudio status {}",
                    format_os_status(status)
                ))
            };
            let _ = init_tx.send(Err(error));
            return Ok(());
        }
        resources.tap_id = Some(tap_id);

        if let Err(error) = probe_tap_permission(tap_id) {
            let _ = init_tx.send(Err(error));
            return Ok(());
        }

        let aggregate_description = create_aggregate_description(tap_uid);
        let mut aggregate_device = K_AUDIO_OBJECT_UNKNOWN;
        let status = unsafe {
            AudioHardwareCreateAggregateDevice(
                Retained::as_ptr(&aggregate_description).cast::<c_void>(),
                &mut aggregate_device,
            )
        };
        if status != 0 || aggregate_device == K_AUDIO_OBJECT_UNKNOWN {
            let error = if status == 0 {
                SystemAudioError::Capture(
                    "CoreAudio returned an unknown aggregate-device id".into(),
                )
            } else {
                SystemAudioError::Capture(format!(
                    "AudioHardwareCreateAggregateDevice failed with CoreAudio status {}",
                    format_os_status(status)
                ))
            };
            let _ = init_tx.send(Err(error));
            return Ok(());
        }
        resources.aggregate_device = Some(aggregate_device);

        let format = match read_tap_format(tap_id) {
            Ok(format) => format,
            Err(error) => {
                let _ = init_tx.send(Err(error));
                return Ok(());
            }
        };

        let (sample_tx, sample_rx) = mpsc::sync_channel::<Vec<f32>>(SAMPLE_CHANNEL_CAPACITY);
        let mut io_context = Box::new(IoProcContext {
            format,
            tx: sample_tx,
        });
        let mut io_proc_id: AudioDeviceIOProcID = None;
        let status = unsafe {
            AudioDeviceCreateIOProcID(
                aggregate_device,
                Some(io_proc),
                (&mut *io_context as *mut IoProcContext).cast::<c_void>(),
                &mut io_proc_id,
            )
        };
        if status != 0 {
            let _ = init_tx.send(Err(SystemAudioError::Capture(format!(
                "AudioDeviceCreateIOProcID failed with CoreAudio status {}",
                format_os_status(status)
            ))));
            return Ok(());
        }
        resources.io_proc_id = Some(io_proc_id);

        let status = unsafe { AudioDeviceStart(aggregate_device, io_proc_id) };
        if status != 0 {
            let _ = init_tx.send(Err(SystemAudioError::Capture(format!(
                "AudioDeviceStart failed with CoreAudio status {}",
                format_os_status(status)
            ))));
            return Ok(());
        }
        resources.started = true;

        if init_tx.send(Ok(())).is_err() {
            // Stop the device (via `resources`) before `io_context` is freed;
            // the IOProc holds a raw pointer to it.
            drop(resources);
            return Ok(());
        }

        let mut resampler = LoopbackFrameResampler::new(format.sample_rate);
        while !stop.load(Ordering::Relaxed) {
            match sample_rx.recv_timeout(DRAIN_INTERVAL) {
                Ok(samples) => {
                    let session_id = &session_id;
                    resampler.push(&samples, |frame_bytes| {
                        (sink)(AudioFrame {
                            frame_bytes,
                            session_id: session_id.clone(),
                        });
                    });
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        // Stop the device before `io_context` is freed; the IOProc holds a raw
        // pointer to it and can fire until AudioDeviceStop returns.
        drop(resources);
        drop(io_context);
        Ok(())
    }

    impl TapApi {
        fn resolve() -> Result<Self, SystemAudioError> {
            if AnyClass::get(c"CATapDescription").is_none() {
                return Err(macos_unsupported());
            }

            let create_process_tap =
                load_symbol::<CreateProcessTap>(c"AudioHardwareCreateProcessTap")
                    .ok_or_else(macos_unsupported)?;
            let destroy_process_tap =
                load_symbol::<DestroyProcessTap>(c"AudioHardwareDestroyProcessTap")
                    .ok_or_else(macos_unsupported)?;
            Ok(Self {
                create_process_tap,
                destroy_process_tap,
            })
        }
    }

    fn create_tap_description() -> Result<(Retained<AnyObject>, String), SystemAudioError> {
        let tap_class = AnyClass::get(c"CATapDescription").ok_or_else(macos_unsupported)?;
        let excluded_processes = NSArray::<AnyObject>::from_slice(&[]);
        let allocated: *mut AnyObject = unsafe { msg_send![tap_class, alloc] };
        let initialized: *mut AnyObject = unsafe {
            msg_send![
                allocated,
                initMonoGlobalTapButExcludeProcesses: &*excluded_processes
            ]
        };
        let tap_description = unsafe { Retained::from_raw(initialized) }.ok_or_else(|| {
            SystemAudioError::Capture("CATapDescription initialization returned null".into())
        })?;

        let name = NSString::from_str("Local Dictation System Audio");
        unsafe {
            let _: () = msg_send![&*tap_description, setName: &*name];
            let _: () = msg_send![&*tap_description, setPrivate: true];
        }

        let uuid: Retained<NSUUID> = unsafe { msg_send![&*tap_description, UUID] };
        let uuid_string: Retained<NSString> = unsafe { msg_send![&*uuid, UUIDString] };

        Ok((tap_description, uuid_string.to_string()))
    }

    fn probe_tap_permission(tap_id: AudioObjectID) -> Result<(), SystemAudioError> {
        let address = tap_property_address(K_AUDIO_TAP_PROPERTY_DESCRIPTION);
        let mut description: *mut c_void = ptr::null_mut();
        let mut data_size = mem::size_of::<*mut c_void>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                tap_id,
                &address,
                0,
                ptr::null(),
                &mut data_size,
                (&mut description as *mut *mut c_void).cast::<c_void>(),
            )
        };
        if status != 0 || description.is_null() {
            return Err(SystemAudioError::PermissionDenied);
        }
        // The get is a Copy-rule +1 reference; hand it to `Retained` so it is
        // released when the probe returns.
        let _description = unsafe { Retained::from_raw(description.cast::<AnyObject>()) };

        let status = unsafe {
            AudioObjectSetPropertyData(
                tap_id,
                &address,
                0,
                ptr::null(),
                data_size,
                (&description as *const *mut c_void).cast::<c_void>(),
            )
        };
        if status != 0 {
            return Err(SystemAudioError::PermissionDenied);
        }

        Ok(())
    }

    fn create_aggregate_description(
        tap_uid: String,
    ) -> Retained<NSDictionary<NSString, AnyObject>> {
        let description = aggregate_device_description(uuid::Uuid::new_v4().to_string(), tap_uid);
        let tap_uid = NSString::from_str(&description.tap_uid);
        let drift_compensation = NSNumber::new_bool(description.drift_compensation);
        let tap_entry = NSDictionary::<NSString, AnyObject>::from_slices(
            &[
                &*NSString::from_str(K_AUDIO_SUB_TAP_UID_KEY),
                &*NSString::from_str(K_AUDIO_SUB_TAP_DRIFT_COMPENSATION_KEY),
            ],
            &[&*tap_uid, &*drift_compensation],
        );
        let tap_list = NSArray::<NSDictionary<NSString, AnyObject>>::from_slice(&[&*tap_entry]);
        let name = NSString::from_str(description.name);
        let uid = NSString::from_str(&description.uid);
        let is_private = NSNumber::new_bool(description.is_private);
        let tap_auto_start = NSNumber::new_bool(description.tap_auto_start);

        NSDictionary::<NSString, AnyObject>::from_slices(
            &[
                &*NSString::from_str(K_AUDIO_AGGREGATE_DEVICE_NAME_KEY),
                &*NSString::from_str(K_AUDIO_AGGREGATE_DEVICE_UID_KEY),
                &*NSString::from_str(K_AUDIO_AGGREGATE_DEVICE_IS_PRIVATE_KEY),
                &*NSString::from_str(K_AUDIO_AGGREGATE_DEVICE_TAP_LIST_KEY),
                &*NSString::from_str(K_AUDIO_AGGREGATE_DEVICE_TAP_AUTO_START_KEY),
            ],
            &[&*name, &*uid, &*is_private, &*tap_list, &*tap_auto_start],
        )
    }

    fn read_tap_format(tap_id: AudioObjectID) -> Result<MacLoopbackFormat, SystemAudioError> {
        let address = tap_property_address(K_AUDIO_TAP_PROPERTY_FORMAT);
        let mut asbd = AudioStreamBasicDescription {
            m_sample_rate: 0.0,
            m_format_id: 0,
            m_format_flags: 0,
            m_bytes_per_packet: 0,
            m_frames_per_packet: 0,
            m_bytes_per_frame: 0,
            m_channels_per_frame: 0,
            m_bits_per_channel: 0,
            m_reserved: 0,
        };
        let mut data_size = mem::size_of::<AudioStreamBasicDescription>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                tap_id,
                &address,
                0,
                ptr::null(),
                &mut data_size,
                (&mut asbd as *mut AudioStreamBasicDescription).cast::<c_void>(),
            )
        };
        os_status_result(
            status,
            "AudioObjectGetPropertyData(kAudioTapPropertyFormat)",
        )?;
        parse_tap_format(&asbd)
    }

    unsafe extern "C" fn io_proc(
        _device: AudioObjectID,
        _now: *const c_void,
        input_data: *const AudioBufferList,
        _input_time: *const c_void,
        _output_data: *mut AudioBufferList,
        _output_time: *const c_void,
        client_data: *mut c_void,
    ) -> OSStatus {
        if client_data.is_null() || input_data.is_null() {
            return 0;
        }

        let context = unsafe { &*(client_data.cast::<IoProcContext>()) };
        let samples = unsafe { collect_mono_samples(input_data, context.format) };
        if !samples.is_empty() {
            let _ = context.tx.try_send(samples);
        }

        0
    }

    unsafe fn collect_mono_samples(
        input_data: *const AudioBufferList,
        format: MacLoopbackFormat,
    ) -> Vec<f32> {
        // Read through raw pointers: the list's trailing buffer array is
        // variable-length, so a `&AudioBufferList` reference (declared with one
        // buffer) must not be used to reach later entries.
        let buffers = unsafe { (&raw const (*input_data).m_buffers).cast::<AudioBuffer>() };
        let buffer_count = unsafe { (*input_data).m_number_buffers } as usize;

        if format.non_interleaved {
            unsafe { collect_non_interleaved_mono(buffers, buffer_count) }
        } else {
            unsafe { collect_interleaved_mono(buffers, buffer_count, format.channels) }
        }
    }

    unsafe fn collect_interleaved_mono(
        buffers: *const AudioBuffer,
        buffer_count: usize,
        channels: usize,
    ) -> Vec<f32> {
        if channels == 0 {
            return Vec::new();
        }

        let mut mono = Vec::new();
        for buffer_index in 0..buffer_count {
            let buffer = unsafe { &*buffers.add(buffer_index) };
            if buffer.m_data.is_null() {
                continue;
            }

            let sample_count = buffer.m_data_byte_size as usize / mem::size_of::<f32>();
            let samples =
                unsafe { std::slice::from_raw_parts(buffer.m_data.cast::<f32>(), sample_count) };
            // Reserve up front: this runs on the real-time IOProc thread, where
            // geometric Vec growth means repeated reallocations per callback.
            mono.reserve(sample_count / channels);
            for frame in samples.chunks_exact(channels) {
                mono.push(frame.iter().sum::<f32>() / channels as f32);
            }
        }
        mono
    }

    unsafe fn collect_non_interleaved_mono(
        buffers: *const AudioBuffer,
        buffer_count: usize,
    ) -> Vec<f32> {
        let mut channel_slices: Vec<&[f32]> = Vec::with_capacity(buffer_count);
        for buffer_index in 0..buffer_count {
            let buffer = unsafe { &*buffers.add(buffer_index) };
            if buffer.m_data.is_null() {
                continue;
            }
            let sample_count = buffer.m_data_byte_size as usize / mem::size_of::<f32>();
            channel_slices.push(unsafe {
                std::slice::from_raw_parts(buffer.m_data.cast::<f32>(), sample_count)
            });
        }

        let Some(frame_count) = channel_slices.iter().map(|samples| samples.len()).min() else {
            return Vec::new();
        };
        if frame_count == 0 {
            return Vec::new();
        }

        let mut mono = Vec::with_capacity(frame_count);
        for frame_index in 0..frame_count {
            let sum = channel_slices
                .iter()
                .map(|samples| samples[frame_index])
                .sum::<f32>();
            mono.push(sum / channel_slices.len() as f32);
        }
        mono
    }

    /// Resolve one dynamically-loaded CoreAudio entry point. Returns `None`
    /// when the symbol is absent (macOS < 14.2).
    ///
    /// `T` must be the matching `unsafe extern "C" fn` pointer type.
    fn load_symbol<T: Copy>(name: &CStr) -> Option<T> {
        let symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
        (!symbol.is_null()).then(|| unsafe { mem::transmute_copy::<*mut c_void, T>(&symbol) })
    }

    fn macos_unsupported() -> SystemAudioError {
        SystemAudioError::Capture(MACOS_UNSUPPORTED_MESSAGE.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn float_asbd(
        rate: f64,
        channels: u32,
        flags: AudioFormatFlags,
    ) -> AudioStreamBasicDescription {
        AudioStreamBasicDescription {
            m_sample_rate: rate,
            m_format_id: K_AUDIO_FORMAT_LINEAR_PCM,
            m_format_flags: K_AUDIO_FORMAT_FLAG_IS_FLOAT | K_AUDIO_FORMAT_FLAG_IS_PACKED | flags,
            m_bytes_per_packet: channels * 4,
            m_frames_per_packet: 1,
            m_bytes_per_frame: channels * 4,
            m_channels_per_frame: channels,
            m_bits_per_channel: 32,
            m_reserved: 0,
        }
    }

    #[test]
    fn parse_tap_format_accepts_packed_float_pcm() {
        let format = parse_tap_format(&float_asbd(48_000.0, 1, 0)).expect("format should parse");

        assert_eq!(
            format,
            MacLoopbackFormat {
                sample_rate: 48_000,
                channels: 1,
                non_interleaved: false,
            }
        );
    }

    #[test]
    fn parse_tap_format_preserves_non_interleaved_layout() {
        let format = parse_tap_format(&float_asbd(
            44_100.0,
            2,
            K_AUDIO_FORMAT_FLAG_IS_NON_INTERLEAVED,
        ))
        .expect("format should parse");

        assert_eq!(format.sample_rate, 44_100);
        assert_eq!(format.channels, 2);
        assert!(format.non_interleaved);
    }

    #[test]
    fn parse_tap_format_rejects_zero_channels() {
        let error =
            parse_tap_format(&float_asbd(48_000.0, 0, 0)).expect_err("zero channels should fail");

        assert!(error.message().contains("unsupported tap format"));
    }

    #[test]
    fn aggregate_description_is_private_tap_only_and_does_not_auto_start() {
        let description =
            aggregate_device_description("device-uid".to_string(), "tap-uid".to_string());

        assert_eq!(
            description,
            AggregateDeviceDescription {
                name: "Local Dictation System Audio",
                uid: "device-uid".to_string(),
                is_private: true,
                tap_auto_start: false,
                tap_uid: "tap-uid".to_string(),
                drift_compensation: true,
            }
        );
    }

    #[test]
    fn tap_property_address_uses_global_main_scope() {
        let address = tap_property_address(K_AUDIO_TAP_PROPERTY_FORMAT);

        assert_eq!(address.m_selector, K_AUDIO_TAP_PROPERTY_FORMAT);
        assert_eq!(address.m_scope, K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL);
        assert_eq!(address.m_element, K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN);
    }

    #[test]
    fn os_status_formatter_decodes_four_character_codes() {
        assert_eq!(format_os_status(0x7768_6174), "'what' (2003329396)");
        assert_eq!(format_os_status(-1), "-1");
    }
}
