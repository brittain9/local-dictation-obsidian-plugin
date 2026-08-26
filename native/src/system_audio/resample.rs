//! Linear-resampling of mono f32 audio down/up to the 16 kHz PCM rate used by
//! the protocol, accumulated into fixed-size frames.
//!
//! Ports the linear interpolation in `src/audio/pcm-frame-processor.ts` so
//! native loopback capture produces byte-identical framing to the renderer's
//! microphone path.

use crate::protocol::{PCM_BYTES_PER_FRAME, PCM_SAMPLE_RATE_HZ, PCM_SAMPLES_PER_FRAME};

/// Resamples a stream of mono f32 samples at an arbitrary source rate to
/// 16 kHz and emits 640-byte little-endian i16 PCM frames.
///
/// Carries fractional read position and the previous sample across calls so
/// interpolation is continuous across [`push`](Self::push) boundaries.
pub(crate) struct LoopbackFrameResampler {
    source_samples_per_output: f64,
    next_output_position: f64,
    input_sample_index: f64,
    previous_sample: Option<f32>,
    previous_sample_position: f64,
    frame_buffer: Vec<i16>,
}

impl LoopbackFrameResampler {
    pub(crate) fn new(source_rate: u32) -> Self {
        Self {
            source_samples_per_output: source_rate as f64 / PCM_SAMPLE_RATE_HZ as f64,
            next_output_position: 0.0,
            input_sample_index: 0.0,
            previous_sample: None,
            previous_sample_position: 0.0,
            frame_buffer: Vec::with_capacity(PCM_SAMPLES_PER_FRAME),
        }
    }

    /// Push more source-rate samples. Calls `emit` once per completed 640-byte
    /// frame, in order.
    pub(crate) fn push(&mut self, mono: &[f32], mut emit: impl FnMut(Vec<u8>)) {
        for &current_sample in mono {
            let current_position = self.input_sample_index;

            let Some(previous_sample) = self.previous_sample else {
                self.previous_sample = Some(current_sample);
                self.previous_sample_position = current_position;
                self.input_sample_index += 1.0;
                continue;
            };

            while self.next_output_position <= current_position {
                let sample_offset = (self.next_output_position - self.previous_sample_position)
                    / (current_position - self.previous_sample_position);
                let interpolated_sample = previous_sample as f64
                    + (current_sample as f64 - previous_sample as f64) * sample_offset;

                self.frame_buffer.push(float_to_pcm16(interpolated_sample));

                if self.frame_buffer.len() == PCM_SAMPLES_PER_FRAME {
                    emit(frame_to_bytes(&self.frame_buffer));
                    self.frame_buffer.clear();
                }

                self.next_output_position += self.source_samples_per_output;
            }

            self.previous_sample = Some(current_sample);
            self.previous_sample_position = current_position;
            self.input_sample_index += 1.0;
        }
    }
}

fn float_to_pcm16(sample: f64) -> i16 {
    let clamped_sample = sample.clamp(-1.0, 1.0);

    if clamped_sample < 0.0 {
        (clamped_sample * 0x8000 as f64).round() as i16
    } else {
        (clamped_sample * 0x7fff as f64).round() as i16
    }
}

fn frame_to_bytes(frame: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(PCM_BYTES_PER_FRAME);
    for &sample in frame {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_at_16khz_preserves_sample_count_and_frame_size() {
        let mut resampler = LoopbackFrameResampler::new(16_000);
        let total_samples = PCM_SAMPLES_PER_FRAME * 3;
        let input: Vec<f32> = (0..total_samples)
            .map(|i| (i as f32 / total_samples as f32) - 0.5)
            .collect();

        let mut emitted_samples = 0;
        let mut frames = 0;
        resampler.push(&input, |bytes| {
            assert_eq!(bytes.len(), PCM_BYTES_PER_FRAME);
            emitted_samples += bytes.len() / 2;
            frames += 1;
        });

        // At a 1:1 rate the seed sample is offset by the first real sample
        // emitting outputs at positions 0 and 1, so the stream neither gains
        // nor loses samples: input count == output count, exactly.
        assert_eq!(emitted_samples, total_samples);
        assert_eq!(frames, 3);
    }

    #[test]
    fn downsampling_48khz_to_16khz_yields_about_one_third_the_samples() {
        let mut resampler = LoopbackFrameResampler::new(48_000);
        let source_samples = PCM_SAMPLES_PER_FRAME * 3 * 3; // ~3 output frames worth
        let input: Vec<f32> = (0..source_samples)
            .map(|i| ((i as f32) * 0.001).sin())
            .collect();

        let mut emitted_frames = 0;
        resampler.push(&input, |bytes| {
            assert_eq!(bytes.len(), PCM_BYTES_PER_FRAME);
            emitted_frames += 1;
        });

        let expected_frames = source_samples / 3 / PCM_SAMPLES_PER_FRAME;
        assert!(
            (emitted_frames as i64 - expected_frames as i64).abs() <= 1,
            "expected ~{expected_frames} frames, got {emitted_frames}"
        );
    }

    #[test]
    fn many_small_pushes_match_a_single_large_push() {
        let source_samples = PCM_SAMPLES_PER_FRAME * 3 * 3;
        let input: Vec<f32> = (0..source_samples)
            .map(|i| ((i as f32) * 0.01).sin() * 0.5)
            .collect();

        let mut single_pass = LoopbackFrameResampler::new(48_000);
        let mut single_pass_frames: Vec<Vec<u8>> = Vec::new();
        single_pass.push(&input, |bytes| single_pass_frames.push(bytes));

        let mut chunked = LoopbackFrameResampler::new(48_000);
        let mut chunked_frames: Vec<Vec<u8>> = Vec::new();
        for chunk in input.chunks(7) {
            chunked.push(chunk, |bytes| chunked_frames.push(bytes));
        }

        assert_eq!(single_pass_frames, chunked_frames);
        assert!(!single_pass_frames.is_empty());
    }

    #[test]
    fn constant_signal_produces_constant_pcm_value() {
        let mut resampler = LoopbackFrameResampler::new(16_000);
        let value = 0.5_f32;
        let input = vec![value; PCM_SAMPLES_PER_FRAME * 2];

        let expected = (value as f64 * 0x7fff as f64).round() as i16;

        let mut frames = 0;
        resampler.push(&input, |bytes| {
            frames += 1;
            for chunk in bytes.chunks_exact(2) {
                let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                assert_eq!(sample, expected);
            }
        });

        assert!(frames >= 1);
    }
}
