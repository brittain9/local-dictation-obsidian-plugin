//! Diarization quality scoring for the speaker-clustering suite.
//!
//! The transcription suite asks "known audio in, known text out". This is the
//! diarization analogue: "known speakers in, correct speaker grouping out". It
//! builds a multi-speaker conversation from the single-speaker reference clips,
//! runs each utterance through the real [`SessionDiarizer`] (bundled embedding
//! model + online registry), and scores the predicted speaker labels against
//! ground truth with metrics that are robust to label permutation.
//!
//! Responsibilities are split (SRP): this module turns fixtures into scenarios
//! and scores outcomes; the registry/embedding internals it measures live in the
//! crate under `src/diarize/`.

use std::collections::HashMap;
use std::hash::Hash;

use local_dictation_sidecar::diarize::SessionDiarizer;

use super::audio::decode_wav_16k_mono;
use super::manifest::Corpus;

/// One utterance in a diarization scenario: real speech with a known speaker.
pub struct Utterance {
    /// Ground-truth speaker label. Each reference clip is a distinct speaker
    /// (five LibriSpeech voices plus JFK), so the fixture id is the label.
    pub speaker: String,
    /// 16 kHz mono samples in roughly `[-1.0, 1.0]`.
    pub samples: Vec<f32>,
}

/// Convert i16 PCM into the f32 range the diarizer consumes.
fn to_f32(samples: &[i16]) -> Vec<f32> {
    samples.iter().map(|&s| s as f32 / 32_768.0).collect()
}

/// Decode every reference clip into a single-speaker source utterance. Reuses
/// the transcription corpus so there is no second fixture set to maintain; each
/// corpus fixture is a distinct speaker, so its id is the ground-truth label.
pub fn speaker_sources() -> Vec<Utterance> {
    Corpus::load()
        .fixtures
        .iter()
        .map(|fixture| {
            let samples = decode_wav_16k_mono(&fixture.audio_path()).unwrap_or_else(|error| {
                panic!("decoding diarization source {}: {error}", fixture.id)
            });
            Utterance {
                speaker: fixture.id.clone(),
                samples: to_f32(&samples),
            }
        })
        .collect()
}

/// Split `samples` into `parts` contiguous chunks of near-equal length, turning
/// one single-speaker clip into several utterances by the same speaker so a
/// scenario can interleave returning voices. The final chunk absorbs any
/// remainder.
pub fn split(samples: &[f32], parts: usize) -> Vec<Vec<f32>> {
    assert!(parts > 0, "cannot split into zero parts");
    let chunk = samples.len() / parts;
    (0..parts)
        .map(|i| {
            let start = i * chunk;
            let end = if i + 1 == parts {
                samples.len()
            } else {
                start + chunk
            };
            samples[start..end].to_vec()
        })
        .collect()
}

/// Add reproducible white noise to `samples` at the requested signal-to-noise
/// ratio (dB), simulating a noisier-than-studio capture (background hum, fan,
/// room tone) — the conditions real microphone and system-audio captures hit,
/// not the pristine read speech the clean gates use. The noise is a fixed-seed
/// deterministic sequence so the test is stable run to run.
pub fn with_white_noise(samples: &[f32], snr_db: f32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }
    let signal_power = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
    let noise_power = signal_power / 10f32.powf(snr_db / 10.0);
    // Uniform noise on [-amplitude, amplitude] has variance amplitude²/3.
    let amplitude = (3.0 * noise_power).sqrt();

    let mut state: u32 = 0x9E37_79B9;
    samples
        .iter()
        .map(|&sample| {
            // xorshift32 — a tiny deterministic PRNG, no extra dependency.
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            let unit = (state as f32 / u32::MAX as f32) * 2.0 - 1.0;
            sample + unit * amplitude
        })
        .collect()
}

/// Outcome of diarizing an ordered scenario: per-utterance ground-truth label,
/// predicted speaker index, and the cosine similarity of the winning match.
pub struct ScenarioResult {
    pub truth: Vec<String>,
    pub predicted: Vec<u32>,
    pub similarity: Vec<f32>,
}

/// Run an ordered list of utterances through a single session diarizer, in
/// arrival order, exactly as the worker does on finalized utterances live.
pub fn diarize_scenario(utterances: &[Utterance]) -> ScenarioResult {
    let mut diarizer = SessionDiarizer::new().expect("bundled embedding model should load");
    let mut result = ScenarioResult {
        truth: Vec::with_capacity(utterances.len()),
        predicted: Vec::with_capacity(utterances.len()),
        similarity: Vec::with_capacity(utterances.len()),
    };
    for utterance in utterances {
        let assignment = diarizer
            .assign(&utterance.samples)
            .expect("embedding should succeed on real speech");
        result.truth.push(utterance.speaker.clone());
        result.predicted.push(assignment.speaker_index);
        result.similarity.push(assignment.similarity);
    }
    result
}

impl ScenarioResult {
    pub fn len(&self) -> usize {
        self.truth.len()
    }

    pub fn is_empty(&self) -> bool {
        self.truth.is_empty()
    }

    /// Distinct predicted speakers — the clustering's inferred speaker count.
    pub fn predicted_speaker_count(&self) -> usize {
        self.predicted
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
    }

    /// Distinct ground-truth speakers in the scenario.
    pub fn true_speaker_count(&self) -> usize {
        self.truth
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
    }

    /// Cluster purity: group utterances by predicted cluster, give each cluster
    /// its majority ground-truth speaker, then take the fraction that agree.
    /// Purity falls when two speakers are merged into one cluster
    /// (under-clustering), but on its own rewards over-splitting — so it is read
    /// alongside [`coverage`](Self::coverage). 1.0 is perfect.
    pub fn purity(&self) -> f64 {
        majority_fraction(&self.predicted, &self.truth)
    }

    /// Cluster coverage (inverse purity): the dual of [`purity`](Self::purity),
    /// grouping by ground-truth speaker instead. Coverage falls when one speaker
    /// is split across several clusters (over-clustering). Purity and coverage
    /// both at 1.0 means an exact 1-1 clustering; this is the standard
    /// diarization diagnostic pair (cf. pyannote.metrics). 1.0 is perfect.
    pub fn coverage(&self) -> f64 {
        majority_fraction(&self.truth, &self.predicted)
    }

    /// A human-readable per-utterance trace for `--nocapture` runs.
    pub fn trace(&self) -> String {
        let mut out = String::new();
        for i in 0..self.len() {
            out.push_str(&format!(
                "  [{i:>2}] truth={:<16} pred=S{} sim={:.3}\n",
                self.truth[i], self.predicted[i], self.similarity[i]
            ));
        }
        out
    }
}

/// Group utterances by `group_by`, label each by `label`, and return the
/// fraction that fall in their group's majority label. Purity and coverage are
/// this same statistic with the cluster/speaker axes swapped, so they share one
/// implementation. Empty input scores a perfect 1.0.
fn majority_fraction<G, L>(group_by: &[G], label: &[L]) -> f64
where
    G: Eq + Hash,
    L: Eq + Hash,
{
    if group_by.is_empty() {
        return 1.0;
    }
    let mut groups: HashMap<&G, HashMap<&L, usize>> = HashMap::new();
    for (group, item) in group_by.iter().zip(label) {
        *groups.entry(group).or_default().entry(item).or_insert(0) += 1;
    }
    let majority: usize = groups
        .values()
        .map(|counts| counts.values().copied().max().unwrap_or(0))
        .sum();
    majority as f64 / group_by.len() as f64
}
