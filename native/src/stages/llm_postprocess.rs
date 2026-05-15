use std::time::Duration;

use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::json;

use crate::protocol::{
    ContextWindow, ContextWindowSource, LlmPostprocessConfig, StageId, TimestampGranularity,
    TimestampSource, TranscriptSegment,
};
use crate::stages::{StageContext, StageProcess, StageProcessor};
use crate::transcription::Transcript;

const OLLAMA_CHAT_URL: &str = "http://127.0.0.1:11434/api/chat";

pub struct LlmPostprocessStage {
    chat_url: String,
    client: reqwest::Client,
}

impl LlmPostprocessStage {
    pub fn new() -> Self {
        Self::with_chat_url(OLLAMA_CHAT_URL)
    }

    pub(crate) fn with_chat_url(chat_url: impl Into<String>) -> Self {
        Self {
            chat_url: chat_url.into(),
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("Ollama reqwest client should build"),
        }
    }
}

impl StageProcessor for LlmPostprocessStage {
    fn id(&self) -> StageId {
        StageId::LlmPostprocess
    }

    fn collapses_segment_boundaries(&self) -> bool {
        true
    }

    fn process(&self, transcript: &Transcript, ctx: &StageContext<'_>) -> StageProcess {
        let mut base = LlmPayloadInput {
            context_chars_total: context_chars_total(ctx.context),
            done_reason: "skipped",
            eval_count: None,
            model: "",
            output_chars: 0,
            prompt_eval_count: None,
            skipped_reason: None,
            truncated: false,
        };

        let Some(config) = ctx.llm_postprocess else {
            return skipped(base, "disabled");
        };
        base.model = &config.model;

        let input = transcript.joined_text();
        let trimmed_input = input.trim();

        if trimmed_input.is_empty() {
            return skipped(base, "empty_input");
        }
        if config.skip_min_words > 0 && word_count(trimmed_input) < config.skip_min_words as usize {
            return skipped(base, "below_min_words");
        }
        if confidence_gate_trips(transcript, ctx, config.skip_if_avg_logprob_above) {
            return skipped(base, "high_confidence");
        }

        if !config.user_template.contains("{{utterance}}") {
            return failed(
                base,
                "missing utterance placeholder".to_string(),
                "error",
                false,
            );
        }

        let user_message = render_user_message(config, ctx.context, trimmed_input);
        let response = match ctx.tokio_runtime.block_on(send_chat(
            &self.client,
            &self.chat_url,
            config,
            user_message,
        )) {
            Ok(response) => response,
            Err(error) => return failed(base, error, "error", false),
        };

        let output = response.message.content.trim().to_string();
        let done_reason = response.done_reason.unwrap_or_else(|| "stop".to_string());
        base.eval_count = response.eval_count;
        base.output_chars = output.len() as u32;
        base.prompt_eval_count = response.prompt_eval_count;

        if done_reason != "stop" {
            let truncated = done_reason == "length";
            return failed(
                base,
                format!("Ollama stopped with done_reason={done_reason}"),
                if truncated { "length" } else { "error" },
                truncated,
            );
        }
        if output.is_empty() {
            return failed(
                base,
                "Ollama returned empty output".to_string(),
                "error",
                false,
            );
        }
        if output.len() > trimmed_input.len().saturating_mul(10).saturating_add(1_000) {
            return failed(
                base,
                "Ollama output exceeded length guard".to_string(),
                "error",
                true,
            );
        }

        base.done_reason = "stop";
        let mut payload = llm_payload(base);
        if config.show_raw_below
            && let serde_json::Value::Object(map) = &mut payload
        {
            map.insert(
                "rawText".to_string(),
                serde_json::Value::String(trimmed_input.to_string()),
            );
        }

        StageProcess::Ok {
            segments: vec![TranscriptSegment {
                end_ms: ctx.voice_activity.duration_ms(),
                start_ms: 0,
                text: output,
                timestamp_granularity: TimestampGranularity::Utterance,
                timestamp_source: TimestampSource::None,
            }],
            payload: Some(payload),
        }
    }
}

fn skipped(mut base: LlmPayloadInput<'_>, reason: &'static str) -> StageProcess {
    base.skipped_reason = Some(reason);
    StageProcess::Skipped {
        reason: reason.to_string(),
        payload: Some(llm_payload(base)),
    }
}

fn failed(
    mut base: LlmPayloadInput<'_>,
    error: String,
    done_reason: &'static str,
    truncated: bool,
) -> StageProcess {
    base.done_reason = done_reason;
    base.truncated = truncated;
    StageProcess::Failed {
        error,
        payload: Some(llm_payload(base)),
    }
}

async fn send_chat(
    client: &reqwest::Client,
    chat_url: &str,
    config: &LlmPostprocessConfig,
    user_message: String,
) -> Result<OllamaChatResponse, String> {
    let request = client.post(chat_url).json(&json!({
        "keep_alive": config.keep_alive,
        "messages": [
            { "role": "system", "content": config.system_slot },
            { "role": "user", "content": user_message }
        ],
        "model": config.model,
        "options": {
            "num_predict": config.num_predict,
            "seed": config.seed,
            "temperature": config.temperature,
        },
        "stream": false,
        "think": false,
    }));

    let response = request.send().await.map_err(|error| error.to_string())?;

    if response.status() != StatusCode::OK {
        return Err(format!("Ollama returned HTTP {}", response.status()));
    }

    response
        .json::<OllamaChatResponse>()
        .await
        .map_err(|error| error.to_string())
}

fn render_user_message(
    config: &LlmPostprocessConfig,
    context: Option<&ContextWindow>,
    utterance: &str,
) -> String {
    let note_context = join_sources(context, |source| {
        matches!(source, ContextWindowSource::NoteText { .. })
    });
    let prior_utterances = join_sources(context, |source| {
        matches!(source, ContextWindowSource::PriorUtterance { .. })
    });
    let glossary = {
        let from_context = join_sources(context, |source| {
            matches!(source, ContextWindowSource::GlossaryText { .. })
        });
        if from_context.is_empty() {
            config.glossary_text.clone()
        } else {
            from_context
        }
    };

    render_template(
        &config.user_template,
        &[
            ("{{voice}}", config.voice_slot.as_str()),
            ("{{glossary}}", glossary.as_str()),
            ("{{format}}", config.format_slot.as_str()),
            ("{{note_context}}", note_context.as_str()),
            ("{{prior_utterances}}", prior_utterances.as_str()),
            ("{{utterance}}", utterance),
        ],
    )
}

fn render_template(template: &str, replacements: &[(&str, &str)]) -> String {
    let mut output = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        let Some(end_after_start) = rest[start + 2..].find("}}") else {
            output.push_str(rest);
            return output;
        };
        let end = start + 2 + end_after_start + 2;
        let placeholder = &rest[start..end];

        output.push_str(&rest[..start]);
        if let Some((_, value)) = replacements
            .iter()
            .find(|(candidate, _)| *candidate == placeholder)
        {
            output.push_str(value);
        } else {
            output.push_str(placeholder);
        }
        rest = &rest[end..];
    }

    output.push_str(rest);
    output
}

fn join_sources(
    context: Option<&ContextWindow>,
    matches_kind: impl Fn(&ContextWindowSource) -> bool,
) -> String {
    let Some(context) = context else {
        return String::new();
    };

    context
        .sources
        .iter()
        .filter(|source| matches_kind(source))
        .map(ContextWindowSource::text)
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn context_chars_total(context: Option<&ContextWindow>) -> u32 {
    context
        .map(|context| {
            context
                .sources
                .iter()
                .filter(|source| {
                    matches!(
                        source,
                        ContextWindowSource::NoteText { .. }
                            | ContextWindowSource::PriorUtterance { .. }
                            | ContextWindowSource::GlossaryText { .. }
                    )
                })
                .map(|source| source.text().chars().count() as u32)
                .sum()
        })
        .unwrap_or(0)
}

fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

fn confidence_gate_trips(
    transcript: &Transcript,
    ctx: &StageContext<'_>,
    threshold: Option<f32>,
) -> bool {
    let Some(threshold) = threshold else {
        return false;
    };

    let mut total = 0.0_f32;
    let mut count = 0_u32;

    for index in 0..transcript.segments.len() {
        let Some(avg_logprob) = ctx
            .segment_diagnostics
            .get(index)
            .and_then(|diagnostics| diagnostics.avg_logprob)
        else {
            continue;
        };

        total += avg_logprob;
        count += 1;
    }

    count > 0 && total / count as f32 > threshold
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: OllamaMessage,
    #[serde(default)]
    done_reason: Option<String>,
    #[serde(default)]
    prompt_eval_count: Option<u32>,
    #[serde(default)]
    eval_count: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: String,
}

#[derive(Clone, Copy)]
struct LlmPayloadInput<'a> {
    context_chars_total: u32,
    done_reason: &'a str,
    eval_count: Option<u32>,
    model: &'a str,
    output_chars: u32,
    prompt_eval_count: Option<u32>,
    skipped_reason: Option<&'a str>,
    truncated: bool,
}

fn llm_payload(input: LlmPayloadInput<'_>) -> serde_json::Value {
    json!({
        "contextCharsTotal": input.context_chars_total,
        "doneReason": input.done_reason,
        "durationMs": 0,
        "evalCount": input.eval_count,
        "model": input.model,
        "outputChars": input.output_chars,
        "promptEvalCount": input.prompt_eval_count,
        "skippedReason": input.skipped_reason,
        "truncated": input.truncated,
    })
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    use serde_json::Value;
    use tokio::runtime::Builder;
    use uuid::Uuid;

    use super::*;
    use crate::audio_metadata::VoiceActivityEvidence;
    use crate::engine::capabilities::{LanguageSupport, ModelFamilyCapabilities};
    use crate::protocol::{StageOutcome, StageStatus};
    use crate::stages::StageEnablement;
    use crate::transcription::SegmentDiagnostics;

    #[test]
    fn disabled_config_skips_without_transcript_payload() {
        let runtime = runtime();
        let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let transcript = transcript("secret transcript");
        let voice_activity = voice_activity();
        let caps = caps();
        let enablement = StageEnablement::default();
        let ctx = StageContext {
            cancel_rx: &cancel_rx,
            context: None,
            family_capabilities: &caps,
            is_final: true,
            llm_postprocess: None,
            pause_ms_before_utterance: None,
            segment_diagnostics: &[],
            stage_enabled: &enablement,
            tokio_runtime: &runtime,
            vad_probabilities: &[],
            voice_activity: &voice_activity,
        };

        let result = LlmPostprocessStage::new().process(&transcript, &ctx);

        match result {
            StageProcess::Skipped { reason, payload } => {
                assert_eq!(reason, "disabled");
                let payload = payload.expect("skip should carry diagnostic payload");
                assert_eq!(payload["skippedReason"], "disabled");
                assert!(!payload.to_string().contains("secret transcript"));
            }
            _ => panic!("expected skipped"),
        }
    }

    #[test]
    fn skip_gates_run_before_http() {
        let runtime = runtime();
        let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let transcript = transcript("yes");
        let voice_activity = voice_activity();
        let caps = caps();
        let enablement = StageEnablement::default();
        let config = config();
        let ctx = StageContext {
            cancel_rx: &cancel_rx,
            context: None,
            family_capabilities: &caps,
            is_final: true,
            llm_postprocess: Some(&config),
            pause_ms_before_utterance: None,
            segment_diagnostics: &[],
            stage_enabled: &enablement,
            tokio_runtime: &runtime,
            vad_probabilities: &[],
            voice_activity: &voice_activity,
        };

        let stage = LlmPostprocessStage::with_chat_url("http://127.0.0.1:9/api/chat");
        let result = stage.process(&transcript, &ctx);

        match result {
            StageProcess::Skipped { reason, .. } => assert_eq!(reason, "below_min_words"),
            _ => panic!("expected below_min_words skip"),
        }
    }

    #[test]
    fn high_confidence_gate_uses_available_logprobs_only() {
        let runtime = runtime();
        let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let transcript = transcript("this is clearly enough words");
        let voice_activity = voice_activity();
        let caps = caps();
        let enablement = StageEnablement::default();
        let mut config = config();
        config.skip_if_avg_logprob_above = Some(-0.5);
        let diagnostics = [SegmentDiagnostics {
            avg_logprob: Some(-0.25),
            decode_reached_eos: None,
            no_speech_prob: None,
            token_count: None,
        }];
        let ctx = StageContext {
            cancel_rx: &cancel_rx,
            context: None,
            family_capabilities: &caps,
            is_final: true,
            llm_postprocess: Some(&config),
            pause_ms_before_utterance: None,
            segment_diagnostics: &diagnostics,
            stage_enabled: &enablement,
            tokio_runtime: &runtime,
            vad_probabilities: &[],
            voice_activity: &voice_activity,
        };

        let result = LlmPostprocessStage::with_chat_url("http://127.0.0.1:9/api/chat")
            .process(&transcript, &ctx);

        match result {
            StageProcess::Skipped { reason, .. } => assert_eq!(reason, "high_confidence"),
            _ => panic!("expected high_confidence skip"),
        }
    }

    #[test]
    fn prompt_renderer_substitutes_known_placeholders_once() {
        let mut config = config();
        config.voice_slot = "Voice {{utterance}}".to_string();
        config.format_slot = "Format".to_string();
        config.user_template = "{{glossary}}|{{voice}}|{{format}}|{{note_context}}|{{prior_utterances}}|{{utterance}}|{{unknown}}".to_string();
        let context = ContextWindow {
            budget_chars: 7000,
            sources: vec![
                ContextWindowSource::NoteText {
                    text: "note prose".to_string(),
                    truncated: false,
                },
                ContextWindowSource::PriorUtterance {
                    text: "first prior".to_string(),
                    truncated: false,
                },
                ContextWindowSource::PriorUtterance {
                    text: "second prior".to_string(),
                    truncated: false,
                },
                ContextWindowSource::GlossaryText {
                    text: "glossary".to_string(),
                    truncated: false,
                },
            ],
            text: String::new(),
            truncated: false,
        };

        let rendered = render_user_message(&config, Some(&context), "current words");

        assert_eq!(
            rendered,
            "glossary|Voice {{utterance}}|Format|note prose|first prior\n\nsecond prior|current words|{{unknown}}"
        );
    }

    #[test]
    fn successful_response_collapses_to_one_segment_and_uses_chat_shape() {
        let (url, body_rx) = start_mock_ollama(
            r#"{"message":{"content":"  Cleaned output.  "},"done_reason":"stop","prompt_eval_count":11,"eval_count":7}"#,
        );
        let runtime = runtime();
        let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let transcript = transcript("input secret words now");
        let voice_activity = voice_activity();
        let caps = caps();
        let enablement = StageEnablement::default();
        let mut config = config();
        config.user_template = "<utterance>{{utterance}}</utterance>{{unknown}}".to_string();
        let context = ContextWindow {
            budget_chars: 7000,
            sources: vec![ContextWindowSource::NoteText {
                text: "note context".to_string(),
                truncated: false,
            }],
            text: String::new(),
            truncated: false,
        };
        let ctx = StageContext {
            cancel_rx: &cancel_rx,
            context: Some(&context),
            family_capabilities: &caps,
            is_final: true,
            llm_postprocess: Some(&config),
            pause_ms_before_utterance: None,
            segment_diagnostics: &[],
            stage_enabled: &enablement,
            tokio_runtime: &runtime,
            vad_probabilities: &[],
            voice_activity: &voice_activity,
        };

        let result = LlmPostprocessStage::with_chat_url(url).process(&transcript, &ctx);

        match result {
            StageProcess::Ok { segments, payload } => {
                assert_eq!(segments.len(), 1);
                assert_eq!(segments[0].start_ms, 0);
                assert_eq!(segments[0].end_ms, 1_000);
                assert_eq!(segments[0].text, "Cleaned output.");
                let payload = payload.expect("ok should carry diagnostic payload");
                assert_eq!(payload["model"], "llama3.2:latest");
                assert_eq!(payload["contextCharsTotal"], 12);
                assert!(!payload.to_string().contains("input secret words"));
            }
            _ => panic!("expected ok"),
        }

        let body = body_rx.recv().expect("mock server should capture body");
        assert_eq!(body["model"], "llama3.2:latest");
        assert_eq!(body["stream"], false);
        assert_eq!(body["think"], false);
        assert_eq!(body["keep_alive"], "30m");
        assert!((body["options"]["temperature"].as_f64().unwrap() - 0.2).abs() < 0.000_001);
        assert_eq!(body["options"]["num_predict"], 512);
        assert_eq!(body["options"]["seed"], 0);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "Clean this utterance.");
        assert_eq!(
            body["messages"][1]["content"],
            "<utterance>input secret words now</utterance>{{unknown}}"
        );
    }

    fn start_mock_ollama(response_body: &'static str) -> (String, mpsc::Receiver<Value>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("mock server binds");
        let addr = listener.local_addr().expect("mock server addr");
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("request should arrive");
            let mut buffer = vec![0_u8; 16 * 1024];
            let read = stream.read(&mut buffer).expect("request should read");
            let request = String::from_utf8_lossy(&buffer[..read]);
            let body_start = request.find("\r\n\r\n").expect("headers should end") + 4;
            let body: Value =
                serde_json::from_str(&request[body_start..]).expect("request body should parse");
            tx.send(body).expect("test should receive body");
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
        });

        (format!("http://{addr}/api/chat"), rx)
    }

    fn config() -> LlmPostprocessConfig {
        LlmPostprocessConfig {
            format_slot: String::new(),
            glossary_chars: 1000,
            glossary_text: String::new(),
            keep_alive: "30m".to_string(),
            model: "llama3.2:latest".to_string(),
            note_context_chars: 3000,
            num_predict: 512,
            prior_utterances_n: 2,
            seed: 0,
            show_raw_below: false,
            skip_if_avg_logprob_above: None,
            skip_min_words: 4,
            system_slot: "Clean this utterance.".to_string(),
            temperature: 0.2,
            total_context_cap: 7000,
            user_template: "{{utterance}}".to_string(),
            voice_slot: String::new(),
        }
    }

    fn transcript(text: &str) -> Transcript {
        Transcript {
            utterance_id: Uuid::nil(),
            revision: 0,
            segments: vec![TranscriptSegment {
                end_ms: 1_000,
                start_ms: 0,
                text: text.to_string(),
                timestamp_granularity: TimestampGranularity::Segment,
                timestamp_source: TimestampSource::Engine,
            }],
            stage_history: vec![StageOutcome {
                duration_ms: 0,
                is_final: true,
                payload: None,
                revision_in: 0,
                revision_out: Some(0),
                stage_id: StageId::Engine,
                status: StageStatus::Ok,
            }],
        }
    }

    fn voice_activity() -> VoiceActivityEvidence {
        VoiceActivityEvidence {
            audio_start_ms: 0,
            audio_end_ms: 1_000,
            speech_start_ms: 0,
            speech_end_ms: 1_000,
            voiced_ms: 1_000,
            unvoiced_ms: 0,
            mean_probability: 0.9,
            max_probability: 1.0,
        }
    }

    fn caps() -> ModelFamilyCapabilities {
        ModelFamilyCapabilities {
            supports_segment_timestamps: true,
            supports_word_timestamps: false,
            supports_initial_prompt: true,
            supports_language_selection: false,
            supported_languages: LanguageSupport::EnglishOnly,
            max_audio_duration_secs: None,
            produces_punctuation: true,
        }
    }

    fn runtime() -> tokio::runtime::Runtime {
        Builder::new_current_thread().enable_all().build().unwrap()
    }
}
