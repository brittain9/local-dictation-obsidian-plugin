use std::collections::HashSet;

use regex::{Regex, RegexBuilder};

use crate::protocol::{StageId, TranscriptSegment, UserRule};
use crate::stages::{StageContext, StageProcess, StageProcessor};
use crate::transcription::{Transcript, join_segment_text};

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

    fn apply(&self, segments: &mut [TranscriptSegment]) -> Result<usize, String> {
        let view = CanonicalSegmentView::new(segments);
        let matches: Vec<MappedMatch> = self
            .matcher
            .find_iter(&view.text)
            .filter(|matched| {
                !self.whole_word || has_word_boundaries(&view.text, matched.start(), matched.end())
            })
            .map(|matched| {
                Ok(MappedMatch {
                    end: view.end_location(matched.end()).ok_or_else(|| {
                        "correction match end could not be mapped to a segment".to_string()
                    })?,
                    range_end: matched.end(),
                    range_start: matched.start(),
                    start: view.start_location(matched.start()).ok_or_else(|| {
                        "correction match start could not be mapped to a segment".to_string()
                    })?,
                })
            })
            .collect::<Result<_, String>>()?;

        if matches.is_empty() {
            return Ok(0);
        }

        let mut expected = view.text;
        for matched in matches.iter().rev() {
            expected.replace_range(matched.range_start..matched.range_end, &self.replacement);
            apply_mapped_replacement(segments, *matched, &self.replacement);
        }

        if join_segment_text(segments) != expected.trim() {
            return Err(
                "correction result could not be mapped without changing segment timing".to_string(),
            );
        }

        Ok(matches.len())
    }
}

#[derive(Clone, Copy)]
struct SegmentLocation {
    byte_offset: usize,
    segment_index: usize,
}

#[derive(Clone, Copy)]
struct MappedMatch {
    end: SegmentLocation,
    range_end: usize,
    range_start: usize,
    start: SegmentLocation,
}

struct CanonicalSegment {
    canonical_end: usize,
    canonical_start: usize,
    segment_index: usize,
    source_end: usize,
    source_start: usize,
}

struct CanonicalSegmentView {
    segments: Vec<CanonicalSegment>,
    text: String,
}

impl CanonicalSegmentView {
    fn new(segments: &[TranscriptSegment]) -> Self {
        let mut text = String::new();
        let mut mapped_segments = Vec::with_capacity(segments.len());

        for (segment_index, segment) in segments.iter().enumerate() {
            let trimmed = segment.text.trim();
            if trimmed.is_empty() {
                continue;
            }
            if !mapped_segments.is_empty() {
                text.push(' ');
            }

            let source_start = segment
                .text
                .find(trimmed)
                .expect("trimmed segment text must be a substring");
            let canonical_start = text.len();
            text.push_str(trimmed);
            mapped_segments.push(CanonicalSegment {
                canonical_end: text.len(),
                canonical_start,
                segment_index,
                source_end: source_start + trimmed.len(),
                source_start,
            });
        }

        Self {
            segments: mapped_segments,
            text,
        }
    }

    fn start_location(&self, offset: usize) -> Option<SegmentLocation> {
        for (index, segment) in self.segments.iter().enumerate() {
            if (segment.canonical_start..segment.canonical_end).contains(&offset) {
                return Some(SegmentLocation {
                    byte_offset: segment.source_start + offset - segment.canonical_start,
                    segment_index: segment.segment_index,
                });
            }

            let next = self.segments.get(index + 1);
            if offset == segment.canonical_end
                && next.is_some_and(|next| offset < next.canonical_start)
            {
                return Some(SegmentLocation {
                    byte_offset: segment.source_end,
                    segment_index: segment.segment_index,
                });
            }
        }
        None
    }

    fn end_location(&self, offset: usize) -> Option<SegmentLocation> {
        for segment in &self.segments {
            if offset == segment.canonical_start {
                return Some(SegmentLocation {
                    byte_offset: segment.source_start,
                    segment_index: segment.segment_index,
                });
            }
            if offset > segment.canonical_start && offset <= segment.canonical_end {
                return Some(SegmentLocation {
                    byte_offset: segment.source_start + offset - segment.canonical_start,
                    segment_index: segment.segment_index,
                });
            }
        }
        None
    }
}

fn apply_mapped_replacement(
    segments: &mut [TranscriptSegment],
    matched: MappedMatch,
    replacement: &str,
) {
    let first_index = matched.start.segment_index;
    let last_index = matched.end.segment_index;

    if first_index == last_index {
        let text = &segments[first_index].text;
        let mut output = String::with_capacity(
            text.len() + replacement.len() - (matched.end.byte_offset - matched.start.byte_offset),
        );
        output.push_str(&text[..matched.start.byte_offset]);
        output.push_str(replacement);
        output.push_str(&text[matched.end.byte_offset..]);
        segments[first_index].text = output;
        return;
    }

    let prefix = segments[first_index].text[..matched.start.byte_offset].to_string();
    let suffix = segments[last_index].text[matched.end.byte_offset..].to_string();
    let mut first_text = String::with_capacity(prefix.len() + replacement.len() + suffix.len());
    first_text.push_str(&prefix);
    first_text.push_str(replacement);

    if split_preserves_canonical_text(&first_text, &suffix) {
        segments[first_index].text = first_text;
        for segment in &mut segments[first_index + 1..last_index] {
            segment.text.clear();
        }
        segments[last_index].text = suffix;
        return;
    }

    first_text.push_str(&suffix);
    segments[first_index].text = first_text;
    for segment in &mut segments[first_index + 1..=last_index] {
        segment.text.clear();
    }
}

fn split_preserves_canonical_text(left: &str, right: &str) -> bool {
    let direct = format!("{left}{right}");
    let joined = match (left.trim().is_empty(), right.trim().is_empty()) {
        (true, true) => String::new(),
        (true, false) => right.trim().to_string(),
        (false, true) => left.trim().to_string(),
        (false, false) => format!("{} {}", left.trim(), right.trim()),
    };
    joined == direct.trim()
}

impl StageProcessor for UserRulesStage {
    fn id(&self) -> StageId {
        StageId::UserRules
    }

    fn process(&self, transcript: &Transcript, _ctx: &StageContext<'_>) -> StageProcess {
        let mut segments = transcript.segments.clone();
        let mut replacement_count = 0;
        let mut applied_rule_indices = HashSet::new();

        for (index, rule) in self.rules.iter().enumerate() {
            let mut group_start = 0;
            while group_start < segments.len() {
                let speaker = segments[group_start].speaker;
                let group_end = segments[group_start + 1..]
                    .iter()
                    .position(|segment| segment.speaker != speaker)
                    .map_or(segments.len(), |offset| group_start + 1 + offset);
                match rule.apply(&mut segments[group_start..group_end]) {
                    Ok(count) if count > 0 => {
                        replacement_count += count;
                        applied_rule_indices.insert(index);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        return StageProcess::Failed {
                            error,
                            payload: Some(serde_json::json!({
                                "configuredRuleCount": self.rules.len(),
                                "replacementCount": replacement_count,
                            })),
                        };
                    }
                }
                group_start = group_end;
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
    use crate::protocol::{TimestampGranularity, TimestampSource};
    use crate::stages::StageEnablement;
    use serde::Deserialize;
    use uuid::Uuid;

    #[derive(Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenRule {
        case_sensitive: bool,
        enabled: bool,
        id: String,
        replacement: String,
        source: String,
        whole_word: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenSegment {
        end_ms: u64,
        speaker: Option<u32>,
        start_ms: u64,
        text: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenCase {
        draft: GoldenRule,
        existing_rules: Vec<GoldenRule>,
        expected_segment_texts: Vec<String>,
        expected_text: String,
        input_segments: Vec<GoldenSegment>,
        is_new: bool,
        name: String,
    }

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

    fn golden_cases() -> Vec<GoldenCase> {
        serde_json::from_str(include_str!(
            "../../../test/fixtures/personal-corrections-golden.json"
        ))
        .expect("personal correction golden cases should parse")
    }

    fn active_golden_rules(case: &GoldenCase) -> Vec<UserRule> {
        let mut configured = case.existing_rules.clone();
        if case.is_new {
            configured.push(case.draft.clone());
        } else if let Some(index) = configured.iter().position(|rule| rule.id == case.draft.id) {
            configured[index] = case.draft.clone();
        }

        configured
            .into_iter()
            .filter(|rule| rule.enabled)
            .map(|rule| UserRule {
                case_sensitive: rule.case_sensitive,
                replacement: rule.replacement,
                source: rule.source,
                whole_word: rule.whole_word,
            })
            .collect()
    }

    fn golden_transcript(case: &GoldenCase) -> Transcript {
        Transcript {
            utterance_id: Uuid::nil(),
            revision: 0,
            segments: case
                .input_segments
                .iter()
                .map(|segment| TranscriptSegment {
                    end_ms: segment.end_ms,
                    speaker: segment.speaker,
                    start_ms: segment.start_ms,
                    text: segment.text.clone(),
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
    fn shared_golden_cases_match_preview_semantics_without_changing_segment_records() {
        for case in golden_cases() {
            let input = golden_transcript(&case);
            let original_timing: Vec<_> = input
                .segments
                .iter()
                .map(|segment| (segment.start_ms, segment.end_ms, segment.speaker))
                .collect();
            let stage = UserRulesStage::new(&active_golden_rules(&case));

            let segments = match stage.process(&input, &context()) {
                StageProcess::Ok { segments, .. } => segments,
                StageProcess::Skipped { .. } => input.segments.clone(),
                StageProcess::Failed { error, .. } => {
                    panic!("golden case '{}' failed: {error}", case.name)
                }
            };

            assert_eq!(
                join_segment_text(&segments),
                case.expected_text,
                "golden case '{}' text",
                case.name
            );
            assert_eq!(
                segments
                    .iter()
                    .map(|segment| segment.text.clone())
                    .collect::<Vec<_>>(),
                case.expected_segment_texts,
                "golden case '{}' segment allocation",
                case.name
            );
            assert_eq!(
                segments
                    .iter()
                    .map(|segment| (segment.start_ms, segment.end_ms, segment.speaker))
                    .collect::<Vec<_>>(),
                original_timing,
                "golden case '{}' timing and speakers",
                case.name
            );
        }
    }

    #[test]
    fn does_not_match_across_speaker_boundaries() {
        let stage = UserRulesStage::new(&[rule("New York", "NYC")]);
        let mut input = transcript(&["New", "York"]);
        input.segments[0].speaker = Some(0);
        input.segments[1].speaker = Some(1);

        let StageProcess::Skipped { reason, .. } = stage.process(&input, &context()) else {
            panic!("expected speaker boundary to prevent a match");
        };

        assert_eq!(reason, "no_match");
        assert_eq!(input.joined_text(), "New York");
    }

    #[test]
    fn cross_segment_match_keeps_unrelated_records_for_later_diarization() {
        let stage = UserRulesStage::new(&[rule("New York", "NYC")]);
        let input = transcript(&["New", "York,", "then Albany"]);
        let original_timing: Vec<_> = input
            .segments
            .iter()
            .map(|segment| (segment.start_ms, segment.end_ms))
            .collect();

        let StageProcess::Ok { segments, .. } = stage.process(&input, &context()) else {
            panic!("expected cross-segment replacement");
        };

        assert_eq!(join_segment_text(&segments), "NYC, then Albany");
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[2].text, "then Albany");
        assert_eq!(
            segments
                .iter()
                .map(|segment| (segment.start_ms, segment.end_ms))
                .collect::<Vec<_>>(),
            original_timing
        );
    }

    #[test]
    fn applies_multiple_matches_right_to_left_across_segment_boundaries() {
        let stage = UserRulesStage::new(&[rule("New York", "NYC")]);
        let input = transcript(&["New York", "and New", "York."]);

        let StageProcess::Ok { segments, payload } = stage.process(&input, &context()) else {
            panic!("expected replacements");
        };

        assert_eq!(join_segment_text(&segments), "NYC and NYC.");
        assert_eq!(segments.len(), input.segments.len());
        assert_eq!(payload.unwrap()["replacementCount"], 2);
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
