//! Local speaker diarization.
//!
//! Runs in the transcription worker on a finalized utterance's audio, after the
//! text stages. It splits the utterance into speaker turns (a VAD utterance can
//! hold several speakers), embeds each turn's voiced audio, and matches it
//! against a session-scoped registry to produce stable speaker indices. All
//! speaker data lives in memory for the session and is discarded when the
//! session ends — no enrollment, no persisted voiceprints, no network.
//!
//! Pipeline: `segmentation` finds turn boundaries, `embedding` + `registry`
//! resolve each turn's global identity. Segmentation only delimits *where*
//! speakers change; the registry decides *who* they are, so turns from different
//! windows and utterances reconcile by voice and stay session-stable.

mod embedding;
mod fbank;
mod registry;
mod segmentation;

pub use registry::Assignment;

use embedding::EmbeddingExtractor;
use registry::SpeakerRegistry;
use segmentation::Segmenter;

const SAMPLE_RATE: u64 = 16_000;

fn l2_norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}

fn l2_normalize(v: &mut [f32]) {
    let norm = l2_norm(v);
    if norm > 0.0 {
        for x in v {
            *x /= norm;
        }
    }
}

/// One speaker-attributed span within an utterance, in milliseconds from the
/// utterance start. The worker aligns transcript segments to these turns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpeakerTurn {
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker_index: u32,
}

pub struct SessionDiarizer {
    segmenter: Segmenter,
    extractor: EmbeddingExtractor,
    registry: SpeakerRegistry,
}

impl SessionDiarizer {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            segmenter: Segmenter::new()?,
            extractor: EmbeddingExtractor::new()?,
            registry: SpeakerRegistry::new(),
        })
    }

    /// Diarize an utterance's audio (16 kHz mono f32) into session-stable
    /// speaker turns, ordered by start time. Returns an empty vec only when no
    /// turn could be embedded.
    pub fn diarize(&mut self, samples: &[f32]) -> Result<Vec<SpeakerTurn>, String> {
        let duration_ms = samples.len() as u64 * 1_000 / SAMPLE_RATE;
        let mut local_turns = self.segmenter.segment(samples)?;
        if local_turns.is_empty() {
            // No turn boundaries (e.g. a single short utterance the segmentation
            // model did not light up): attribute the whole utterance as one turn
            // so single-speaker dictation still gets a label.
            local_turns.push(segmentation::LocalTurn {
                start_ms: 0,
                end_ms: duration_ms,
                local_speaker: 0,
            });
        }

        let mut turns = Vec::with_capacity(local_turns.len());
        for local in local_turns {
            let start = (local.start_ms * SAMPLE_RATE / 1_000) as usize;
            let end = ((local.end_ms * SAMPLE_RATE / 1_000) as usize).min(samples.len());
            if end <= start {
                continue;
            }
            // The turn's audio is already speaker-active (Tier 0: we never embed
            // whole-utterance silence/music), so embed it directly.
            let embedding = self
                .extractor
                .embed(&samples[start..end])
                .map_err(|error| {
                    format!(
                        "speaker embedding failed for turn {}-{} ms: {error}",
                        local.start_ms, local.end_ms
                    )
                })?;
            let voiced_ms = local.end_ms.saturating_sub(local.start_ms);
            let assignment = self.registry.assign(&embedding, voiced_ms);
            turns.push(SpeakerTurn {
                start_ms: local.start_ms,
                end_ms: local.end_ms,
                speaker_index: assignment.speaker_index,
            });
        }

        turns.sort_by_key(|turn| turn.start_ms);
        Ok(turns)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_embedding_failure_instead_of_returning_no_turns() {
        let mut diarizer = SessionDiarizer::new().expect("bundled models should load");
        let error = diarizer
            .diarize(&[0.0; 100])
            .expect_err("audio shorter than one filterbank frame cannot be embedded");

        assert!(
            error.contains("speaker embedding failed"),
            "unexpected error: {error}"
        );
    }
}
