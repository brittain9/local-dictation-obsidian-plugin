//! Kaldi-compatible 80-bin log-Mel filterbank features.
//!
//! The bundled speaker-embedding model consumes the same front-end the
//! WeSpeaker/3D-Speaker recipes use: 16 kHz mono audio, 25 ms frames every
//! 10 ms, a Povey window, DC removal, pre-emphasis, an 80-bin Mel filterbank
//! over the power spectrum, a natural log, and per-utterance cepstral mean
//! normalisation (mean subtraction across frames). Matching this layout keeps
//! the embeddings close to the model's training distribution.

use std::sync::Arc;

use ndarray::Array2;
use realfft::{RealFftPlanner, RealToComplex};

const SAMPLE_RATE: f32 = 16_000.0;
/// 25 ms at 16 kHz.
const FRAME_LENGTH: usize = 400;
/// 10 ms at 16 kHz.
const FRAME_SHIFT: usize = 160;
/// Smallest power of two that holds a frame.
const FFT_SIZE: usize = 512;
const NUM_FFT_BINS: usize = FFT_SIZE / 2 + 1;
/// Mel filterbank dimensionality the model expects.
pub const NUM_MEL_BINS: usize = 80;

const PREEMPHASIS: f32 = 0.97;
const LOW_FREQ: f32 = 20.0;
const HIGH_FREQ: f32 = SAMPLE_RATE / 2.0;
/// Floor applied to Mel energies before the log, matching Kaldi's use of the
/// f32 epsilon so silent frames do not produce negative infinities.
const ENERGY_FLOOR: f32 = f32::EPSILON;

/// Kaldi/HTK Mel scale.
fn hz_to_mel(freq: f32) -> f32 {
    1127.0 * (1.0 + freq / 700.0).ln()
}

/// Reusable filterbank front-end. Construct once per session.
pub struct FbankComputer {
    window: Vec<f32>,
    /// Triangular Mel filters, `[NUM_MEL_BINS, NUM_FFT_BINS]`.
    mel_filters: Array2<f32>,
    fft: Arc<dyn RealToComplex<f32>>,
}

impl FbankComputer {
    pub fn new() -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        Self {
            window: povey_window(),
            mel_filters: mel_filterbank(),
            fft: planner.plan_fft_forward(FFT_SIZE),
        }
    }

    /// Compute `[num_frames, NUM_MEL_BINS]` mean-normalised log-Mel features.
    /// Returns an empty array when the audio is shorter than one frame.
    pub fn compute(&self, samples: &[f32]) -> Array2<f32> {
        if samples.len() < FRAME_LENGTH {
            return Array2::zeros((0, NUM_MEL_BINS));
        }

        let num_frames = 1 + (samples.len() - FRAME_LENGTH) / FRAME_SHIFT;
        let mut feats = Array2::<f32>::zeros((num_frames, NUM_MEL_BINS));

        let mut frame = vec![0.0_f32; FFT_SIZE];
        let mut spectrum = self.fft.make_output_vec();

        for t in 0..num_frames {
            let start = t * FRAME_SHIFT;
            frame[..FRAME_LENGTH].copy_from_slice(&samples[start..start + FRAME_LENGTH]);
            for value in &mut frame[FRAME_LENGTH..] {
                *value = 0.0;
            }

            // DC removal over the raw frame.
            let mean = frame[..FRAME_LENGTH].iter().sum::<f32>() / FRAME_LENGTH as f32;
            for value in &mut frame[..FRAME_LENGTH] {
                *value -= mean;
            }

            // Pre-emphasis (Kaldi order: high indices first, edge uses itself).
            for i in (1..FRAME_LENGTH).rev() {
                frame[i] -= PREEMPHASIS * frame[i - 1];
            }
            frame[0] -= PREEMPHASIS * frame[0];

            for (value, &weight) in frame[..FRAME_LENGTH].iter_mut().zip(&self.window) {
                *value *= weight;
            }

            self.fft
                .process(&mut frame, &mut spectrum)
                .expect("real FFT input length matches the planned size");

            for m in 0..NUM_MEL_BINS {
                let energy: f32 = self
                    .mel_filters
                    .row(m)
                    .iter()
                    .zip(&spectrum)
                    .map(|(&weight, bin)| weight * bin.norm_sqr())
                    .sum();
                feats[[t, m]] = energy.max(ENERGY_FLOOR).ln();
            }
        }

        subtract_frame_mean(&mut feats);
        feats
    }
}

/// Per-utterance cepstral mean normalisation: subtract each Mel bin's mean
/// across all frames.
fn subtract_frame_mean(feats: &mut Array2<f32>) {
    let num_frames = feats.nrows();
    if num_frames == 0 {
        return;
    }
    for m in 0..NUM_MEL_BINS {
        let mean = feats.column(m).sum() / num_frames as f32;
        for t in 0..num_frames {
            feats[[t, m]] -= mean;
        }
    }
}

/// Povey window: a Hann window raised to the 0.85 power (Kaldi default).
fn povey_window() -> Vec<f32> {
    (0..FRAME_LENGTH)
        .map(|n| {
            let hann = 0.5
                - 0.5 * (2.0 * std::f32::consts::PI * n as f32 / (FRAME_LENGTH as f32 - 1.0)).cos();
            hann.powf(0.85)
        })
        .collect()
}

/// Triangular Mel filters laid out over the power-spectrum bins.
fn mel_filterbank() -> Array2<f32> {
    let mut filters = Array2::<f32>::zeros((NUM_MEL_BINS, NUM_FFT_BINS));
    let mel_low = hz_to_mel(LOW_FREQ);
    let mel_high = hz_to_mel(HIGH_FREQ);
    let mel_delta = (mel_high - mel_low) / (NUM_MEL_BINS as f32 + 1.0);

    for m in 0..NUM_MEL_BINS {
        let left = mel_low + m as f32 * mel_delta;
        let center = mel_low + (m as f32 + 1.0) * mel_delta;
        let right = mel_low + (m as f32 + 2.0) * mel_delta;

        for k in 0..NUM_FFT_BINS {
            let mel = hz_to_mel(k as f32 * SAMPLE_RATE / FFT_SIZE as f32);
            if mel > left && mel < right {
                filters[[m, k]] = if mel <= center {
                    (mel - left) / (center - left)
                } else {
                    (right - mel) / (right - center)
                };
            }
        }
    }
    filters
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, samples: usize) -> Vec<f32> {
        (0..samples)
            .map(|n| (2.0 * std::f32::consts::PI * freq * n as f32 / SAMPLE_RATE).sin() * 0.5)
            .collect()
    }

    #[test]
    fn frame_count_follows_snip_edges_formula() {
        let computer = FbankComputer::new();
        // 1 second of audio -> 1 + (16000 - 400) / 160 = 98 frames.
        let feats = computer.compute(&sine(220.0, 16_000));
        assert_eq!(feats.shape(), &[98, NUM_MEL_BINS]);
    }

    #[test]
    fn audio_shorter_than_a_frame_yields_no_frames() {
        let computer = FbankComputer::new();
        let feats = computer.compute(&sine(220.0, 100));
        assert_eq!(feats.shape(), &[0, NUM_MEL_BINS]);
    }

    #[test]
    fn computation_is_deterministic() {
        let computer = FbankComputer::new();
        let audio = sine(300.0, 8_000);
        assert_eq!(computer.compute(&audio), computer.compute(&audio));
    }

    #[test]
    fn mean_normalisation_zeroes_each_bin_mean() {
        let computer = FbankComputer::new();
        let feats = computer.compute(&sine(440.0, 8_000));
        for m in 0..NUM_MEL_BINS {
            let mean = feats.column(m).sum() / feats.nrows() as f32;
            assert!(mean.abs() < 1e-4, "bin {m} mean not centered: {mean}");
        }
    }

    #[test]
    fn distinct_tones_produce_distinct_features() {
        let computer = FbankComputer::new();
        let low = computer.compute(&sine(150.0, 8_000));
        let high = computer.compute(&sine(3_000.0, 8_000));
        let diff: f32 = (&low - &high).iter().map(|v| v.abs()).sum();
        assert!(diff > 1.0, "expected tones to differ, got {diff}");
    }
}
