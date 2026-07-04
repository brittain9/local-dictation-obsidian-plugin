# Spec: Streaming (Moonshine) Quality + Performance Test Suite & Partial-Decode Fix

Status: approved for implementation (design decisions locked with the maintainer, below)
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

The load-bearing insight: **the final transcript is always a fresh full decode.**
`finalize_utterance` → `decode_text` resets the decoder and re-decodes the whole
utterance from BOS regardless of anything the partials did. Partials are a *live
preview* superseded via the revision protocol (`is_final` / `revision`,
`native/src/protocol.rs`).

Therefore **any optimization to the partial path cannot change the accuracy of the
committed text.** The O(n²) lives entirely in the preview path.

- **cross-KV cache (cause 1)** is bit-identical by construction — helps both partial
  and final, changes no output anywhere.
- **bounded-tail partial decode (cause 2)** changes only intermediate previews, never
  the final, because we leave the final path as a full decode. The only measurable
  effect is on how previews revise mid-utterance, which bounded-tail keeps near-nil.

The quality suite *proves* this rather than asserting it: `final == one-shot`
equivalence and the per-fixture WER budgets must hold through the fix.

## The fix (`native/src/adapters/moonshine.rs`)

**(A) Incremental cross-KV cache.** Cache projected `k_cross`/`v_cross` and their
`cross_len`. In `encode_available`, after extending `memory` by `new_frames`, project
only the new memory slice through the `cross_kv` graph and append to the cache; remove
the blanket `cross_kv_valid = false` invalidation. Guarded by an equivalence test:
`cross_kv(memory)[..n] == cross_kv(memory[..n])` (validates the position-independence
assumption). Turns O(memory) per partial into O(new frames).

**(B) Bounded-tail partial decode.** Persist the generated token sequence and self-KV
cache across partials on the open utterance. Each partial:
- keeps the committed prefix (tokens older than a lookback window `W`) and their
  self-KV,
- truncates self-KV to the commit boundary,
- re-decodes only the tail against the now-larger cross-KV, up to the token cap.

`W` is a tuning constant (order of a few seconds of tokens) validated by the
partial-stability test. Turns O(total tokens) per partial into O(`W`).

**Final path unchanged.** `finalize_utterance` still full-decodes from BOS, so
`final == one-shot` holds automatically and the equivalence test is the guard.

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

| Risk | Guard |
| --- | --- |
| cross-KV is not actually per-frame position-independent | `cross_kv(memory)[..n] == cross_kv(memory[..n])` equivalence test — fix is gated on it |
| Stable frames encoded during partials differ from the final encode | `final == one-shot` corpus test (end-to-end invariant) |
| Bounded-tail corrupts decode or destabilizes previews | partial-stability test + finals-match + no-panic |
| Perf guard flakes on slow/loaded CI | relative shape ratios, not absolute ms; `#[ignore]`d, run with `--ignored` |
| Model download flakiness / cost | sha-verified cache reuse; env override to point at local assets; suite is opt-in |

## Non-goals

- Generalizing the streaming adapter interface for *future* streaming engines. The
  maintainer flagged wanting more streaming models later; that is explicitly out of
  scope here. This branch stays focused on Moonshine quality/perf.
- Moonshine medium tier.
- Any change to the final-decode path or the wire/revision protocol.

## Run command (documented in the test file)

```sh
cargo test --manifest-path native/Cargo.toml --test streaming_e2e -- --ignored --nocapture
```
