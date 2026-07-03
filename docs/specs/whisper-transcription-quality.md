# Spec: Whisper Transcription Quality Fixes

Status: approved for implementation (handoff to Codex)
Issues: [#160](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/160), [#138](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/138), plus two field-reported defects (capitalization drift, spurious speaker labels) captured below.
Companion plan: `PLANS.md` (repo root).

## Design principle

These defects were observed mostly on Whisper, but repeated-phrase and label
hallucinations are generic speech-to-text failure modes (they occur in other
dictation products too). Fixes are therefore layered:

1. **Engine-agnostic defenses** in the post-engine pipeline
   (`native/src/stages/hallucination_filter.rs`) that protect every adapter,
   including Cohere (which produces no per-segment diagnostics — new rules must
   not require them).
2. **Whisper-specific root-cause fixes** only where the defect provably
   originates in the whisper.cpp decode configuration or the prompt we feed it.

## Pipeline background (as of this branch)

- TS controller (`src/dictation/dictation-session-controller.ts`) starts sidecar
  sessions; audio is VAD-segmented into utterances hard-capped at 30 s
  (`MAX_UTTERANCE_FRAMES = 1_500` × 20 ms frames, `native/src/session.rs`).
- Per utterance, the sidecar issues a `context_request`; the plugin answers with
  a `ContextWindow` whose text is a **note glossary** — `Glossary: Term1, Term2, …`
  built from Capitalized tokens scraped from the active note
  (`buildGlossary`, `src/editor/note-surface.ts:689`), budget 384 chars
  (`CONTEXT_BUDGET_CHARS`, `native/src/app.rs:41`). Only sent when the
  `useNoteAsContext` setting is on.
- The Whisper adapter (`native/src/adapters/whisper.rs`) feeds that text as
  `initial_prompt` and decodes with `SamplingStrategy::Greedy { best_of: 0 }`;
  all other whisper.cpp params are library defaults.
- Post-engine stages run per revision; `HallucinationFilterStage` classifies
  each segment independently (hard blocklist / soft-corroborated / repetition /
  silence / prompt-leak) and drops segments, recording them in a versioned
  stage payload (`version: 1`).
- Finished transcripts flow back to the TS controller, which serializes accepts
  through a per-session FIFO (`processTranscriptReady`).

## Bug A — Repeated phrase hallucination (#160)

### Evidence

A transcript devolved into `Peter, how's the show that reaches?` repeated many
times (system audio + mic, Whisper large-v3-turbo q8_0).

### Root causes (observed in code)

1. **Degraded decoder fallback (Whisper-specific).**
   `native/src/adapters/whisper.rs:73` uses `Greedy { best_of: 0 }`. In
   whisper.cpp, `greedy.best_of` is the number of parallel decoders used during
   temperature fallback (`n_decoders_cur = max(1, best_of)` when `t_cur > 0`);
   the upstream default is **5**. With 0, the entropy-threshold fallback —
   whisper.cpp's built-in escape hatch from repetition loops — re-decodes with a
   single sampled decoder, drastically weakening it.
2. **Filter blind spot (engine-agnostic).** The repetition rules in
   `hallucination_filter.rs` (`repeated_ngram_dominates`,
   `repeated_suffix_dominates`) operate **within one segment** and additionally
   require a diagnostics/VAD corroborator. A decoder loop that emits the same
   sentence as N *separate consecutive segments* — exactly the #160 shape — is
   invisible to them.

### Decisions

- **A1 (Whisper):** change `best_of: 0` → `best_of: 5` (upstream default),
  with a comment explaining that this is the decoder count for temperature
  fallback, not a beam width. Do not restate other whisper.cpp defaults
  (`entropy_thold` 2.4, `temperature_inc` 0.2, `logprob_thold` −1.0 already
  apply); the comment should name them as the mechanism this re-enables.
- **A2 (engine-agnostic):** add a transcript-level rule to
  `HallucinationFilterStage`: a run of ≥ `REPEATED_SEGMENT_RUN_MIN = 3`
  **consecutive** segments with identical non-empty `normalize_text` output
  keeps the first segment and drops the rest with new reason `repetition_run`.
  No corroborator required — three back-to-back identical segments is not a
  realistic dictation pattern, and Cohere segments carry no diagnostics.
  Runs on **final revisions only** (consistent with existing non-hard rules).
- **Deferred:** cross-*utterance* repetition guarding (same phrase accepted
  across successive utterances). Riskier — users legitimately repeat
  themselves across utterances; revisit if A1+A2 don't clear #160 in practice.

## Bug B — Title-Case capitalization drift

### Evidence

During long sessions, especially after dictating proper nouns, Whisper starts
capitalizing Every Single Word; a fresh session resets it.

### Root cause (observed in code)

`buildGlossary` emits `Glossary: Nami, Luffy, Obsidian, …` — a colon-labeled,
Title-Case comma list — and the adapter feeds it verbatim as `initial_prompt`.
Whisper mimics the *style* of its prompt (OpenAI's Whisper prompting guidance:
prompts should read like ordinary transcript prose), so a list of Capitalized
Tokens pushes the decoder toward Title Case. The loop is self-reinforcing:
dictated proper nouns land in the note → get scraped into the glossary → the
next utterance's prompt is a longer Capitalized list → stronger drift. This
also explains the reset on a new session/note, and it is Whisper-specific by
construction (the only adapter consuming `initial_prompt`).

### Decisions

- **B1:** reformat the glossary as sentence-cased prose that still carries the
  terms with their intended casing:
  `The notes mention Nami, Luffy, Obsidian.` (fixed prefix
  `The notes mention `, comma-joined terms, terminal period). Same dedupe,
  budget, and truncation semantics; the terminal period must fit the budget.
- **B2:** update the prompt-leak fast path in `hallucination_filter.rs`
  (`is_prompt_leak`, currently `starts_with("glossary:")`) to the new
  normalized prefix (`the notes mention`), and update its tests. The literal is
  intentionally duplicated across TS and Rust (it crosses the wire as opaque
  text); each side must carry a comment pointing at the other. False-positive
  risk is bounded: the fast path still requires ≥ 2 corroborators to drop.
- **B3:** removing the `Glossary:` label also removes a colon-label prime that
  plausibly feeds Bug C.
- Keep the 384-char budget and the `useNoteAsContext` gate unchanged.

## Bug C — Spurious speaker labels

### Evidence (captured 2026-07-03, speaker labels feature OFF, predates diarization)

> …I need to speak with you. Nami, Luffy and your crew. **Gorglosa:** Let me
> join your crew. … **Gorgiasi:** Let me buy back … **Elegatee:** I'm going to
> turn it into YouTube.

`Gorglosa`, `Gorgiasi`, `Elegatee` are invented, name-shaped, single-token
labels at segment starts — Whisper training-data artifacts (captions/interview
transcripts). Each appeared **once**, so any rule requiring the label to repeat
would miss them.

### Decisions

- **C1 (engine-agnostic):** add a **label-scrub** rule to
  `HallucinationFilterStage` that strips (not drops) a leading speaker-label
  prefix from a segment. Product invariant making this safe: speaker
  attribution is exclusively the diarization feature's job (the segment
  `speaker` field); engine-emitted text labels are never legitimate.
- **C2 (pattern):** at segment start, 1–2 whitespace-separated tokens, each
  matching initial-capital alphabetic shape (`[A-Z][a-z'’.-]+` — not all-caps,
  no digits), followed by `:`, whitespace, and a non-empty remainder. The strip
  removes the prefix through the colon and following whitespace.
- **C3 (guards, in order):**
  1. Skip if the prefix (case-insensitive, sans colon) appears in a small
     structural keep-list of dictation labels:
     `note, todo, warning, question, answer, summary, title, reminder, idea,
     important, update, edit, aside` (constant, tunable).
  2. Skip if the prefix appears as a term in the utterance's context window
     text (the note glossary) — protects deliberate definition-list dictation
     of the user's own vocabulary ("Nami colon the navigator"). Accepted
     trade-off: a hallucinated label that reuses a real glossary name survives.
  3. Otherwise strip unconditionally — **no corroborator requirement** (see
     evidence: labels occur once, with unremarkable diagnostics, and Cohere has
     no diagnostics).
- **C4 (observability):** stripped prefixes are recorded in the stage payload
  as `editedSegments: [{ index, strippedPrefix, originalText }]`; bump payload
  `VERSION` 1 → 2. Extend TS `logDroppedHallucinations`
  (`dictation-session-controller.ts:1073`) to also debug-log edited segments.
- **C5:** final revisions only, same rationale as A2.
- Rollback story: pattern + keep-list are constants; the payload makes every
  strip auditable from debug logs.

## Bug D — Utterance FIFO hardening (#138)

### Evidence (from issue, sourced from CODE_REVIEW.md R3)

In `processTranscriptReady` the FIFO accept step guards only on
`this.sessions.has(sessionId)` (`dictation-session-controller.ts:678`). If
`acceptTranscript` is rejected, the error path calls `cancelSession`; if
`cancelSession` itself throws before `disposeLocalSession` runs (e.g.
`clearActiveSession → captureStream.stop()` rejects), the session stays in the
registry in a half-cancelled state and queued utterances behind it still
accept into it.

### Decisions

- **D1:** gate the FIFO accept body on session phase in addition to registry
  membership: return early when `entry.phase === 'cancelling' || entry.phase === 'stopped'`.
  `'stopping'` must **not** be gated — the stop flow drains in-flight
  transcripts. (`cancelSession` already sets `phase = 'cancelling'`
  synchronously before any `await`, `dictation-session-controller.ts:417`;
  verify no await precedes it in the error path and keep it that way.)
- **D2:** dedicated regression test that forces `cancelSession` to throw
  (reject `captureStream.stop()` — the sidecar-cancel failure path is already
  caught internally) with a second utterance queued behind the failing one, and
  asserts the second `acceptTranscript` never runs. Per the issue: the FIFO is
  the most timing-sensitive code in the plugin — **no drive-by changes** in
  this area.

## Non-goals

- No cross-utterance repetition dedup (deferred, see Bug A).
- No changes to diarization, Cohere adapter behavior, or the LLM cleanup path.
- No new user-facing settings; all thresholds are code constants.
- No general "case repair" post-processing (too risky; Bug B is fixed at the
  prompt root cause).
