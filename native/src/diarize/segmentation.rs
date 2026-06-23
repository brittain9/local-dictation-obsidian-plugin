//! Speaker segmentation (turn splitting) via the bundled pyannote
//! `segmentation-3.0` ONNX model.
//!
//! VAD delimits an utterance by silence, not by speaker, so one utterance can
//! hold several speaker turns. This module finds those turns: it runs the
//! segmentation model over the utterance in fixed 10 s windows, argmax-decodes
//! the per-frame powerset distribution into per-frame local-speaker activity,
//! and extracts contiguous speaker-homogeneous spans. Each span is later
//! embedded and clustered for a session-stable global identity, so the *local*
//! speaker slots (0..3) here only delimit boundaries — identity is resolved
//! downstream by the registry.
//!
//! The model is embedded in the binary (like Silero VAD and the embedding
//! model) so the feature works fully offline.

use ort::session::Session;
use ort::value::TensorRef;

const MODEL_BYTES: &[u8] = include_bytes!("../../models/speaker_segmentation.onnx");

/// 10 s @ 16 kHz — the model's training window (`window_size`).
const WINDOW_SAMPLES: usize = 160_000;
/// Powerset classes: ∅, three singletons, three pairs.
const NUM_CLASSES: usize = 7;
/// Local speaker slots per window (`num_speakers`).
const NUM_LOCAL_SPEAKERS: usize = 3;
/// Frame stride in samples (`receptive_field_shift`): one frame ≈ 16.875 ms.
const RECEPTIVE_FIELD_SHIFT: f64 = 270.0;
/// Frame receptive field in samples (`receptive_field_size`); its half-width
/// centres a frame's timestamp on the audio it summarises.
const RECEPTIVE_FIELD_SIZE: f64 = 991.0;
const SAMPLE_RATE: f64 = 16_000.0;

/// Turns shorter than this are dropped: too little audio for a reliable
/// embedding, and likely a decode flicker rather than a real turn.
const MIN_DURATION_ON_MS: u64 = 300;
/// Same-speaker turns separated by less than this are merged, so a brief
/// in-turn pause does not fragment one person into two embeddings.
const MIN_DURATION_OFF_MS: u64 = 500;

/// Powerset class → active local-speaker set, matching sherpa-onnx's
/// `get_powerset_mapping(num_classes=7, num_speakers=3, powerset_max_classes=2)`:
/// `0:∅ 1:{0} 2:{1} 3:{2} 4:{0,1} 5:{0,2} 6:{1,2}`.
const POWERSET_MAPPING: [[bool; NUM_LOCAL_SPEAKERS]; NUM_CLASSES] = [
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
    [true, true, false],
    [true, false, true],
    [false, true, true],
];

/// A speaker-homogeneous span within an utterance, in milliseconds from the
/// utterance start. The local speaker slot is retained for diagnostics only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalTurn {
    pub start_ms: u64,
    pub end_ms: u64,
    pub local_speaker: u8,
}

pub struct Segmenter {
    session: Session,
}

impl Segmenter {
    pub fn new() -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("failed to create ONNX session builder: {e}"))?
            .commit_from_memory(MODEL_BYTES)
            .map_err(|e| format!("failed to load speaker-segmentation model: {e}"))?;
        Ok(Self { session })
    }

    /// Find speaker turns in 16 kHz mono `samples`. Turns are clamped to the
    /// utterance duration and returned sorted by start time. An empty result
    /// means the model found no speech; the caller falls back to whole-utterance
    /// attribution.
    pub fn segment(&mut self, samples: &[f32]) -> Result<Vec<LocalTurn>, String> {
        if samples.is_empty() {
            return Ok(Vec::new());
        }

        let mut turns = Vec::new();
        let mut offset = 0;
        while offset < samples.len() {
            let end = (offset + WINDOW_SAMPLES).min(samples.len());
            let window = &samples[offset..end];

            let mut buffer = [0.0_f32; WINDOW_SAMPLES];
            buffer[..window.len()].copy_from_slice(window);
            let activity = self.run_window(&buffer)?;

            let window_offset_ms = samples_to_ms(offset);
            turns.extend(frames_to_turns(&activity, window_offset_ms));

            if window.len() < WINDOW_SAMPLES {
                break;
            }
            offset += WINDOW_SAMPLES;
        }

        let duration_ms = samples_to_ms(samples.len());
        for turn in &mut turns {
            turn.end_ms = turn.end_ms.min(duration_ms);
        }
        turns.retain(|turn| turn.end_ms > turn.start_ms);
        turns.sort_by_key(|turn| (turn.start_ms, turn.local_speaker));
        Ok(turns)
    }

    /// Run one fixed-size window and argmax-decode it into per-frame activity.
    fn run_window(&mut self, window: &[f32]) -> Result<Vec<[bool; NUM_LOCAL_SPEAKERS]>, String> {
        let tensor = TensorRef::from_array_view(([1_i64, 1, WINDOW_SAMPLES as i64], window))
            .map_err(|e| format!("failed to build segmentation input: {e}"))?;
        let outputs = self
            .session
            .run(ort::inputs!["x" => tensor])
            .map_err(|e| format!("segmentation inference failed: {e}"))?;
        let (shape, logits) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("failed to read segmentation output: {e}"))?;

        if shape.len() != 3 || shape[2] as usize != NUM_CLASSES {
            return Err(format!("unexpected segmentation output shape {shape:?}"));
        }
        let num_frames = shape[1] as usize;

        let mut activity = Vec::with_capacity(num_frames);
        for frame in 0..num_frames {
            let base = frame * NUM_CLASSES;
            let class = argmax(&logits[base..base + NUM_CLASSES]);
            activity.push(POWERSET_MAPPING[class]);
        }
        Ok(activity)
    }
}

/// Convert one window's per-frame activity into per-local-speaker turns, merging
/// brief same-speaker gaps and dropping turns too short to embed. Pure so the
/// turn logic is tested without the model.
fn frames_to_turns(
    activity: &[[bool; NUM_LOCAL_SPEAKERS]],
    window_offset_ms: u64,
) -> Vec<LocalTurn> {
    let mut turns = Vec::new();

    for speaker in 0..NUM_LOCAL_SPEAKERS {
        let mut runs: Vec<(usize, usize)> = Vec::new();
        let mut run_start: Option<usize> = None;
        for (frame, slots) in activity.iter().enumerate() {
            if slots[speaker] {
                run_start.get_or_insert(frame);
            } else if let Some(start) = run_start.take() {
                runs.push((start, frame));
            }
        }
        if let Some(start) = run_start {
            runs.push((start, activity.len()));
        }

        for (start_frame, end_frame) in runs {
            let start_ms = window_offset_ms + frame_to_ms(start_frame);
            let end_ms = window_offset_ms + frame_to_ms(end_frame);
            match turns.last_mut() {
                // Merge with the previous run of the *same* speaker across a
                // short gap.
                Some(LocalTurn {
                    end_ms: prev_end,
                    local_speaker,
                    ..
                }) if *local_speaker as usize == speaker
                    && start_ms.saturating_sub(*prev_end) < MIN_DURATION_OFF_MS =>
                {
                    *prev_end = end_ms;
                }
                _ => turns.push(LocalTurn {
                    start_ms,
                    end_ms,
                    local_speaker: speaker as u8,
                }),
            }
        }
    }

    turns.retain(|turn| turn.end_ms.saturating_sub(turn.start_ms) >= MIN_DURATION_ON_MS);
    turns.sort_by_key(|turn| (turn.start_ms, turn.local_speaker));
    turns
}

/// Centre of frame `f` in milliseconds: `f * shift + size/2`, in samples.
fn frame_to_ms(frame: usize) -> u64 {
    let samples = frame as f64 * RECEPTIVE_FIELD_SHIFT + RECEPTIVE_FIELD_SIZE * 0.5;
    (samples / SAMPLE_RATE * 1000.0).round() as u64
}

fn samples_to_ms(samples: usize) -> u64 {
    (samples as f64 / SAMPLE_RATE * 1000.0).round() as u64
}

fn argmax(values: &[f32]) -> usize {
    values
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(index, _)| index)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROVENANCE_JSON: &str = include_str!("../../models/speaker_segmentation.provenance.json");

    #[test]
    fn bundled_model_matches_provenance() {
        use sha2::{Digest, Sha256};
        let manifest: serde_json::Value =
            serde_json::from_str(PROVENANCE_JSON).expect("provenance should parse");
        let digest = Sha256::digest(MODEL_BYTES);
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(manifest["artifact"]["sha256"], serde_json::json!(hex));
        assert_eq!(
            manifest["artifact"]["size_bytes"],
            serde_json::json!(MODEL_BYTES.len())
        );
    }

    #[test]
    fn powerset_mapping_matches_sherpa() {
        // Singletons then pairs, in sherpa's enumeration order.
        assert_eq!(POWERSET_MAPPING[0], [false, false, false]);
        assert_eq!(POWERSET_MAPPING[1], [true, false, false]);
        assert_eq!(POWERSET_MAPPING[3], [false, false, true]);
        assert_eq!(POWERSET_MAPPING[4], [true, true, false]);
        assert_eq!(POWERSET_MAPPING[6], [false, true, true]);
    }

    /// Build a per-frame activity array from per-speaker active frame ranges.
    fn activity(frames: usize, ranges: &[(usize, usize, usize)]) -> Vec<[bool; 3]> {
        let mut out = vec![[false; 3]; frames];
        for &(speaker, start, end) in ranges {
            for slot in out.iter_mut().take(end).skip(start) {
                slot[speaker] = true;
            }
        }
        out
    }

    #[test]
    fn single_speaker_yields_one_turn() {
        // 200 frames ≈ 3.4 s of speaker 0.
        let turns = frames_to_turns(&activity(200, &[(0, 0, 200)]), 0);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].local_speaker, 0);
        assert_eq!(turns[0].start_ms, frame_to_ms(0));
    }

    #[test]
    fn alternating_speakers_yield_three_turns() {
        // A: [0,60) and [120,200); B: [60,120) — a clear A,B,A exchange. The two
        // A runs are separated by ~1 s (> off-merge), so they stay distinct.
        let turns = frames_to_turns(
            &activity(200, &[(0, 0, 60), (1, 60, 120), (0, 120, 200)]),
            0,
        );
        assert_eq!(
            turns.len(),
            3,
            "A,B,A must split into three turns: {turns:?}"
        );
        let speakers: Vec<u8> = turns.iter().map(|t| t.local_speaker).collect();
        // Sorted by start: A(0..60), B(60..120), A(120..200).
        assert_eq!(speakers, vec![0, 1, 0]);
    }

    #[test]
    fn short_same_speaker_gap_is_merged() {
        // Two speaker-0 runs split by a 10-frame (~170 ms < 500 ms) gap merge.
        let turns = frames_to_turns(&activity(200, &[(0, 0, 90), (0, 100, 200)]), 0);
        assert_eq!(
            turns.len(),
            1,
            "a brief in-turn gap must not fragment: {turns:?}"
        );
        assert_eq!(turns[0].end_ms, frame_to_ms(200));
    }

    #[test]
    fn turns_shorter_than_min_duration_are_dropped() {
        // 10 frames ≈ 170 ms < 300 ms.
        let turns = frames_to_turns(&activity(200, &[(2, 0, 10)]), 0);
        assert!(
            turns.is_empty(),
            "sub-300 ms flicker must be dropped: {turns:?}"
        );
    }

    #[test]
    fn window_offset_shifts_turn_times() {
        let base = frames_to_turns(&activity(200, &[(0, 0, 200)]), 0);
        let shifted = frames_to_turns(&activity(200, &[(0, 0, 200)]), 10_000);
        assert_eq!(shifted[0].start_ms, base[0].start_ms + 10_000);
    }
}
