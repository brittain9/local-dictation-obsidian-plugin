//! Scores a driven clip against its corpus quality budget.
//!
//! Both e2e entrypoints — the in-process accuracy suite and the wire-protocol
//! guard — judge an outcome by the same criteria, so "what counts as passing"
//! lives here once instead of being re-spelled (and able to drift) in each test.

use super::driver::TranscriptionOutcome;
use super::manifest::Fixture;
use super::text;

/// Reasons `outcome` fell short of `fixture`'s quality budget, in report order.
/// An empty vec means the clip met every requirement: no engine errors, the
/// session stopped, a non-empty transcript, all anchor words present, and the
/// Word Error Rate within budget. Each reason is prefixed with the fixture id so
/// callers can surface it directly.
pub fn budget_failures(fixture: &Fixture, outcome: &TranscriptionOutcome) -> Vec<String> {
    let id = &fixture.id;
    let mut failures = Vec::new();

    if !outcome.errors.is_empty() {
        failures.push(format!("{id}: emitted errors {:?}", outcome.errors));
    }
    if !outcome.stopped {
        failures.push(format!("{id}: session never reached session_stopped"));
    }
    if outcome.text.trim().is_empty() {
        failures.push(format!("{id}: produced an empty transcript"));
    }

    let missing = text::missing_anchors(&outcome.text, &fixture.anchors);
    if !missing.is_empty() {
        failures.push(format!("{id}: missing anchor words {missing:?}"));
    }

    let wer = text::word_error_rate(&fixture.reference, &outcome.text);
    if wer > fixture.max_wer {
        failures.push(format!(
            "{id}: WER {wer:.3} exceeded budget {:.3}",
            fixture.max_wer
        ));
    }

    failures
}
