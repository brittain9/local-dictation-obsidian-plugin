//! Windows WASAPI loopback capture of the default audio render endpoint.
//!
//! Opening the default *Render* device and initializing its [`AudioClient`]
//! for [`Direction::Capture`] in shared mode makes `wasapi` set
//! `AUDCLNT_STREAMFLAGS_LOOPBACK` internally, which is how WASAPI exposes a
//! read-only copy of everything the device is playing. Loopback is
//! incompatible with event-driven mode, so this uses
//! [`StreamMode::PollingShared`] and polls on a short sleep.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use wasapi::{Direction, SampleType, StreamMode, WaveFormat, initialize_mta};

use super::{AudioFrameSink, CaptureHandle, LoopbackFrameResampler, SystemAudioError};
use crate::protocol::AudioFrame;

const POLL_INTERVAL: Duration = Duration::from_millis(5);
const INIT_TIMEOUT: Duration = Duration::from_secs(10);

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
        Err(_) => Err(SystemAudioError::Capture(
            "timed out opening the audio device".into(),
        )),
    }
}

fn capture_thread(
    session_id: String,
    sink: AudioFrameSink,
    stop: Arc<AtomicBool>,
    init_tx: mpsc::Sender<Result<(), SystemAudioError>>,
) {
    // Tolerate COM already being initialized (e.g. in a different mode) on
    // this thread; only a hard failure should abort capture.
    let _ = initialize_mta();

    let setup = open_loopback_client();
    let (client, capture, format) = match setup {
        Ok(parts) => parts,
        Err(error) => {
            let _ = init_tx.send(Err(error));
            return;
        }
    };

    let sample_rate = format.get_samplespersec();
    let channels = format.get_nchannels() as usize;
    let bits_per_sample = format.get_bitspersample() as usize;
    let block_align = (bits_per_sample / 8) * channels;
    let sample_type = match format.get_subformat() {
        Ok(sample_type) => sample_type,
        Err(error) => {
            let _ = init_tx.send(Err(SystemAudioError::Capture(format!(
                "unsupported device format: {error}"
            ))));
            return;
        }
    };

    if let Err(error) = client.start_stream() {
        let _ = init_tx.send(Err(SystemAudioError::Capture(format!("{error}"))));
        return;
    }

    if init_tx.send(Ok(())).is_err() {
        let _ = client.stop_stream();
        return;
    }

    let mut resampler = LoopbackFrameResampler::new(sample_rate);
    let mut queue: VecDeque<u8> = VecDeque::new();
    let mut mono_samples: Vec<f32> = Vec::new();

    while !stop.load(Ordering::Relaxed) {
        if let Err(error) = capture.read_from_device_to_deque(&mut queue) {
            eprintln!("system-audio capture: failed to read from device: {error}");
            break;
        }

        mono_samples.clear();
        while queue.len() >= block_align {
            let mut channel_sum = 0.0_f32;
            for channel in 0..channels {
                let offset = channel * (bits_per_sample / 8);
                channel_sum += decode_sample(&queue, offset, bits_per_sample, sample_type);
            }
            mono_samples.push(channel_sum / channels as f32);

            for _ in 0..block_align {
                queue.pop_front();
            }
        }

        if !mono_samples.is_empty() {
            let session_id = &session_id;
            resampler.push(&mono_samples, |frame_bytes| {
                (sink)(AudioFrame {
                    frame_bytes,
                    session_id: session_id.clone(),
                });
            });
        }

        thread::sleep(POLL_INTERVAL);
    }

    let _ = client.stop_stream();
}

/// Opens the default render device's audio client in loopback-capture mode
/// and returns it along with a capture client and the negotiated mix format.
fn open_loopback_client()
-> Result<(wasapi::AudioClient, wasapi::AudioCaptureClient, WaveFormat), SystemAudioError> {
    let enumerator =
        wasapi::DeviceEnumerator::new().map_err(|e| SystemAudioError::Capture(format!("{e}")))?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|e| SystemAudioError::Capture(format!("{e}")))?;
    let mut client = device
        .get_iaudioclient()
        .map_err(|e| SystemAudioError::Capture(format!("{e}")))?;

    let format = client
        .get_mixformat()
        .map_err(|e| SystemAudioError::Capture(format!("{e}")))?;

    // Validate the sample type/bit depth up front so unsupported formats
    // surface as a clear error rather than producing garbage audio.
    let sample_type = format
        .get_subformat()
        .map_err(|e| SystemAudioError::Capture(format!("unsupported device format: {e}")))?;
    let bits_per_sample = format.get_bitspersample();
    match (sample_type, bits_per_sample) {
        (SampleType::Float, 32) | (SampleType::Int, 16) | (SampleType::Int, 32) => {}
        (sample_type, bits_per_sample) => {
            return Err(SystemAudioError::Capture(format!(
                "unsupported device format: {sample_type} {bits_per_sample}-bit"
            )));
        }
    }

    let (def_period, _min_period) = client
        .get_device_period()
        .map_err(|e| SystemAudioError::Capture(format!("{e}")))?;

    client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::PollingShared {
                autoconvert: false,
                buffer_duration_hns: def_period,
            },
        )
        .map_err(|e| SystemAudioError::Capture(format!("{e}")))?;

    let capture = client
        .get_audiocaptureclient()
        .map_err(|e| SystemAudioError::Capture(format!("{e}")))?;

    Ok((client, capture, format))
}

/// Decode one sample for one channel at `byte_offset` within `queue`'s front,
/// returning it as a normalized f32 in `[-1.0, 1.0]`.
fn decode_sample(
    queue: &VecDeque<u8>,
    byte_offset: usize,
    bits_per_sample: usize,
    sample_type: SampleType,
) -> f32 {
    match (sample_type, bits_per_sample) {
        (SampleType::Float, 32) => {
            let bytes = read_bytes::<4>(queue, byte_offset);
            f32::from_le_bytes(bytes)
        }
        (SampleType::Int, 16) => {
            let bytes = read_bytes::<2>(queue, byte_offset);
            i16::from_le_bytes(bytes) as f32 / 0x8000 as f32
        }
        (SampleType::Int, 32) => {
            let bytes = read_bytes::<4>(queue, byte_offset);
            i32::from_le_bytes(bytes) as f32 / 0x8000_0000_u32 as f32
        }
        _ => 0.0,
    }
}

fn read_bytes<const N: usize>(queue: &VecDeque<u8>, byte_offset: usize) -> [u8; N] {
    let mut bytes = [0_u8; N];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = queue[byte_offset + i];
    }
    bytes
}
