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

/// Normalize Serbian Cyrillic to Latin for recognition scoring only. The
/// reverse mapping is context-sensitive (`nj`, `lj`, and `dž` can be one letter
/// or two), so production output must never use this scorer as a transliterator.
pub fn to_serbian_latin(text: &str) -> String {
    let mut latin = String::with_capacity(text.len());
    for character in text.to_lowercase().chars() {
        match character {
            'а' => latin.push('a'),
            'б' => latin.push('b'),
            'в' => latin.push('v'),
            'г' => latin.push('g'),
            'д' => latin.push('d'),
            'ђ' => latin.push('đ'),
            'е' => latin.push('e'),
            'ж' => latin.push('ž'),
            'з' => latin.push('z'),
            'и' => latin.push('i'),
            'ј' => latin.push('j'),
            'к' => latin.push('k'),
            'л' => latin.push('l'),
            'љ' => latin.push_str("lj"),
            'м' => latin.push('m'),
            'н' => latin.push('n'),
            'њ' => latin.push_str("nj"),
            'о' => latin.push('o'),
            'п' => latin.push('p'),
            'р' => latin.push('r'),
            'с' => latin.push('s'),
            'т' => latin.push('t'),
            'ћ' => latin.push('ć'),
            'у' => latin.push('u'),
            'ф' => latin.push('f'),
            'х' => latin.push('h'),
            'ц' => latin.push('c'),
            'ч' => latin.push('č'),
            'џ' => latin.push_str("dž"),
            'ш' => latin.push('š'),
            other => latin.push(other),
        }
    }
    latin
}

/// Share of Serbian Cyrillic and Latin alphabetic output written in Cyrillic.
/// Numbers, punctuation, and unrelated scripts are ignored. Latin product names
/// still count, so the real-model gate allows a small amount of mixed output.
pub fn serbian_cyrillic_share(text: &str) -> f64 {
    let mut cyrillic = 0_usize;
    let mut latin = 0_usize;

    for character in text.chars() {
        if "АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШабвгдђежзијклљмнњопрстћуфхцчџш".contains(character)
        {
            cyrillic += 1;
        } else if character.is_ascii_alphabetic() || "ČĆĐŠŽčćđšž".contains(character) {
            latin += 1;
        }
    }

    let total = cyrillic + latin;
    if total == 0 {
        0.0
    } else {
        cyrillic as f64 / total as f64
    }
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
