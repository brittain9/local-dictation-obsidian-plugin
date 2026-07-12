use std::collections::HashSet;

use regex::{Regex, RegexBuilder};

use crate::protocol::{StageId, UserRule};
use crate::stages::{StageContext, StageProcess, StageProcessor};
use crate::transcription::Transcript;

struct CompiledRule {
    matcher: Regex,
    replacement: String,
    whole_word: bool,
}

pub struct UserRulesStage {
    rules: Vec<CompiledRule>,
}

impl UserRulesStage {
    pub fn new(rules: &[UserRule]) -> Self {
        Self {
            rules: rules.iter().map(CompiledRule::new).collect(),
        }
    }
}

impl CompiledRule {
    fn new(rule: &UserRule) -> Self {
        let matcher = RegexBuilder::new(&regex::escape(&rule.source))
            .case_insensitive(!rule.case_sensitive)
            .build()
            .expect("escaped literal correction rules always compile");
        Self {
            matcher,
            replacement: rule.replacement.clone(),
            whole_word: rule.whole_word,
        }
    }

    fn apply(&self, input: &str) -> (String, usize) {
        let mut output = String::with_capacity(input.len());
        let mut copied_until = 0;
        let mut replacement_count = 0;

        for matched in self.matcher.find_iter(input) {
            if self.whole_word && !has_word_boundaries(input, matched.start(), matched.end()) {
                continue;
            }
            output.push_str(&input[copied_until..matched.start()]);
            output.push_str(&self.replacement);
            copied_until = matched.end();
            replacement_count += 1;
        }

        if replacement_count == 0 {
            return (input.to_string(), 0);
        }

        output.push_str(&input[copied_until..]);
        (output, replacement_count)
    }
}

impl StageProcessor for UserRulesStage {
    fn id(&self) -> StageId {
        StageId::UserRules
    }

    fn process(&self, transcript: &Transcript, _ctx: &StageContext<'_>) -> StageProcess {
        let mut segments = transcript.segments.clone();
        let mut replacement_count = 0;
        let mut applied_rule_indices = HashSet::new();

        for segment in &mut segments {
            for (index, rule) in self.rules.iter().enumerate() {
                let (text, count) = rule.apply(&segment.text);
                if count > 0 {
                    segment.text = text;
                    replacement_count += count;
                    applied_rule_indices.insert(index);
                }
            }
        }

        if replacement_count == 0 {
            return StageProcess::Skipped {
                reason: "no_match".to_string(),
                payload: Some(serde_json::json!({
                    "configuredRuleCount": self.rules.len(),
                    "replacementCount": 0,
                })),
            };
        }

        StageProcess::Ok {
            segments,
            payload: Some(serde_json::json!({
                "appliedRuleCount": applied_rule_indices.len(),
                "configuredRuleCount": self.rules.len(),
                "replacementCount": replacement_count,
            })),
        }
    }
}

fn has_word_boundaries(input: &str, start: usize, end: usize) -> bool {
    let before_is_word = input[..start]
        .chars()
        .next_back()
        .is_some_and(is_word_character);
    let after_is_word = input[end..].chars().next().is_some_and(is_word_character);
    !before_is_word && !after_is_word
}

fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_metadata::VoiceActivityEvidence;
    use crate::engine::capabilities::{LanguageSupport, ModelFamilyCapabilities};
    use crate::protocol::{TimestampGranularity, TimestampSource, TranscriptSegment};
    use crate::stages::StageEnablement;
    use uuid::Uuid;

    fn rule(source: &str, replacement: &str) -> UserRule {
        UserRule {
            case_sensitive: false,
            replacement: replacement.to_string(),
            source: source.to_string(),
            whole_word: true,
        }
    }

    fn transcript(parts: &[&str]) -> Transcript {
        Transcript {
            utterance_id: Uuid::nil(),
            revision: 0,
            segments: parts
                .iter()
                .enumerate()
                .map(|(index, text)| TranscriptSegment {
                    end_ms: (index as u64 + 1) * 1_000,
                    speaker: None,
                    start_ms: index as u64 * 1_000,
                    text: (*text).to_string(),
                    timestamp_granularity: TimestampGranularity::Segment,
                    timestamp_source: TimestampSource::Engine,
                })
                .collect(),
            stage_history: Vec::new(),
        }
    }

    fn context() -> StageContext<'static> {
        static CAPS: ModelFamilyCapabilities = ModelFamilyCapabilities {
            supports_segment_timestamps: true,
            supports_word_timestamps: false,
            supports_initial_prompt: true,
            supports_streaming: false,
            supports_language_selection: false,
            supported_languages: LanguageSupport::EnglishOnly,
            max_audio_duration_secs: None,
            produces_punctuation: true,
        };
        static ENABLEMENT: StageEnablement = StageEnablement {
            hallucination_filter: true,
        };
        static VOICE_ACTIVITY: VoiceActivityEvidence = VoiceActivityEvidence {
            audio_start_ms: 0,
            audio_end_ms: 2_000,
            speech_start_ms: 0,
            speech_end_ms: 2_000,
            voiced_ms: 2_000,
            unvoiced_ms: 0,
            mean_probability: 1.0,
            max_probability: 1.0,
        };
        let runtime = Box::leak(Box::new(
            tokio::runtime::Builder::new_current_thread()
                .build()
                .expect("runtime"),
        ));
        let (_, cancel_rx) = tokio::sync::watch::channel(false);
        let cancel_rx = Box::leak(Box::new(cancel_rx));
        StageContext {
            cancel_rx,
            context: None,
            family_capabilities: &CAPS,
            is_final: true,
            pause_ms_before_utterance: None,
            segment_diagnostics: &[],
            stage_enabled: &ENABLEMENT,
            tokio_runtime: runtime,
            vad_probabilities: &[],
            voice_activity: &VOICE_ACTIVITY,
        }
    }

    #[test]
    fn applies_ordered_literal_rules_across_segments_without_moving_boundaries() {
        let stage = UserRulesStage::new(&[
            rule("kuber netes", "Kubernetes"),
            rule("Kubernetes cluster", "K8s cluster"),
        ]);
        let input = transcript(&["Our kuber netes cluster", "and KUBER NETES service"]);

        let StageProcess::Ok { segments, payload } = stage.process(&input, &context()) else {
            panic!("expected replacements");
        };

        assert_eq!(segments[0].text, "Our K8s cluster");
        assert_eq!(segments[1].text, "and Kubernetes service");
        assert_eq!(segments[0].start_ms, 0);
        assert_eq!(segments[1].end_ms, 2_000);
        assert_eq!(payload.unwrap()["replacementCount"], 3);
    }

    #[test]
    fn honors_case_and_unicode_word_boundaries() {
        let mut exact = rule("obsidian", "Obsidian");
        exact.case_sensitive = true;
        let stage = UserRulesStage::new(&[exact, rule("cafe", "coffee")]);
        let input = transcript(&["obsidian Obsidian obsidianite cafe café_cafe"]);

        let StageProcess::Ok { segments, .. } = stage.process(&input, &context()) else {
            panic!("expected replacements");
        };

        assert_eq!(
            segments[0].text,
            "Obsidian Obsidian obsidianite coffee café_cafe"
        );
    }

    #[test]
    fn reports_no_match_without_mutating_the_transcript() {
        let stage = UserRulesStage::new(&[rule("alpha", "beta")]);
        let input = transcript(&["gamma"]);

        let StageProcess::Skipped { reason, payload } = stage.process(&input, &context()) else {
            panic!("expected skip");
        };

        assert_eq!(reason, "no_match");
        assert_eq!(payload.unwrap()["replacementCount"], 0);
        assert_eq!(input.segments[0].text, "gamma");
    }
}
