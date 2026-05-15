use std::sync::OnceLock;
use std::time::Duration;

use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::watch;

use crate::protocol::{
    ContextWindow, ContextWindowSource, LlmPostprocessConfig, StageId, TimestampGranularity,
    TimestampSource, TranscriptSegment,
};
use crate::stages::{StageContext, StageProcess, StageProcessor};
use crate::transcription::Transcript;

const OLLAMA_CHAT_URL: &str = "http://127.0.0.1:11434/api/chat";
const NUM_PREDICT: u32 = 512;

static OLLAMA_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn shared_ollama_client() -> Result<&'static reqwest::Client, String> {
    if let Some(client) = OLLAMA_CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;
    Ok(OLLAMA_CLIENT.get_or_init(|| built))
}

pub struct LlmPostprocessStage {
    chat_url: String,
}

impl LlmPostprocessStage {
    #[must_use]
    pub fn new() -> Self {
        Self::with_chat_url(OLLAMA_CHAT_URL)
    }

    #[must_use]
    pub(crate) fn with_chat_url(chat_url: impl Into<String>) -> Self {
        Self {
            chat_url: chat_url.into(),
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
        let context_chars = context_chars_total(ctx.context);

        let Some(config) = ctx.llm_postprocess else {
            return skipped(skipped_payload(None, context_chars, "disabled"), "disabled");
        };

        let input = transcript.joined_text();
        let trimmed_input = input.trim();
        if trimmed_input.is_empty() {
            return skipped(
                skipped_payload(Some(&config.model), context_chars, "empty_input"),
                "empty_input",
            );
        }
        if config.skip_min_words > 0 && word_count(trimmed_input) < config.skip_min_words as usize {
            return skipped(
                skipped_payload(Some(&config.model), context_chars, "below_min_words"),
                "below_min_words",
            );
        }

        let client = match shared_ollama_client() {
            Ok(client) => client,
            Err(error) => {
                return failed(
                    failed_payload(&config.model, context_chars, None, 0, false),
                    error,
                );
            }
        };

        let user_message = render_user_message(ctx.context, trimmed_input);
        let mut cancel_rx = ctx.cancel_rx.clone();
        let chat_result = ctx.tokio_runtime.block_on(async {
            tokio::select! {
                biased;
                () = wait_until_cancelled(&mut cancel_rx) => None,
                result = send_chat(client, &self.chat_url, config, user_message) => Some(result),
            }
        });

        let response = match chat_result {
            None => {
                return skipped(
                    skipped_payload(Some(&config.model), context_chars, "cancelled"),
                    "cancelled",
                );
            }
            Some(Ok(response)) => response,
            Some(Err(error)) => {
                return failed(
                    failed_payload(&config.model, context_chars, None, 0, false),
                    error,
                );
            }
        };

        let done_reason = response.done_reason.as_deref().unwrap_or("stop");
        let output = response.message.content.trim().to_string();
        let output_chars = output.len() as u32;
        let telemetry = ChatTelemetry {
            done_reason,
            eval_count: response.eval_count,
            prompt_eval_count: response.prompt_eval_count,
        };

        if done_reason != "stop" {
            let truncated = done_reason == "length";
            return failed(
                failed_payload(
                    &config.model,
                    context_chars,
                    Some(&telemetry),
                    output_chars,
                    truncated,
                ),
                format!("Ollama stopped with done_reason={done_reason}"),
            );
        }
        if output.is_empty() {
            return failed(
                failed_payload(
                    &config.model,
                    context_chars,
                    Some(&telemetry),
                    output_chars,
                    false,
                ),
                "Ollama returned empty output".to_string(),
            );
        }
        if output.len() > trimmed_input.len().saturating_mul(10).saturating_add(1_000) {
            return failed(
                failed_payload(
                    &config.model,
                    context_chars,
                    Some(&telemetry),
                    output_chars,
                    true,
                ),
                "Ollama output exceeded length guard".to_string(),
            );
        }

        let mut payload = ok_payload(&config.model, context_chars, &telemetry, output_chars);
        if config.show_raw_below
            && let Value::Object(map) = &mut payload
        {
            map.insert(
                "rawText".to_string(),
                Value::String(trimmed_input.to_string()),
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

fn skipped(payload: Value, reason: &'static str) -> StageProcess {
    StageProcess::Skipped {
        reason: reason.to_string(),
        payload: Some(payload),
    }
}

fn failed(payload: Value, error: String) -> StageProcess {
    StageProcess::Failed {
        error,
        payload: Some(payload),
    }
}

async fn wait_until_cancelled(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow_and_update() {
            return;
        }
        if rx.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
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
            { "role": "system", "content": config.prompt },
            { "role": "user", "content": user_message }
        ],
        "model": config.model,
        "options": {
            "num_predict": NUM_PREDICT,
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

fn render_user_message(context: Option<&ContextWindow>, utterance: &str) -> String {
    let note_context = join_sources(context, |source| {
        matches!(source, ContextWindowSource::NoteText { .. })
    });
    let prior_utterances = join_sources(context, |source| {
        matches!(source, ContextWindowSource::PriorUtterance { .. })
    });

    let mut sections = Vec::with_capacity(3);
    if !note_context.is_empty() {
        sections.push(format!("<note_context>\n{note_context}\n</note_context>"));
    }
    if !prior_utterances.is_empty() {
        sections.push(format!(
            "<prior_utterances>\n{prior_utterances}\n</prior_utterances>"
        ));
    }
    sections.push(format!("<utterance>\n{utterance}\n</utterance>"));
    sections.join("\n\n")
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

struct ChatTelemetry<'a> {
    done_reason: &'a str,
    eval_count: Option<u32>,
    prompt_eval_count: Option<u32>,
}

fn skipped_payload(model: Option<&str>, context_chars: u32, reason: &str) -> Value {
    json!({
        "contextCharsTotal": context_chars,
        "doneReason": Value::Null,
        "durationMs": 0,
        "evalCount": Value::Null,
        "model": model,
        "outputChars": 0,
        "promptEvalCount": Value::Null,
        "skippedReason": reason,
        "truncated": false,
    })
}

fn failed_payload(
    model: &str,
    context_chars: u32,
    telemetry: Option<&ChatTelemetry<'_>>,
    output_chars: u32,
    truncated: bool,
) -> Value {
    json!({
        "contextCharsTotal": context_chars,
        "doneReason": telemetry.map(|t| t.done_reason),
        "durationMs": 0,
        "evalCount": telemetry.and_then(|t| t.eval_count),
        "model": model,
        "outputChars": output_chars,
        "promptEvalCount": telemetry.and_then(|t| t.prompt_eval_count),
        "skippedReason": Value::Null,
        "truncated": truncated,
    })
}

fn ok_payload(
    model: &str,
    context_chars: u32,
    telemetry: &ChatTelemetry<'_>,
    output_chars: u32,
) -> Value {
    json!({
        "contextCharsTotal": context_chars,
        "doneReason": telemetry.done_reason,
        "durationMs": 0,
        "evalCount": telemetry.eval_count,
        "model": model,
        "outputChars": output_chars,
        "promptEvalCount": telemetry.prompt_eval_count,
        "skippedReason": Value::Null,
        "truncated": false,
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
    fn user_message_inlines_context_sources_in_order() {
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
            ],
            text: String::new(),
            truncated: false,
        };

        let rendered = render_user_message(Some(&context), "current words");

        assert_eq!(
            rendered,
            "<note_context>\nnote prose\n</note_context>\n\n\
             <prior_utterances>\nfirst prior\n\nsecond prior\n</prior_utterances>\n\n\
             <utterance>\ncurrent words\n</utterance>"
        );
    }

    #[test]
    fn user_message_omits_empty_context_sections() {
        let context = ContextWindow {
            budget_chars: 7000,
            sources: vec![
                ContextWindowSource::NoteText {
                    text: "   ".to_string(),
                    truncated: false,
                },
                ContextWindowSource::PriorUtterance {
                    text: String::new(),
                    truncated: false,
                },
            ],
            text: String::new(),
            truncated: false,
        };

        let rendered = render_user_message(Some(&context), "current words");

        assert_eq!(rendered, "<utterance>\ncurrent words\n</utterance>");
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
        let config = config();
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
        assert!(body["options"].get("seed").is_none());
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "Clean this utterance.");
        assert!(
            body["messages"][1]["content"]
                .as_str()
                .unwrap()
                .contains("<utterance>\ninput secret words now\n</utterance>")
        );
    }

    #[test]
    fn closed_cancel_channel_does_not_skip_chat() {
        let (url, body_rx) =
            start_mock_ollama(r#"{"message":{"content":"Cleaned output."},"done_reason":"stop"}"#);
        let runtime = runtime();
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        drop(cancel_tx);
        let transcript = transcript("input secret words now");
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

        let result = LlmPostprocessStage::with_chat_url(url).process(&transcript, &ctx);

        match result {
            StageProcess::Ok { segments, .. } => assert_eq!(segments[0].text, "Cleaned output."),
            _ => panic!("expected ok"),
        }
        body_rx.recv().expect("mock server should capture body");
    }

    #[test]
    fn cancellation_interrupts_in_flight_chat() {
        let (url, request_rx) = start_hanging_mock_ollama();
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let (result_tx, result_rx) = mpsc::channel();

        thread::spawn(move || {
            let runtime = runtime();
            let transcript = transcript("input secret words now");
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

            let result = LlmPostprocessStage::with_chat_url(url).process(&transcript, &ctx);
            let reason = match result {
                StageProcess::Skipped { reason, .. } => reason,
                StageProcess::Ok { .. } => "ok".to_string(),
                StageProcess::Failed { error, .. } => error,
            };
            result_tx.send(reason).expect("test should receive result");
        });

        request_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("mock server should receive request");
        cancel_tx.send(true).expect("cancel signal should send");

        assert_eq!(
            result_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("LLM stage should return after cancellation"),
            "cancelled"
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

    fn start_hanging_mock_ollama() -> (String, mpsc::Receiver<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("mock server binds");
        let addr = listener.local_addr().expect("mock server addr");
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("request should arrive");
            let mut buffer = vec![0_u8; 16 * 1024];
            let _ = stream.read(&mut buffer).expect("request should read");
            tx.send(()).expect("test should receive request signal");
            thread::sleep(Duration::from_secs(10));
        });

        (format!("http://{addr}/api/chat"), rx)
    }

    fn config() -> LlmPostprocessConfig {
        LlmPostprocessConfig {
            keep_alive: "30m".to_string(),
            model: "llama3.2:latest".to_string(),
            note_context_chars: 3000,
            prior_utterances_n: 2,
            prompt: "Clean this utterance.".to_string(),
            show_raw_below: false,
            skip_min_words: 4,
            temperature: 0.2,
            total_context_cap: 7000,
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
