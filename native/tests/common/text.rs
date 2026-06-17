//! Transcript scoring: normalization, Word Error Rate, and anchor checks.
//!
//! ASR output varies across model versions and acceleration backends, so the
//! suite asserts on robust, fuzzy measures rather than exact string equality:
//! a Word Error Rate budget plus a set of must-appear "anchor" words. Both are
//! computed over a normalized token stream (lowercased, punctuation stripped).

/// Normalize text into comparable word tokens: lowercase, drop everything that
/// is not an ASCII alphanumeric or whitespace, then split on whitespace.
pub fn normalize(text: &str) -> Vec<String> {
    text.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c.is_whitespace() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
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
fn edit_distance(reference: &[String], hypothesis: &[String]) -> usize {
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
