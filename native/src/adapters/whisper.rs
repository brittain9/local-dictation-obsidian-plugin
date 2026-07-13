use std::path::Path;

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::engine::capabilities::{
    LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, RuntimeId,
};
use crate::engine::traits::{LoadedModel, ModelFamilyAdapter};
use crate::protocol::{TimestampGranularity, TimestampSource, TranscriptSegment, TranscriptWord};
use crate::transcription::{
    EngineTranscriptOutput, GpuConfig, SegmentDiagnostics, TranscriptionError,
    TranscriptionRequest, validate_audio_samples, validate_language, validate_model_path,
};

#[derive(Default)]
pub struct WhisperAdapter;

const CAPABILITIES: ModelFamilyCapabilities = ModelFamilyCapabilities {
    supports_segment_timestamps: true,
    supports_word_timestamps: true,
    supports_initial_prompt: true,
    supports_streaming: false,
    supports_language_selection: false,
    supported_languages: LanguageSupport::EnglishOnly,
    max_audio_duration_secs: None,
    produces_punctuation: true,
};

impl ModelFamilyAdapter for WhisperAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::WhisperCpp
    }

    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::Whisper
    }

    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }

    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        validate_model_path(path)?;
        let _ = load_whisper_context(path, &GpuConfig { use_gpu: false })?;
        Ok(())
    }

    fn load(
        &self,
        path: &Path,
        gpu: GpuConfig,
    ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        validate_model_path(path)?;
        let context = load_whisper_context(path, &gpu)?;
        Ok(Box::new(LoadedWhisperModel { context }))
    }
}

pub struct LoadedWhisperModel {
    context: WhisperContext,
}

impl LoadedModel for LoadedWhisperModel {
    fn transcribe(
        &mut self,
        request: &TranscriptionRequest,
    ) -> Result<EngineTranscriptOutput, TranscriptionError> {
        validate_language(&request.language)?;
        validate_audio_samples(&request.audio_samples)?;

        let mut state = self.context.create_state().map_err(|error| {
            TranscriptionError::transcription_failure("failed to create whisper state", error)
        })?;
        // `best_of` is the decoder count during whisper.cpp temperature fallback,
        // not beam width. Keep the upstream default of 5 so the entropy_thold 2.4 /
        // temperature_inc 0.2 fallback can escape repetition; 0 collapsed it to one.
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 5 });

        params.set_n_threads(recommended_thread_count(request.gpu_config.use_gpu));
        params.set_language(Some(&request.language));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_token_timestamps(request.detailed_timestamps_enabled);

        if let Some(context) = request.context.as_ref() {
            params.set_initial_prompt(&context.text);
        }

        state
            .full(params, &request.audio_samples)
            .map_err(|error| {
                TranscriptionError::transcription_failure("failed to run whisper model", error)
            })?;

        let mut segments = Vec::new();
        let mut diagnostics = Vec::new();

        for segment in state.as_iter() {
            let segment_text = segment.to_string();
            let start_ms = whisper_timestamp_to_millis(segment.start_timestamp());
            let end_ms = whisper_timestamp_to_millis(segment.end_timestamp());
            diagnostics.push(whisper_segment_diagnostics(&segment));
            segments.push(TranscriptSegment {
                end_ms,
                speaker: None,
                start_ms,
                text: segment_text.trim().to_string(),
                timestamp_granularity: TimestampGranularity::Segment,
                timestamp_source: TimestampSource::Engine,
                words: if request.detailed_timestamps_enabled {
                    whisper_segment_words(&segment, self.context.token_eot(), start_ms, end_ms)
                } else {
                    Vec::new()
                },
            });
        }

        Ok(EngineTranscriptOutput {
            segments,
            diagnostics,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TimedToken {
    end_ms: u64,
    start_ms: u64,
    text: String,
}

fn whisper_segment_words(
    segment: &whisper_rs::WhisperSegment<'_>,
    end_of_text_token: i32,
    segment_start_ms: u64,
    segment_end_ms: u64,
) -> Vec<TranscriptWord> {
    let mut tokens = Vec::new();
    for index in 0..segment.n_tokens() {
        let Some(token) = segment.get_token(index) else {
            return Vec::new();
        };
        if token.token_id() >= end_of_text_token {
            continue;
        }
        let Ok(text) = token.to_str_lossy() else {
            return Vec::new();
        };
        if text.trim().is_empty() {
            continue;
        }
        let data = token.token_data();
        if data.t0 < 0 || data.t1 < data.t0 {
            return Vec::new();
        }
        tokens.push(TimedToken {
            end_ms: whisper_timestamp_to_millis(data.t1).min(segment_end_ms),
            start_ms: whisper_timestamp_to_millis(data.t0).max(segment_start_ms),
            text: text.into_owned(),
        });
    }

    assemble_words(&tokens, &segment.to_string())
}

fn assemble_words(tokens: &[TimedToken], segment_text: &str) -> Vec<TranscriptWord> {
    let mut words: Vec<TranscriptWord> = Vec::new();

    for token in tokens {
        let text = token.text.trim();
        if text.is_empty() {
            continue;
        }

        let begins_word = token.text.chars().next().is_some_and(char::is_whitespace);
        if begins_word || words.is_empty() {
            let previous_end_ms = words.last().map_or(0, |word| word.end_ms);
            let start_ms = token.start_ms.max(previous_end_ms);
            words.push(TranscriptWord {
                end_ms: token.end_ms.max(start_ms),
                start_ms,
                text: text.to_string(),
                timestamp_source: TimestampSource::Engine,
            });
            continue;
        }

        let current = words.last_mut().expect("word list is non-empty");
        current.text.push_str(text);
        current.end_ms = current.end_ms.max(token.end_ms);
    }

    let reconstructed = words
        .iter()
        .map(|word| word.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    if normalize_whitespace(&reconstructed) == normalize_whitespace(segment_text) {
        words
    } else {
        Vec::new()
    }
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn whisper_segment_diagnostics(segment: &whisper_rs::WhisperSegment<'_>) -> SegmentDiagnostics {
    let token_count = segment.n_tokens().max(0) as u32;
    SegmentDiagnostics {
        avg_logprob: average_token_logprob(segment),
        decode_reached_eos: None,
        no_speech_prob: Some(segment.no_speech_probability()),
        token_count: Some(token_count),
    }
}

fn average_token_logprob(segment: &whisper_rs::WhisperSegment<'_>) -> Option<f32> {
    let mut count = 0_u32;
    let mut sum = 0.0_f32;

    for index in 0..segment.n_tokens() {
        let Some(token) = segment.get_token(index) else {
            continue;
        };
        if !token_has_visible_text(&token) {
            continue;
        }
        // Floor to 1e-9 so quantization noise can't drive the running sum to
        // -inf via ln(0); cap at 1.0 so a slightly-over-one probability does
        // not produce a positive logprob.
        sum += token.token_probability().clamp(1.0e-9, 1.0).ln();
        count += 1;
    }

    (count > 0).then_some(sum / count as f32)
}

fn token_has_visible_text(token: &whisper_rs::WhisperToken<'_, '_>) -> bool {
    // Borrow the raw bytes (no allocation) and skip tokens whose text is empty
    // or whitespace-only — that matches the prior `to_string().trim().is_empty()`
    // behavior without churning a String per token.
    match token.to_bytes() {
        Ok(bytes) => bytes.iter().any(|byte| !byte.is_ascii_whitespace()),
        Err(_) => false,
    }
}

fn load_whisper_context(
    model_file_path: &Path,
    gpu_config: &GpuConfig,
) -> Result<WhisperContext, TranscriptionError> {
    let model_path = model_file_path
        .to_str()
        .ok_or_else(|| TranscriptionError::invalid_model("model path must be valid UTF-8"))?;

    let mut params = WhisperContextParameters::default();
    params.use_gpu(gpu_config.use_gpu);
    params.flash_attn(gpu_config.use_gpu);

    WhisperContext::new_with_params(model_path, params)
        .map_err(|error| TranscriptionError::invalid_model_with_details(error.to_string()))
}

fn recommended_thread_count(gpu_active: bool) -> i32 {
    let max = if gpu_active { 4 } else { 8 };
    std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1)
        .min(max) as i32
}

fn whisper_timestamp_to_millis(timestamp: i64) -> u64 {
    timestamp.max(0) as u64 * 10
}

#[cfg(test)]
mod tests {
    use super::{TimedToken, WhisperAdapter, assemble_words};
    use crate::engine::traits::ModelFamilyAdapter;

    fn token(text: &str, start_ms: u64, end_ms: u64) -> TimedToken {
        TimedToken {
            end_ms,
            start_ms,
            text: text.to_string(),
        }
    }

    #[test]
    fn assembles_whisper_subtokens_and_punctuation_into_words() {
        let words = assemble_words(
            &[
                token(" Hello", 100, 300),
                token(" world", 300, 500),
                token("!", 480, 550),
                token(" Test", 540, 800),
                token("ing", 780, 900),
            ],
            "Hello world! Testing",
        );

        assert_eq!(
            words
                .iter()
                .map(|word| (word.text.as_str(), word.start_ms, word.end_ms))
                .collect::<Vec<_>>(),
            vec![
                ("Hello", 100, 300),
                ("world!", 300, 550),
                ("Testing", 550, 900),
            ]
        );
    }

    #[test]
    fn rejects_incomplete_alignment_instead_of_dropping_visible_text() {
        let words = assemble_words(&[token(" Hello", 0, 200)], "Hello world");

        assert!(words.is_empty());
    }

    #[test]
    fn advertises_word_timing_to_model_aware_clients() {
        let capabilities = WhisperAdapter.capabilities();

        assert!(capabilities.supports_segment_timestamps);
        assert!(capabilities.supports_word_timestamps);
    }
}
