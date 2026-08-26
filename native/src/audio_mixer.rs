use std::collections::VecDeque;
use std::sync::Arc;

use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};

use crate::protocol::{PCM_BYTES_PER_FRAME, PCM_SAMPLE_RATE_HZ, PCM_SAMPLES_PER_FRAME};

const SYSTEM_FRAME_BUFFER_LIMIT: usize = 4;
const LEVEL_BANDS: usize = 6;

/// Max-abs-sample threshold (raw i16 units) at or below which a system-audio
/// frame counts as silent. A few LSBs of noise-floor dither still count as
/// silence — this is what distinguishes "the stream delivers digital
/// silence" (idle/wrong monitor sink) from real captured audio.
const SILENT_SAMPLE_THRESHOLD: i16 = 8;

/// Log-spaced speech band edges in Hz, mirroring the renderer's former
/// AnalyserNode tap. Six bands span 80 Hz – 8 kHz (the 16 kHz capture Nyquist).
const BAND_EDGES_HZ: [f32; LEVEL_BANDS + 1] = [80.0, 200.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0];

/// dB compander window applied per FFT bin before band averaging. `MIN_DB`
/// doubles as a noise gate (idle room tone maps to 0); `MAX_DB` sets where a
/// bin reaches full scale ahead of the renderer-side AGC. Matches the old tap.
const MIN_DB: f32 = -60.0;
const MAX_DB: f32 = -30.0;

#[derive(Debug, Clone, PartialEq)]
pub struct MixedAudioFrame {
    pub frame_bytes: Vec<u8>,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioMixerError {
    pub actual_bytes: usize,
    pub expected_bytes: usize,
}

/// Per-session system-audio delivery health, snapshotted at session
/// teardown. `silent` ≈ `received` means the monitor is capturing an idle or
/// wrong sink; high `dropped` with high `mic_only` means bursty delivery
/// (frames arriving in bunches too late to be mixed in).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemAudioDiagnostics {
    pub system_frames_received: u64,
    pub silent_system_frames: u64,
    pub system_frames_dropped: u64,
    pub mixed_ticks: u64,
    pub mic_only_ticks: u64,
}

pub struct AudioMixer {
    analyzer: LevelAnalyzer,
    include_system_audio: bool,
    session_id: String,
    system_frames: VecDeque<Vec<u8>>,
    system_frames_received: u64,
    silent_system_frames: u64,
    system_frames_dropped: u64,
    mixed_ticks: u64,
    mic_only_ticks: u64,
}

impl AudioMixer {
    pub fn microphone_only(session_id: impl Into<String>) -> Self {
        Self {
            analyzer: LevelAnalyzer::new(),
            include_system_audio: false,
            session_id: session_id.into(),
            system_frames: VecDeque::new(),
            system_frames_received: 0,
            silent_system_frames: 0,
            system_frames_dropped: 0,
            mixed_ticks: 0,
            mic_only_ticks: 0,
        }
    }

    pub fn microphone_with_system(session_id: impl Into<String>) -> Self {
        Self {
            analyzer: LevelAnalyzer::new(),
            include_system_audio: true,
            session_id: session_id.into(),
            system_frames: VecDeque::new(),
            system_frames_received: 0,
            silent_system_frames: 0,
            system_frames_dropped: 0,
            mixed_ticks: 0,
            mic_only_ticks: 0,
        }
    }

    pub fn push_microphone_frame(
        &mut self,
        frame_bytes: Vec<u8>,
    ) -> Result<Option<MixedAudioFrame>, AudioMixerError> {
        validate_frame(&frame_bytes)?;

        let mixed = if self.include_system_audio {
            match self.system_frames.pop_front() {
                Some(system_frame) => {
                    self.mixed_ticks += 1;
                    mix_frames(&frame_bytes, &system_frame)
                }
                None => {
                    self.mic_only_ticks += 1;
                    frame_bytes
                }
            }
        } else {
            frame_bytes
        };

        Ok(Some(self.build_output(mixed)))
    }

    pub fn push_system_frame(
        &mut self,
        frame_bytes: Vec<u8>,
    ) -> Result<Option<MixedAudioFrame>, AudioMixerError> {
        validate_frame(&frame_bytes)?;

        if self.include_system_audio {
            self.system_frames_received += 1;
            if is_silent_frame(&frame_bytes) {
                self.silent_system_frames += 1;
            }
            if self.system_frames.len() >= SYSTEM_FRAME_BUFFER_LIMIT {
                self.system_frames.pop_front();
                self.system_frames_dropped += 1;
            }
            self.system_frames.push_back(frame_bytes);
        }

        Ok(None)
    }

    pub fn clear(&mut self) {
        self.system_frames.clear();
    }

    /// Snapshot of system-audio delivery counters for this session, or
    /// `None` for microphone-only mixers where they aren't tracked.
    pub fn system_audio_diagnostics(&self) -> Option<SystemAudioDiagnostics> {
        if !self.include_system_audio {
            return None;
        }

        Some(SystemAudioDiagnostics {
            system_frames_received: self.system_frames_received,
            silent_system_frames: self.silent_system_frames,
            system_frames_dropped: self.system_frames_dropped,
            mixed_ticks: self.mixed_ticks,
            mic_only_ticks: self.mic_only_ticks,
        })
    }

    fn build_output(&self, frame_bytes: Vec<u8>) -> MixedAudioFrame {
        MixedAudioFrame {
            frame_bytes,
            session_id: self.session_id.clone(),
        }
    }

    /// Computes the six dB-companded spectral bands for an already-mixed frame.
    /// Called lazily — only when an audio-level event is actually due — so the
    /// per-frame mix path doesn't run an FFT it would just discard under the
    /// emission throttle.
    pub fn analyze_levels(&mut self, frame_bytes: &[u8]) -> [f32; LEVEL_BANDS] {
        self.analyzer.analyze(frame_bytes)
    }
}

fn validate_frame(frame_bytes: &[u8]) -> Result<(), AudioMixerError> {
    if frame_bytes.len() == PCM_BYTES_PER_FRAME {
        return Ok(());
    }

    Err(AudioMixerError {
        actual_bytes: frame_bytes.len(),
        expected_bytes: PCM_BYTES_PER_FRAME,
    })
}

/// True when every sample in the frame falls at or below the silence
/// threshold, i.e. the frame carries no meaningful audio.
fn is_silent_frame(frame_bytes: &[u8]) -> bool {
    frame_bytes.chunks_exact(2).all(|sample| {
        i16::from_le_bytes([sample[0], sample[1]]).unsigned_abs() <= SILENT_SAMPLE_THRESHOLD as u16
    })
}

fn mix_frames(microphone: &[u8], system: &[u8]) -> Vec<u8> {
    let mut mixed = Vec::with_capacity(PCM_BYTES_PER_FRAME);

    for (mic, sys) in microphone.chunks_exact(2).zip(system.chunks_exact(2)) {
        let mic_sample = i16::from_le_bytes([mic[0], mic[1]]) as i32;
        let system_sample = i16::from_le_bytes([sys[0], sys[1]]) as i32;
        let sample = ((mic_sample + system_sample) / 2).clamp(i16::MIN as i32, i16::MAX as i32);
        mixed.extend_from_slice(&(sample as i16).to_le_bytes());
    }

    mixed
}

/// Per-frame frequency analyzer: a windowed real FFT split into six log-spaced
/// bands, each dB-companded to [0, 1]. This gives the renderer a perceptual,
/// spectrally-shaped signal for its per-band AGC to normalize — restoring the
/// independent per-bar motion the old client-side AnalyserNode tap produced,
/// now computed on the mixed (mic + system) stream the sidecar owns.
struct LevelAnalyzer {
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    input: Vec<f32>,
    spectrum: Vec<Complex<f32>>,
    band_bins: [(usize, usize); LEVEL_BANDS],
}

impl LevelAnalyzer {
    fn new() -> Self {
        let length = PCM_SAMPLES_PER_FRAME;
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(length);
        let spectrum = fft.make_output_vec();
        Self {
            fft,
            window: hann_window(length),
            input: vec![0.0; length],
            spectrum,
            band_bins: band_bin_ranges(length, PCM_SAMPLE_RATE_HZ),
        }
    }

    /// Returns the six dB-companded band magnitudes in [0, 1] for one frame.
    fn analyze(&mut self, frame_bytes: &[u8]) -> [f32; LEVEL_BANDS] {
        let length = self.input.len();

        for (index, sample_bytes) in frame_bytes.chunks_exact(2).take(length).enumerate() {
            let sample =
                i16::from_le_bytes([sample_bytes[0], sample_bytes[1]]) as f32 / i16::MAX as f32;
            self.input[index] = sample * self.window[index];
        }

        self.fft
            .process(&mut self.input, &mut self.spectrum)
            .expect("frame length matches the planned FFT length");

        let mut bands = [0.0_f32; LEVEL_BANDS];
        for (band, &(lo, hi)) in self.band_bins.iter().enumerate() {
            let mut sum = 0.0_f32;
            for bin in lo..hi {
                let c = self.spectrum[bin];
                let magnitude = (c.re * c.re + c.im * c.im).sqrt() / length as f32;
                let decibels = if magnitude > 0.0 {
                    20.0 * magnitude.log10()
                } else {
                    MIN_DB
                };
                sum += ((decibels - MIN_DB) / (MAX_DB - MIN_DB)).clamp(0.0, 1.0);
            }
            bands[band] = sum / (hi - lo) as f32;
        }

        bands
    }
}

fn hann_window(length: usize) -> Vec<f32> {
    (0..length)
        .map(|index| {
            let phase = 2.0 * std::f32::consts::PI * index as f32 / length as f32;
            0.5 - 0.5 * phase.cos()
        })
        .collect()
}

/// Maps each band's [lo, hi) Hz edge to a half-open FFT bin range, clamped to
/// the usable one-sided spectrum. Mirrors the old renderer band layout.
fn band_bin_ranges(length: usize, sample_rate: usize) -> [(usize, usize); LEVEL_BANDS] {
    let bin_count = length / 2 + 1;
    let hz_per_bin = sample_rate as f32 / length as f32;
    let mut ranges = [(0_usize, 0_usize); LEVEL_BANDS];
    for (band, range) in ranges.iter_mut().enumerate() {
        let lo = ((BAND_EDGES_HZ[band] / hz_per_bin).floor() as usize).max(1);
        let hi = ((BAND_EDGES_HZ[band + 1] / hz_per_bin).floor() as usize)
            .max(lo + 1)
            .min(bin_count);
        *range = (lo, hi);
    }
    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame_bytes_from_sample(sample: i16) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(PCM_BYTES_PER_FRAME);
        for _ in 0..PCM_SAMPLES_PER_FRAME {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn microphone_only_mixer_reports_no_diagnostics() {
        let mut mixer = AudioMixer::microphone_only("session-1");

        mixer
            .push_microphone_frame(frame_bytes_from_sample(100))
            .expect("valid frame");

        assert_eq!(mixer.system_audio_diagnostics(), None);
    }

    #[test]
    fn push_system_frame_counts_received_and_silent() {
        let mut mixer = AudioMixer::microphone_with_system("session-1");

        mixer
            .push_system_frame(frame_bytes_from_sample(0))
            .expect("valid frame");
        mixer
            .push_system_frame(frame_bytes_from_sample(SILENT_SAMPLE_THRESHOLD))
            .expect("valid frame");
        mixer
            .push_system_frame(frame_bytes_from_sample(SILENT_SAMPLE_THRESHOLD + 1))
            .expect("valid frame");

        let diagnostics = mixer
            .system_audio_diagnostics()
            .expect("system-audio mixer reports diagnostics");
        assert_eq!(diagnostics.system_frames_received, 3);
        assert_eq!(diagnostics.silent_system_frames, 2);
        assert_eq!(diagnostics.system_frames_dropped, 0);
    }

    #[test]
    fn push_system_frame_counts_ring_overflow_as_dropped() {
        let mut mixer = AudioMixer::microphone_with_system("session-1");

        for _ in 0..(SYSTEM_FRAME_BUFFER_LIMIT + 2) {
            mixer
                .push_system_frame(frame_bytes_from_sample(100))
                .expect("valid frame");
        }

        let diagnostics = mixer
            .system_audio_diagnostics()
            .expect("system-audio mixer reports diagnostics");
        assert_eq!(
            diagnostics.system_frames_received,
            SYSTEM_FRAME_BUFFER_LIMIT as u64 + 2
        );
        assert_eq!(diagnostics.system_frames_dropped, 2);
    }

    #[test]
    fn push_microphone_frame_counts_mixed_and_mic_only_ticks() {
        let mut mixer = AudioMixer::microphone_with_system("session-1");

        // No queued system frame: this tick is mic-only.
        mixer
            .push_microphone_frame(frame_bytes_from_sample(100))
            .expect("valid frame");

        // Queue a system frame, then consume it on the next mic tick: mixed.
        mixer
            .push_system_frame(frame_bytes_from_sample(100))
            .expect("valid frame");
        mixer
            .push_microphone_frame(frame_bytes_from_sample(100))
            .expect("valid frame");

        let diagnostics = mixer
            .system_audio_diagnostics()
            .expect("system-audio mixer reports diagnostics");
        assert_eq!(diagnostics.mic_only_ticks, 1);
        assert_eq!(diagnostics.mixed_ticks, 1);
    }
}
