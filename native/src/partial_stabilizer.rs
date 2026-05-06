//! Per-utterance LocalAgreement-2 stabilizer for live partial transcripts.
//!
//! Whisper is a Snapshot-strategy backend: every partial re-decodes the
//! rolling audio buffer from scratch, so consecutive partials disagree at
//! the tail. The stabilizer keeps the committed prefix (monotonic,
//! append-only within an utterance) and the previous raw decode; on each
//! new partial it commits the longest word-aligned prefix that the previous
//! and current decodes agree on, and only emits when that prefix strictly
//! extends what was already committed.

use uuid::Uuid;

#[derive(Debug, Default)]
pub struct PartialStabilizer {
    current_utterance_id: Option<Uuid>,
    committed_prefix: String,
    previous_decode: String,
}

impl PartialStabilizer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process a fresh partial decode. Returns `Some(stable_text)` when the
    /// committed prefix has grown, or `None` when the new agreement does not
    /// strictly extend the committed prefix.
    pub fn apply(&mut self, utterance_id: Uuid, latest_decode: &str) -> Option<String> {
        if self.current_utterance_id != Some(utterance_id) {
            self.current_utterance_id = Some(utterance_id);
            self.committed_prefix.clear();
            self.previous_decode.clear();
        }

        let agreement = agreed_prefix(&self.previous_decode, latest_decode);
        let candidate = word_aligned_prefix(latest_decode, agreement);

        self.previous_decode.clear();
        self.previous_decode.push_str(latest_decode);

        if candidate.len() > self.committed_prefix.len()
            && candidate.starts_with(&self.committed_prefix)
        {
            self.committed_prefix.clear();
            self.committed_prefix.push_str(candidate);
            Some(self.committed_prefix.clone())
        } else {
            None
        }
    }

    /// Forget the in-progress utterance. Call when a finalized transcript
    /// arrives so the next utterance starts from a clean slate.
    pub fn clear(&mut self) {
        self.current_utterance_id = None;
        self.committed_prefix.clear();
        self.previous_decode.clear();
    }
}

#[derive(Debug, Clone, Copy)]
struct Agreement {
    latest_byte_len: usize,
    previous_next_char: Option<char>,
}

fn agreed_prefix(previous: &str, latest: &str) -> Agreement {
    let mut prev_iter = previous.char_indices().peekable();
    let mut latest_iter = latest.char_indices().peekable();
    let mut last_agreed_byte_end = 0;

    loop {
        let prev_is_ws = prev_iter
            .peek()
            .is_some_and(|&(_, c)| c.is_ascii_whitespace());
        let latest_is_ws = latest_iter
            .peek()
            .is_some_and(|&(_, c)| c.is_ascii_whitespace());

        if prev_is_ws && latest_is_ws {
            while let Some(&(_, c)) = prev_iter.peek() {
                if !c.is_ascii_whitespace() {
                    break;
                }
                prev_iter.next();
            }
            while let Some(&(idx, c)) = latest_iter.peek() {
                if !c.is_ascii_whitespace() {
                    break;
                }
                last_agreed_byte_end = idx + c.len_utf8();
                latest_iter.next();
            }
            continue;
        }

        if prev_is_ws != latest_is_ws {
            break;
        }

        match (prev_iter.peek(), latest_iter.peek()) {
            (Some(&(_, p)), Some(&(idx, l))) => {
                if p.eq_ignore_ascii_case(&l) {
                    last_agreed_byte_end = idx + l.len_utf8();
                    prev_iter.next();
                    latest_iter.next();
                } else {
                    break;
                }
            }
            _ => break,
        }
    }

    Agreement {
        latest_byte_len: last_agreed_byte_end,
        previous_next_char: prev_iter.peek().map(|&(_, c)| c),
    }
}

fn word_aligned_prefix(latest: &str, agreement: Agreement) -> &str {
    if agreement.latest_byte_len == 0 {
        return "";
    }

    if agreement.latest_byte_len >= latest.len()
        && !agreement
            .previous_next_char
            .is_some_and(|c| c.is_alphanumeric())
    {
        return latest;
    }

    let mut candidate = &latest[..agreement.latest_byte_len];
    candidate = candidate.trim_end();

    let next_char = latest[candidate.len()..].chars().next();
    if next_char.is_some_and(|c| c.is_alphanumeric())
        || agreement
            .previous_next_char
            .is_some_and(|c| c.is_alphanumeric())
    {
        match candidate.rfind(char::is_whitespace) {
            Some(pos) => candidate[..pos].trim_end(),
            None => "",
        }
    } else {
        candidate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uid(byte: u8) -> Uuid {
        Uuid::from_bytes([byte; 16])
    }

    #[test]
    fn first_partial_emits_nothing_with_no_previous_decode() {
        let mut s = PartialStabilizer::new();
        assert_eq!(s.apply(uid(1), "the cat"), None);
    }

    #[test]
    fn second_partial_commits_word_aligned_agreement() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "the cat");
        assert_eq!(s.apply(uid(1), "the cat sat"), Some("the cat".to_string()));
    }

    #[test]
    fn agreement_ending_mid_word_trims_back_to_previous_word_boundary() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "the cat sat");
        assert_eq!(s.apply(uid(1), "the cat sa"), Some("the cat".to_string()));
    }

    #[test]
    fn identical_partials_can_extend_once_then_no_growth_suppresses() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "the cat");
        assert_eq!(s.apply(uid(1), "the cat sat"), Some("the cat".to_string()));
        assert_eq!(
            s.apply(uid(1), "the cat sat"),
            Some("the cat sat".to_string())
        );
        assert_eq!(s.apply(uid(1), "the cat sat around"), None);
    }

    #[test]
    fn agreement_shorter_than_committed_keeps_committed_and_suppresses() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "the cat sat on");
        s.apply(uid(1), "the cat sat on the");
        assert_eq!(s.apply(uid(1), "the cats sat on the"), None);
    }

    #[test]
    fn agreement_not_starting_with_committed_keeps_committed() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "the cat sat on the");
        s.apply(uid(1), "the cat sat on the wall");
        assert_eq!(s.apply(uid(1), "the cats sat on the wall"), None);
    }

    #[test]
    fn new_utterance_id_resets_state() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "the cat");
        s.apply(uid(1), "the cat sat");

        assert_eq!(s.apply(uid(2), "another sentence"), None);
        assert_eq!(
            s.apply(uid(2), "another sentence here"),
            Some("another sentence".to_string())
        );
    }

    #[test]
    fn clear_resets_state_and_subsequent_apply_starts_fresh() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "the cat");
        s.apply(uid(1), "the cat sat");
        s.clear();
        assert_eq!(s.apply(uid(1), "different start"), None);
    }

    #[test]
    fn casefold_normalizes_for_comparison_but_emit_uses_raw_text() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "Hello world");
        assert_eq!(
            s.apply(uid(1), "hello world today"),
            Some("hello world".to_string())
        );
    }

    #[test]
    fn collapsed_whitespace_normalizes_for_comparison() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "hello  world");
        assert_eq!(
            s.apply(uid(1), "hello world today"),
            Some("hello world".to_string())
        );
    }

    #[test]
    fn internal_punctuation_difference_breaks_agreement() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "twenty five dollars");
        assert_eq!(
            s.apply(uid(1), "twenty-five dollars"),
            Some("twenty".to_string())
        );
    }

    #[test]
    fn trailing_punctuation_does_not_appear_in_emit_when_partial_overlap() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "hello world");
        assert_eq!(
            s.apply(uid(1), "hello world,"),
            Some("hello world".to_string())
        );
    }

    #[test]
    fn full_match_including_trailing_punctuation_emits_unchanged() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "hello world,");
        assert_eq!(
            s.apply(uid(1), "hello world,"),
            Some("hello world,".to_string())
        );
    }

    #[test]
    fn agreement_falls_inside_first_word_emits_empty_and_suppresses() {
        let mut s = PartialStabilizer::new();
        s.apply(uid(1), "abcde");
        assert_eq!(s.apply(uid(1), "abxyz"), None);
    }
}
