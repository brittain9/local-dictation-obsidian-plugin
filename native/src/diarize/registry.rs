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
    centroids: Vec<Vec<f32>>,
    counts: Vec<u32>,
}

impl SpeakerRegistry {
    pub fn new() -> Self {
        Self::default()
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
                    speaker_count: self.centroids.len(),
                }
            }
            other => {
                let similarity = other.map_or(0.0, |(_, sim)| sim);
                let idx = self.add_speaker(embedding);
                Assignment {
                    speaker_index: idx as u32,
                    similarity,
                    is_new_speaker: true,
                    speaker_count: self.centroids.len(),
                }
            }
        }
    }

    fn best_match(&self, embedding: &[f32]) -> Option<(usize, f32)> {
        self.centroids
            .iter()
            .enumerate()
            .map(|(idx, centroid)| (idx, cosine(centroid, embedding)))
            .max_by(|a, b| a.1.total_cmp(&b.1))
    }

    fn add_speaker(&mut self, embedding: &[f32]) -> usize {
        let mut centroid = embedding.to_vec();
        normalize(&mut centroid);
        self.centroids.push(centroid);
        self.counts.push(1);
        self.centroids.len() - 1
    }

    fn update_centroid(&mut self, idx: usize, embedding: &[f32]) {
        let mut normalized = embedding.to_vec();
        normalize(&mut normalized);

        let count = self.counts[idx] as f32;
        let centroid = &mut self.centroids[idx];
        for (c, e) in centroid.iter_mut().zip(normalized.iter()) {
            *c = (*c * count + *e) / (count + 1.0);
        }
        normalize(centroid);
        self.counts[idx] += 1;
    }
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm_a = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

fn normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v {
            *x /= norm;
        }
    }
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
}
