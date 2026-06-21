//! Speaker-embedding extraction via the bundled ONNX model.
//!
//! The model is embedded in the binary (like the Silero VAD model) so the
//! feature works fully offline with no download. It consumes 80-bin log-Mel
//! features `[1, num_frames, 80]` (input `feats`) and emits a 256-d speaker
//! embedding (output `embs`).

use ort::session::Session;
use ort::value::TensorRef;

use crate::diarize::{
    fbank::{FbankComputer, NUM_MEL_BINS},
    l2_normalize,
};

const MODEL_BYTES: &[u8] = include_bytes!("../../models/speaker_embedding.onnx");

pub struct EmbeddingExtractor {
    session: Session,
    fbank: FbankComputer,
}

impl EmbeddingExtractor {
    pub fn new() -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("failed to create ONNX session builder: {e}"))?
            .commit_from_memory(MODEL_BYTES)
            .map_err(|e| format!("failed to load speaker-embedding model: {e}"))?;
        Ok(Self {
            session,
            fbank: FbankComputer::new(),
        })
    }

    /// Compute an L2-normalised speaker embedding for 16 kHz mono `samples`.
    pub fn embed(&mut self, samples: &[f32]) -> Result<Vec<f32>, String> {
        let feats = self.fbank.compute(samples);
        let num_frames = feats.nrows();
        if num_frames == 0 {
            return Err("audio too short for a speaker embedding".to_string());
        }

        let frames = feats
            .as_slice()
            .ok_or_else(|| "feature matrix is not contiguous".to_string())?;
        let input =
            TensorRef::from_array_view(([1_i64, num_frames as i64, NUM_MEL_BINS as i64], frames))
                .map_err(|e| format!("failed to build feature tensor: {e}"))?;

        let outputs = self
            .session
            .run(ort::inputs!["feats" => input])
            .map_err(|e| format!("speaker-embedding inference failed: {e}"))?;

        let (_, embedding) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("failed to read speaker embedding: {e}"))?;

        let mut embedding = embedding.to_vec();
        l2_normalize(&mut embedding);
        Ok(embedding)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROVENANCE_JSON: &str = include_str!("../../models/speaker_embedding.provenance.json");

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

    fn sine(freq: f32, samples: usize) -> Vec<f32> {
        (0..samples)
            .map(|n| (2.0 * std::f32::consts::PI * freq * n as f32 / 16_000.0).sin() * 0.5)
            .collect()
    }

    #[test]
    fn produces_a_normalised_256d_embedding() {
        let mut extractor = EmbeddingExtractor::new().expect("model should load");
        let embedding = extractor.embed(&sine(220.0, 16_000)).expect("embedding");
        assert_eq!(embedding.len(), 256);
        let norm = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!(
            (norm - 1.0).abs() < 1e-4,
            "embedding should be unit length, got {norm}"
        );
    }

    #[test]
    fn embedding_is_deterministic() {
        let mut extractor = EmbeddingExtractor::new().expect("model should load");
        let audio = sine(300.0, 16_000);
        assert_eq!(
            extractor.embed(&audio).unwrap(),
            extractor.embed(&audio).unwrap()
        );
    }

    #[test]
    fn rejects_audio_shorter_than_a_frame() {
        let mut extractor = EmbeddingExtractor::new().expect("model should load");
        assert!(extractor.embed(&sine(220.0, 100)).is_err());
    }
}
