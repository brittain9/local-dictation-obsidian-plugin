//! Local speaker diarization.
//!
//! Runs in the transcription worker on a finalized utterance's audio, after the
//! text stages. It extracts a speaker embedding and matches it against a
//! session-scoped registry to produce a stable speaker index. All speaker data
//! lives in memory for the session and is discarded when the session ends — no
//! enrollment, no persisted voiceprints, no network.

mod embedding;
mod fbank;
mod registry;

pub use registry::Assignment;

use embedding::EmbeddingExtractor;
use registry::SpeakerRegistry;

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

pub struct SessionDiarizer {
    extractor: EmbeddingExtractor,
    registry: SpeakerRegistry,
}

impl SessionDiarizer {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            extractor: EmbeddingExtractor::new()?,
            registry: SpeakerRegistry::new(),
        })
    }

    /// Assign a session-stable speaker to an utterance's audio (16 kHz mono f32).
    pub fn assign(&mut self, samples: &[f32]) -> Result<Assignment, String> {
        let voiced_ms = samples.len() as u64 * 1_000 / SAMPLE_RATE;
        let embedding = self.extractor.embed(samples)?;
        Ok(self.registry.assign(&embedding, voiced_ms))
    }
}
