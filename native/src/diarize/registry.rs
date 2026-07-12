//! Online speaker clustering.
//!
//! Speakers are tracked incrementally so a label can be assigned the moment an
//! utterance finalises (the pipeline inserts transcripts live, so there is no
//! end-of-session global clustering pass). Each speaker is a running centroid
//! of L2-normalised embeddings; a new utterance is matched to the nearest
//! centroid by cosine similarity.
//!
//! Two guards keep the speaker count stable:
//! - a similarity threshold: an utterance only spawns a *new* speaker when it is
//!   clearly dissimilar from every known speaker, so borderline matches attach
//!   to the nearest speaker instead of over-splitting.
//! - a short-utterance guard: very short utterances never spawn a new speaker,
//!   because embeddings are unreliable on little audio.
//! - an optional user limit: once the expected speaker count is reached, new
//!   voices attach to the nearest existing cluster instead of creating labels.

use super::{l2_norm, l2_normalize};

/// Cosine below which a long-enough utterance is treated as a brand-new voice.
/// At or above it, the utterance attaches to its nearest existing speaker, so
/// borderline matches consolidate onto the closest speaker rather than
/// over-splitting into spurious ones.
const NEW_SPEAKER_THRESHOLD: f32 = 0.4;
/// Utterances with less voiced audio than this never spawn a new speaker.
const MIN_NEW_SPEAKER_MS: u64 = 1_000;

#[derive(Debug, Clone, PartialEq)]
pub struct Assignment {
    pub speaker_index: u32,
    pub similarity: f32,
    pub is_new_speaker: bool,
    pub speaker_count: usize,
}

#[derive(Default)]
pub struct SpeakerRegistry {
    max_speakers: Option<usize>,
    speakers: Vec<SpeakerCluster>,
}

struct SpeakerCluster {
    centroid: Vec<f32>,
    count: u32,
}

impl SpeakerRegistry {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_max_speakers(max_speakers: Option<usize>) -> Self {
        debug_assert!(max_speakers.is_none_or(|limit| limit > 0));
        Self {
            max_speakers,
            speakers: Vec::new(),
        }
    }

    /// Assign `embedding` (need not be normalised) to a session-stable speaker.
    pub fn assign(&mut self, embedding: &[f32], voiced_ms: u64) -> Assignment {
        let best = self.best_match(embedding);

        match best {
            Some((idx, sim)) if sim >= NEW_SPEAKER_THRESHOLD || voiced_ms < MIN_NEW_SPEAKER_MS => {
                self.update_centroid(idx, embedding);
                Assignment {
                    speaker_index: idx as u32,
                    similarity: sim,
                    is_new_speaker: false,
                    speaker_count: self.speakers.len(),
                }
            }
            Some((idx, sim)) if self.speaker_limit_reached() => Assignment {
                speaker_index: idx as u32,
                similarity: sim,
                is_new_speaker: false,
                speaker_count: self.speakers.len(),
            },
            other => {
                let similarity = other.map_or(0.0, |(_, sim)| sim);
                let idx = self.add_speaker(embedding);
                Assignment {
                    speaker_index: idx as u32,
                    similarity,
                    is_new_speaker: true,
                    speaker_count: self.speakers.len(),
                }
            }
        }
    }

    fn speaker_limit_reached(&self) -> bool {
        self.max_speakers
            .is_some_and(|limit| self.speakers.len() >= limit)
    }

    fn best_match(&self, embedding: &[f32]) -> Option<(usize, f32)> {
        self.speakers
            .iter()
            .enumerate()
            .map(|(idx, speaker)| (idx, cosine(&speaker.centroid, embedding)))
            .max_by(|a, b| a.1.total_cmp(&b.1))
    }

    fn add_speaker(&mut self, embedding: &[f32]) -> usize {
        let mut centroid = embedding.to_vec();
        l2_normalize(&mut centroid);
        self.speakers.push(SpeakerCluster { centroid, count: 1 });
        self.speakers.len() - 1
    }

    fn update_centroid(&mut self, idx: usize, embedding: &[f32]) {
        let mut normalized = embedding.to_vec();
        l2_normalize(&mut normalized);

        let speaker = &mut self.speakers[idx];
        let count = speaker.count as f32;
        for (c, e) in speaker.centroid.iter_mut().zip(&normalized) {
            *c = (*c * count + *e) / (count + 1.0);
        }
        l2_normalize(&mut speaker.centroid);
        speaker.count += 1;
    }
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm_a = l2_norm(a);
    let norm_b = l2_norm(b);
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LONG: u64 = 5_000;

    #[test]
    fn first_utterance_creates_speaker_zero() {
        let mut registry = SpeakerRegistry::new();
        let assignment = registry.assign(&[1.0, 0.0, 0.0], LONG);
        assert_eq!(assignment.speaker_index, 0);
        assert!(assignment.is_new_speaker);
        assert_eq!(assignment.speaker_count, 1);
    }

    #[test]
    fn same_voice_reuses_the_same_speaker() {
        let mut registry = SpeakerRegistry::new();
        registry.assign(&[1.0, 0.0, 0.0], LONG);
        let again = registry.assign(&[0.95, 0.05, 0.0], LONG);
        assert_eq!(again.speaker_index, 0);
        assert!(!again.is_new_speaker);
        assert_eq!(again.speaker_count, 1);
    }

    #[test]
    fn distinct_voices_get_distinct_speakers() {
        let mut registry = SpeakerRegistry::new();
        let first = registry.assign(&[1.0, 0.0, 0.0], LONG);
        let second = registry.assign(&[0.0, 1.0, 0.0], LONG);
        assert_eq!(first.speaker_index, 0);
        assert_eq!(second.speaker_index, 1);
        assert!(second.is_new_speaker);
        assert_eq!(second.speaker_count, 2);
    }

    #[test]
    fn short_utterance_never_spawns_a_new_speaker() {
        let mut registry = SpeakerRegistry::new();
        registry.assign(&[1.0, 0.0, 0.0], LONG);
        // Orthogonal embedding, but too short to be trusted as a new voice.
        let short = registry.assign(&[0.0, 1.0, 0.0], 300);
        assert_eq!(short.speaker_index, 0);
        assert!(!short.is_new_speaker);
        assert_eq!(short.speaker_count, 1);
    }

    #[test]
    fn similarity_just_above_threshold_attaches_instead_of_splitting() {
        let mut registry = SpeakerRegistry::new();
        registry.assign(&[1.0, 0.0], LONG);
        // cosine ~0.45 — above NEW_SPEAKER_THRESHOLD, so it consolidates onto the
        // existing speaker rather than spawning a second one.
        let borderline = registry.assign(&[0.45, 0.89], LONG);
        assert!(borderline.similarity > NEW_SPEAKER_THRESHOLD);
        assert!(!borderline.is_new_speaker);
        assert_eq!(borderline.speaker_count, 1);
    }

    #[test]
    fn similarity_below_threshold_spawns_a_new_speaker() {
        let mut registry = SpeakerRegistry::new();
        registry.assign(&[1.0, 0.0], LONG);
        // cosine ~0.32 — below NEW_SPEAKER_THRESHOLD and long enough to trust, so
        // a clearly different voice becomes its own speaker.
        let distinct = registry.assign(&[0.34, 1.0], LONG);
        assert!(distinct.similarity < NEW_SPEAKER_THRESHOLD);
        assert!(distinct.is_new_speaker);
        assert_eq!(distinct.speaker_count, 2);
    }

    #[test]
    fn speaker_id_is_stable_when_a_voice_returns_after_another() {
        let mut registry = SpeakerRegistry::new();
        let first = registry.assign(&[1.0, 0.0, 0.0], LONG);
        let second = registry.assign(&[0.0, 1.0, 0.0], LONG);
        let first_again = registry.assign(&[0.97, 0.05, 0.0], LONG);
        assert_eq!(first.speaker_index, 0);
        assert_eq!(second.speaker_index, 1);
        assert_eq!(
            first_again.speaker_index, 0,
            "a returning voice must keep its original id"
        );
        assert!(!first_again.is_new_speaker);
        assert_eq!(first_again.speaker_count, 2);
    }

    #[test]
    fn speaker_limit_assigns_new_voices_to_the_nearest_existing_cluster() {
        let mut registry = SpeakerRegistry::with_max_speakers(Some(2));
        registry.assign(&[1.0, 0.0, 0.0], LONG);
        registry.assign(&[0.0, 1.0, 0.0], LONG);
        let centroids_before = registry
            .speakers
            .iter()
            .map(|speaker| speaker.centroid.clone())
            .collect::<Vec<_>>();

        let third_voice = registry.assign(&[0.1, 0.2, 1.0], LONG);

        assert!(!third_voice.is_new_speaker);
        assert!(third_voice.speaker_index < 2);
        assert_eq!(third_voice.speaker_count, 2);
        assert_eq!(
            registry
                .speakers
                .iter()
                .map(|speaker| speaker.centroid.clone())
                .collect::<Vec<_>>(),
            centroids_before,
            "a forced assignment must not contaminate an existing voice centroid"
        );
    }
}
