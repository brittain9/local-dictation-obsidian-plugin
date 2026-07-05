# Spec: Streaming (Moonshine) Quality + Performance Test Suite & Partial-Decode Fix

Status: implemented — with two design assumptions falsified during implementation
(see **Implementation outcome** below). The suite's guards caught both.
Branch: `test/streaming-moonshine-tests`
Companion plan: `docs/specs/streaming-moonshine-test-suite-plan.md`

## Summary

We shipped the Moonshine v2 streaming engine (`native/src/adapters/moonshine.rs`)
for live dictation. It works, but partial decoding gets **heavier the longer an
utterance runs without being finalized** — a real O(n²) cost, confirmed in code.

This branch does two things, together:

1. **Adds streaming integration tests to the sidecar** — quality *and* performance —
   layered onto the existing `native/tests/` harness rather than forking it.
2. **Fixes the O(n²) partial-decode cost** with a change that is quality-neutral on
   the committed transcript by construction, gated by the new quality tests.

The corpus exercises **Moonshine tiny + small** streaming tiers (both catalog models).

## Implementation outcome (what shipped vs. what was designed)

> This section is authoritative where it conflicts with the original design
> narrative below. The design sections are kept as the reasoning record — and
> because the two risks they flagged are exactly what fired.

The tests were built first (TDD) and immediately falsified **two** assumptions the
design leaned on. Both were caught by guards this spec had already listed as risks.

### Finding 1 — cross-KV projection is position-dependent → Fix A reverted

Design cause 1 assumed `k_cross`/`v_cross` are a pure per-frame linear projection of
encoder memory, so an incremental cache (project only new frames, append) would be
bit-identical. **False.** The equivalence guard, strengthened to also check a
*nonzero-offset* suffix, showed a slice projected at absolute offset `i` does **not**
match the same positions of the full projection (max abs diff ≈ 0.29 on `jfk`): the
model position-encodes the cross-attention keys. Appending per-delta projections
corrupts K/V, and because `compute_cross_kv` feeds *both* partial and final decode,
it corrupted the committed transcript (`jfk` final decoded to **empty**).

**Decision:** revert Fix A entirely. `compute_cross_kv` re-projects the full memory on
change (cached via `cross_kv_valid` until memory grows). A correct incremental cache
would need a position-aware cross-KV graph and is deferred as future work. The
characterization test `cross_kv_projection_is_position_dependent` documents the
constraint and guards against re-attempting the cache. **Fix A was not needed for the
perf win** (see Finding 3).

### Finding 2 — partials corrupt the final via divergent encoder memory → real bug fixed

The design's load-bearing claim — "the final transcript is always a fresh full decode,
so partials cannot affect committed accuracy" — was **also false**, and this was a
pre-existing latent bug in the shipped engine, not a new regression. `partial()` runs
`encode_available(false)`, which emits stable encoder frames incrementally through a
sliding window and holds back the lookahead tail. At finalize, `encode_available(true)`
only **appended the remaining tail** to that incrementally-built memory rather than
re-encoding — so the final decode consumed a streaming *approximation* of memory
(observed max frame diff ≈ 0.84 vs. a one-shot encode), which for `jfk` produced an
empty final. Isolation probe: `jfk` final is correct fed one-shot **and** correct fed
in chunks *without* partials, but **empty** fed in chunks *with* partials. Since live
dictation always requests partials, real final transcripts were exposed.

**Fix:** `decode()` now calls `reset_encoder_emission()` before the final encode,
discarding the approximate memory and re-encoding all accumulated features in one pass —
exactly what the one-shot path does. This makes the final decode independent of whether
or how often partials were requested, so `final == one-shot` now holds *by construction*
and is proven corpus-wide. This is the branch's most important quality fix.

### Finding 3 — Fix B alone carries the entire perf win

Bounded-tail partial decode (Fix B, kept) is sound and independent of Fix A. With Fix A
reverted, the perf guard's second-half/first-half per-partial ratio is **1.87** (red
baseline 4.26, threshold 3.0) — statistically identical to the 1.93 measured with both
fixes. The cross-KV re-projection is O(memory) per partial but is not the dominant term;
the quadratic blow-up was the full BOS re-decode, which Fix B bounds.

### Net shipped change

- **Reverted:** incremental cross-KV cache (unsound).
- **Kept:** bounded-tail partial decode (the perf fix).
- **Added:** full-memory re-encode at finalize (`reset_encoder_emission`) — fixes a
  real, pre-existing empty/garbled-final bug.
- **Tests:** quality (WER + anchors, tiny+small), `final == one-shot` corpus gate,
  partial stability, EOS/silence, and the relative perf guard — all passing on tiny
  and small.

## Decisions and reasoning (locked with the maintainer)

These four decisions frame the whole design.

### D1 — Scope: tests + fix in the same branch

The performance symptom is real and the fix is well-bounded, so we do both here.
The perf tests are written to fail on the current code and pass after the fix (TDD),
then remain as a permanent regression guard.

### D2 — Perf gate: characterize + **relative** scaling guard (not absolute ms)

Absolute latency budgets are not portable across CI/dev hardware. Instead:

- **Characterization** (always prints): a table of `(cumulative_secs, partial_ms,
  decode_tokens, cross_kv_ms)` per partial, so a human can see the scaling curve.
- **Guard** (asserts): per-partial engine time in the *second half* of a long
  utterance stays within a small factor (≈2–3×) of the *first half*, and cumulative
  partial work is ~linear. This is hardware-portable: it measures *shape*, not speed.
  Current code violates it (per-partial time grows with cumulative length); the fix
  satisfies it.

### D3 — Tiers: Moonshine **tiny + small**

`moonshine_tiny_streaming_en` (fast, 34M) and `moonshine_small_streaming_en` from the
bundled catalog. Medium is out of scope for the suite (same code path; not worth the
extra download/runtime). Tiny is the primary fast-feedback tier; small gives a
quality/latency comparison point.

### D4 — Partials: **bounded-tail re-decode**

For the fix, live-preview partials keep committed self-KV for older tokens and
re-decode only a recent tail window each partial. This preserves revision exactly
where revision actually happens (the last few words) at O(n) cost. The alternative
(append-only) was rejected as slightly lossier on preview revision for no real code
saving; cross-KV-cache-only was rejected as an incomplete fix.

## The performance problem (grounded in code)

`native/src/adapters/moonshine.rs`, driven by the worker's partial cadence
(`PARTIAL_CADENCE_MS = 500`, `PARTIAL_CADENCE_SAMPLES = 8_000`, `native/src/worker.rs`).

**Cheap / already incremental (leave alone):** the frontend
(`process_frontend_chunk`), encoder windowing (`encode_available`), and adapter all
advance by *new frames only*.

**The O(n²), two independent causes:**

1. **cross-KV recompute** — `compute_cross_kv` (moonshine.rs:722) reprojects K/V over
   the *entire* encoder `memory` whenever memory grows (`cross_kv_valid` is set false
   in every `encode_available`). But `k_cross`/`v_cross` are a **per-frame linear
   projection** of memory with no cross-frame mixing, and memory only grows by
   *appending stable frames* (partials encode only frames older than
   `total_lookahead`, so committed frames never change). So the K/V for existing
   frames are **bit-for-bit identical** whether you project the whole memory or only
   the new slice — the recompute is pure waste.

2. **full re-decode from BOS every partial** — `decode_text` (moonshine.rs:841) calls
   `reset_decoder()` and regenerates *every* token from BOS on each `partial()`, up to
   `duration_secs × MAX_TOKENS_PER_SECOND(6.5)` tokens (capped at `max_seq_len = 448`).

Across an un-finalized utterance of length *T*, the worker fires ~*T*/0.5 s partials,
each costing O(*T*) → **cumulative O(T²)**, bounded only past ~69 s when the 448-token
cap engages (and even then each partial redecodes 448 tokens). This is exactly the
"gets very heavy as I keep talking" symptom.

## Why the fix is quality-neutral on the committed transcript

> **Superseded by Finding 2.** The premise below — that the final decode is
> automatically independent of the partials — held for the *decoder* (it does reset
> and re-decode from BOS) but **not** for the *encoder memory* the final decode reads.
> Partials incrementally emitted memory that the final path then appended to rather
> than re-encoding, so partials *did* change the committed transcript. The
> `reset_encoder_emission` fix (Finding 2) restores the guarantee — the reasoning
> below is now true *because* of that fix, not by default.

The intended insight: **the final transcript is always a fresh full decode.**
`finalize_utterance` → `decode_final` resets the decoder and re-decodes the whole
utterance from BOS regardless of anything the partials did. Partials are a *live
preview* superseded via the revision protocol (`is_final` / `revision`,
`native/src/protocol.rs`).

The intent was that **any optimization to the partial path cannot change the accuracy
of the committed text.** That now holds only because the final path also re-encodes
memory from scratch (Finding 2); it was not true as originally shipped.

- **bounded-tail partial decode (cause 2, kept)** changes only intermediate previews,
  never the final, because the final path is a full decode over a full re-encode. The
  only measurable effect is on how previews revise mid-utterance, which bounded-tail
  keeps near-nil.
- **cross-KV cache (cause 1, reverted)** was assumed bit-identical; it was not
  (Finding 1).

The quality suite *proves* this rather than asserting it: `final == one-shot`
equivalence and the per-fixture WER budgets hold through the shipped fixes.

## The fix (`native/src/adapters/moonshine.rs`)

**(A) Incremental cross-KV cache — designed, then REVERTED (Finding 1).** The plan was
to project only the new memory slice through `cross_kv` and append. The equivalence
guard falsified the position-independence assumption, so `compute_cross_kv` keeps
re-projecting the full memory (cached via `cross_kv_valid` until memory grows). Not
shipped.

**(B) Bounded-tail partial decode — SHIPPED.** Persist the generated token sequence and
self-KV cache across partials on the open utterance. Each partial:
- keeps the committed prefix (tokens older than a lookback window
  `PARTIAL_REDECODE_WINDOW_TOKENS`) and their self-KV,
- truncates self-KV to the commit boundary,
- re-decodes only the tail against the current cross-KV, up to the token cap.

The window is a tuning constant (a few seconds of tokens) validated by the
partial-stability test. Turns O(total tokens) per partial into O(window). This is the
entire perf win (Finding 3).

**(C) Full-memory re-encode at finalize — SHIPPED (Finding 2).** `decode()` calls
`reset_encoder_emission()` before the final encode, so `finalize_utterance`
re-encodes all features in one pass and full-decodes from BOS over authoritative
memory. This is what makes `final == one-shot` actually true; the equivalence test is
the guard.

## Test surface (extends the existing harness)

New file `native/tests/streaming_e2e.rs`, mirroring `transcription_e2e.rs`. All heavy
tests are `#[ignore]`d (need model download + real inference) with a documented run
command, per the existing convention.

Shared-harness changes under `native/tests/common/`:

- **`model.rs`** — add `require_moonshine_model(tier)`. Moonshine is a **7-sibling**
  catalog model (`frontend.ort` + encoder/adapter/cross_kv/decoder_kv/streaming_config/
  tokenizer). Download *all* artifacts into a per-tier dir, sha-verify + cache each
  (reusing the existing `file_sha256` / verified-download machinery), return the
  `frontend.ort` path. Same priority ladder as whisper: env override → cache → catalog.
- **`driver.rs`** — generalize `start_session_command` / `start_session_json` to accept
  a model selection (runtime/family/path) instead of hardcoded whisper. Add
  streaming-aware capture: a `StreamingOutcome` that records the **partial timeline**
  (`is_final == false` events with `revision` and per-partial `processing_duration_ms`)
  distinctly from the **final** transcript. `Event::TranscriptReady` already carries
  `is_final` + `revision` (`native/src/protocol.rs:410`).
- Reuse `text.rs` (WER), `manifest.rs` (corpus), `audio.rs` (wav decode + framing)
  unchanged.
- **`streaming_budgets.json`** (new, `native/tests/fixtures/audio/`) — per-fixture,
  per-tier WER budgets + anchor words for Moonshine. Kept separate from the whisper
  corpus's `manifest.json` so the two engines' budgets don't entangle; audio +
  reference text are reused from the shared corpus.

## Quality tests (sidecar e2e, in-process driver, per tier, over the corpus)

1. **WER + anchors** per fixture against the streaming budgets.
2. **`final == one-shot`** — streamed-in-chunks final equals feed-all-then-finalize.
   Promotes the currently-`#[ignore]`d unit assertion
   (`local_model_decodes_fixture_in_streaming_chunks`) to a corpus-wide gate. This is
   the fix's neutrality proof.
3. **Partial stability** — the committed (non-tail) prefix across successive partials
   grows monotonically within a bounded backtrack. Directly validates that bounded-tail
   doesn't destabilize previews.
4. **EOS reached** on well-formed clips (`decode_reached_eos`), and **silence → empty**
   (no hallucination on trailing silence).

## Performance harness + guard (adapter-level, precise)

Drives `MoonshineAdapter::load_streaming` directly (isolating the engine from VAD/worker
noise) with a long single utterance (~40–60 s, assembled **in-memory** by concatenating
corpus clips — no new committed audio asset), fed in 0.5 s cadence chunks, calling
`partial()` at each cadence and `finalize_utterance()` once at the end.

- **Characterization** (always prints): per-partial `(cumulative_secs, partial_ms,
  decode_tokens, cross_kv_ms)`.
- **Guard** (asserts, per D2): second-half per-partial engine time ≤ small factor ×
  first-half; cumulative partial work ~linear. Fails on current code, passes after fix.

## Risks and their guards

| Risk | Guard | Outcome |
| --- | --- | --- |
| cross-KV is not actually per-frame position-independent | `cross_kv_projection_is_position_dependent` equivalence test | **FIRED** (Finding 1) — Fix A reverted |
| Stable frames encoded during partials differ from the final encode | `final == one-shot` corpus test (end-to-end invariant) | **FIRED** (Finding 2) — fixed via `reset_encoder_emission` |
| Bounded-tail corrupts decode or destabilizes previews | partial-stability test + finals-match + no-panic | held |
| Perf guard flakes on slow/loaded CI | relative shape ratios, not absolute ms; `#[ignore]`d, run with `--ignored` | held (ratio 1.87) |
| Model download flakiness / cost | sha-verified cache reuse; env override to point at local assets; suite is opt-in | held |

## Non-goals

- Generalizing the streaming adapter interface for *future* streaming engines. The
  maintainer flagged wanting more streaming models later; that is explicitly out of
  scope here. This branch stays focused on Moonshine quality/perf.
- Moonshine medium tier.
- Any change to the wire/revision protocol. (The final-decode path *was* changed —
  Finding 2 forces a full re-encode at finalize — because the corpus test proved it was
  producing wrong committed output. The original "no final-path change" intent was
  incompatible with correctness.)
- A correct incremental cross-KV cache (deferred; needs a position-aware graph).

## Run command (documented in the test file)

```sh
cargo test --manifest-path native/Cargo.toml --test streaming_e2e -- --ignored --nocapture
```
