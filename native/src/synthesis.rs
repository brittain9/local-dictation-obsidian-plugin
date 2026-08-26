use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SynthesisError {
    pub code: &'static str,
    pub message: String,
    pub details: Option<String>,
}

impl SynthesisError {
    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_synthesis_request",
            message: message.into(),
            details: None,
        }
    }

    pub fn invalid_model(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_model_file",
            message: "The selected read-aloud model is invalid.".to_string(),
            details: Some(message.into()),
        }
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "unsupported_engine",
            message: message.into(),
            details: None,
        }
    }

    pub fn inference(operation: &str, error: impl std::fmt::Display) -> Self {
        Self {
            code: "synthesis_failed",
            message: "Local speech synthesis failed.".to_string(),
            details: Some(format!("{operation}: {error}")),
        }
    }

    pub fn cancelled() -> Self {
        Self {
            code: "synthesis_cancelled",
            message: "Speech synthesis was cancelled.".to_string(),
            details: None,
        }
    }
}

impl std::fmt::Display for SynthesisError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.details {
            Some(details) => write!(formatter, "{}: {details}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

impl std::error::Error for SynthesisError {}

#[derive(Debug, Clone)]
pub struct SynthesisCancellation(Arc<AtomicBool>);

impl SynthesisCancellation {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

impl Default for SynthesisCancellation {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SynthesisPcm {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

pub trait SynthesisModel: Send {
    fn synthesize(
        &mut self,
        text: &str,
        language: &str,
        voice_path: &Path,
        cancellation: &SynthesisCancellation,
    ) -> Result<SynthesisPcm, SynthesisError>;
}

/// Pitch-preserving waveform-similarity overlap-add. Each synthesis text chunk
/// is processed independently, which bounds memory and avoids sharing temporal
/// state across source ranges while preserving vocal pitch at non-1x speeds.
pub fn time_stretch(samples: &[f32], speed: f32, sample_rate: u32) -> Vec<f32> {
    if samples.is_empty() || (speed - 1.0).abs() < 0.001 {
        return samples.to_vec();
    }
    let speed = speed.clamp(0.75, 2.0);
    let frame = (sample_rate as usize * 40 / 1_000).max(64);
    let overlap = (sample_rate as usize * 10 / 1_000).max(16);
    if samples.len() <= frame + overlap {
        return samples.to_vec();
    }
    let synthesis_hop = frame - overlap;
    let analysis_hop = synthesis_hop as f32 * speed;
    let search = (sample_rate as usize * 5 / 1_000).max(8);
    let target_len = ((samples.len() as f32) / speed).round() as usize;
    let mut output = Vec::with_capacity(target_len + frame);
    output.extend_from_slice(&samples[..frame]);
    let mut analysis_position = analysis_hop;

    while output.len() < target_len {
        let expected = (analysis_position.round() as usize).min(samples.len() - frame);
        let tail_start = output.len() - overlap;
        let tail = &output[tail_start..];
        let lower = expected.saturating_sub(search);
        let upper = (expected + search).min(samples.len() - frame);
        let mut best = expected;
        let mut best_score = f32::NEG_INFINITY;
        for candidate in lower..=upper {
            let score = normalized_correlation(tail, &samples[candidate..candidate + overlap]);
            if score > best_score {
                best_score = score;
                best = candidate;
            }
        }
        for offset in 0..overlap {
            let mix = offset as f32 / overlap as f32;
            output[tail_start + offset] =
                output[tail_start + offset] * (1.0 - mix) + samples[best + offset] * mix;
        }
        output.extend_from_slice(&samples[best + overlap..best + frame]);
        analysis_position += analysis_hop;
    }
    output.truncate(target_len.min(output.len()));
    output
}

fn normalized_correlation(left: &[f32], right: &[f32]) -> f32 {
    let mut dot = 0.0_f32;
    let mut left_energy = 0.0_f32;
    let mut right_energy = 0.0_f32;
    for (&a, &b) in left.iter().zip(right) {
        dot += a * b;
        left_energy += a * a;
        right_energy += b * b;
    }
    dot / (left_energy * right_energy).sqrt().max(1e-12)
}

pub fn pcm_f32_to_i16le(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let quantized = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        bytes.extend_from_slice(&quantized.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::{pcm_f32_to_i16le, time_stretch};

    #[test]
    fn time_stretch_preserves_pitch_and_target_duration_at_production_limits() {
        let sample_rate = 24_000_u32;
        let period = 120_usize;
        let samples = (0..sample_rate as usize)
            .map(|index| (std::f32::consts::TAU * index as f32 / period as f32).sin())
            .collect::<Vec<_>>();
        for speed in [0.75, 2.0] {
            let stretched = time_stretch(&samples, speed, sample_rate);
            let target_len = samples.len() as f32 / speed;
            let duration_error = (stretched.len() as f32 - target_len).abs() / target_len;
            assert!(
                duration_error <= 0.05,
                "{speed}x duration error {duration_error:.3} exceeded 5%"
            );
            let crossings = stretched
                .windows(2)
                .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
                .count();
            let measured_period = stretched.len() as f32 / crossings as f32;
            assert!(
                (measured_period - period as f32).abs() < 4.0,
                "{speed}x changed the measured period to {measured_period:.2} samples"
            );
        }
    }

    #[test]
    fn time_stretch_keeps_short_slow_voiced_audio_at_target_duration_and_pitch() {
        let sample_rate = 24_000_u32;
        let period = 120_usize;
        let samples = (0..(sample_rate as usize * 3 / 10))
            .map(|index| {
                let envelope = 1.0 + 0.8 * (std::f32::consts::TAU * index as f32 / 1_000.0).sin();
                envelope * (std::f32::consts::TAU * index as f32 / period as f32).sin()
            })
            .collect::<Vec<_>>();

        let stretched = time_stretch(&samples, 0.75, sample_rate);
        let target_len = (samples.len() as f32 / 0.75).round() as usize;
        assert_eq!(stretched.len(), target_len);
        let crossings = stretched
            .windows(2)
            .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
            .count();
        let measured_period = stretched.len() as f32 / crossings as f32;
        assert!(
            (measured_period - period as f32).abs() < 4.0,
            "0.75x changed the measured period to {measured_period:.2} samples"
        );
    }

    #[test]
    fn pcm_conversion_clamps_and_uses_little_endian() {
        assert_eq!(
            pcm_f32_to_i16le(&[-2.0, 0.0, 2.0]),
            [0x01, 0x80, 0x00, 0x00, 0xff, 0x7f]
        );
    }
}
