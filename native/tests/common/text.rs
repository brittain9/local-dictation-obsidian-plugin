//! Transcript scoring: normalization, Word Error Rate, and anchor checks.
//!
//! ASR output varies across model versions and acceleration backends, so the
//! suite asserts on robust, fuzzy measures rather than exact string equality:
//! a Word Error Rate budget plus a set of must-appear "anchor" words. Both are
//! computed over a normalized token stream (lowercased, punctuation stripped).

use local_dictation_sidecar::transcription::EngineTranscriptOutput;

/// User-visible transcript text, with empty engine segments omitted.
pub fn joined_text(output: &EngineTranscriptOutput) -> String {
    output
        .segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Normalize text into comparable word tokens: lowercase, retain Unicode
/// letters/numbers and whitespace, then split on whitespace.
pub fn normalize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

/// Character error rate for scripts whose words are not separated by spaces.
pub fn character_error_rate(reference: &str, hypothesis: &str) -> f64 {
    let reference = normalized_characters(reference);
    let hypothesis = normalized_characters(hypothesis);
    if reference.is_empty() {
        return if hypothesis.is_empty() { 0.0 } else { 1.0 };
    }
    edit_distance(&reference, &hypothesis) as f64 / reference.len() as f64
}

fn normalized_characters(text: &str) -> Vec<char> {
    text.to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect()
}

/// Word Error Rate of `hypothesis` against `reference`: word-level Levenshtein
/// edit distance divided by the reference word count. 0.0 is perfect; values
/// can exceed 1.0 when the hypothesis has many insertions. An empty reference
/// yields 0.0 for an empty hypothesis and 1.0 otherwise.
pub fn word_error_rate(reference: &str, hypothesis: &str) -> f64 {
    let reference = normalize(reference);
    let hypothesis = normalize(hypothesis);

    if reference.is_empty() {
        return if hypothesis.is_empty() { 0.0 } else { 1.0 };
    }

    edit_distance(&reference, &hypothesis) as f64 / reference.len() as f64
}

/// Anchor words (already lowercased) that are absent from the hypothesis. An
/// empty result means every anchor is present.
pub fn missing_anchors(hypothesis: &str, anchors: &[String]) -> Vec<String> {
    let tokens = normalize(hypothesis);
    anchors
        .iter()
        .filter(|anchor| {
            let needle = anchor.to_ascii_lowercase();
            !tokens.contains(&needle)
        })
        .cloned()
        .collect()
}

/// Classic two-row Levenshtein over token slices.
fn edit_distance<T: PartialEq>(reference: &[T], hypothesis: &[T]) -> usize {
    let mut previous: Vec<usize> = (0..=hypothesis.len()).collect();
    let mut current = vec![0_usize; hypothesis.len() + 1];

    for (i, ref_word) in reference.iter().enumerate() {
        current[0] = i + 1;
        for (j, hyp_word) in hypothesis.iter().enumerate() {
            let substitution_cost = usize::from(ref_word != hyp_word);
            current[j + 1] = (previous[j] + substitution_cost)
                .min(previous[j + 1] + 1)
                .min(current[j] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }

    previous[hypothesis.len()]
}
