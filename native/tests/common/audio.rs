//! WAV fixture decoding and conversion into the sidecar's PCM frame format.
//!
//! The sidecar consumes 16 kHz, mono, 16-bit little-endian PCM split into
//! fixed 20 ms frames (`PCM_BYTES_PER_FRAME`). Fixtures are committed already in
//! that sample format (see `tests/fixtures/README.md`), so decoding is just a
//! validated read plus framing — no resampling.

use std::path::Path;

use local_dictation_sidecar::protocol::{
    PCM_BYTES_PER_FRAME, PCM_SAMPLE_RATE_HZ, PCM_SAMPLES_PER_FRAME,
};

/// Number of trailing silence frames appended after a clip's real audio so the
/// VAD observes an end-of-speech gap and finalizes the utterance naturally.
/// 75 frames = 1.5 s, comfortably past the `Balanced` preset's 1 s
/// (`silence_end_frames`) threshold with margin for the `Patient` preset's 2 s.
pub const TRAILING_SILENCE_FRAMES: usize = 100;

/// Decode a committed WAV fixture into i16 PCM samples, asserting the on-disk
/// format matches what the sidecar expects (16 kHz / mono / 16-bit). Returns a
/// descriptive error rather than panicking so callers control failure context.
pub fn decode_wav_16k_mono(path: &Path) -> Result<Vec<i16>, String> {
    let reader = hound::WavReader::open(path)
        .map_err(|error| format!("failed to open WAV {}: {error}", path.display()))?;
    let spec = reader.spec();

    if spec.sample_rate as usize != PCM_SAMPLE_RATE_HZ {
        return Err(format!(
            "{}: expected {PCM_SAMPLE_RATE_HZ} Hz, found {} Hz",
            path.display(),
            spec.sample_rate
        ));
    }
    if spec.channels != 1 {
        return Err(format!(
            "{}: expected mono, found {} channels",
            path.display(),
            spec.channels
        ));
    }
    if spec.bits_per_sample != 16 || spec.sample_format != hound::SampleFormat::Int {
        return Err(format!(
            "{}: expected 16-bit integer PCM, found {}-bit {:?}",
            path.display(),
            spec.bits_per_sample,
            spec.sample_format
        ));
    }

    let mut reader = reader;
    reader
        .samples::<i16>()
        .collect::<Result<Vec<i16>, _>>()
        .map_err(|error| format!("failed to read samples from {}: {error}", path.display()))
}

/// Split i16 samples into the sidecar's fixed-size 20 ms PCM frames. A trailing
/// partial frame (clips are rarely an exact multiple of 320 samples) is
/// zero-padded to a full frame so it satisfies the protocol's strict size check.
pub fn samples_to_frames(samples: &[i16]) -> Vec<Vec<u8>> {
    let mut frames = Vec::with_capacity(samples.len().div_ceil(PCM_SAMPLES_PER_FRAME));

    for chunk in samples.chunks(PCM_SAMPLES_PER_FRAME) {
        let mut frame = Vec::with_capacity(PCM_BYTES_PER_FRAME);
        for &sample in chunk {
            frame.extend_from_slice(&sample.to_le_bytes());
        }
        frame.resize(PCM_BYTES_PER_FRAME, 0);
        frames.push(frame);
    }

    frames
}

/// `count` frames of digital silence (all-zero PCM).
pub fn silence_frames(count: usize) -> Vec<Vec<u8>> {
    vec![vec![0_u8; PCM_BYTES_PER_FRAME]; count]
}

/// Real audio frames for a fixture followed by [`TRAILING_SILENCE_FRAMES`] of
/// silence — the exact byte stream a renderer would feed for one spoken clip
/// followed by the speaker going quiet.
pub fn fixture_frames_with_trailing_silence(samples: &[i16]) -> Vec<Vec<u8>> {
    let mut frames = samples_to_frames(samples);
    frames.extend(silence_frames(TRAILING_SILENCE_FRAMES));
    frames
}
