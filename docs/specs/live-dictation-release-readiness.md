# Spec: Live Dictation Release Readiness

Status: approved for implementation (handoff to Codex)
Issues: [#179](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/179) (owned),
[#178](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/178) (partially —
visible gating; full integration deferred, see D1)
Predecessors: `docs/specs/live-dictation-moonshine.md` (PR #176),
`docs/specs/moonshine-model-catalog.md` (PR #180)

## Product goal

Live dictation ships in a release: bug-free, honest UX, documented
limitations. Priority is quality over feature breadth. This PR fixes the
verified defects found in a post-merge review of #176, makes the
diarization limitation visible instead of silent, and closes the #179
release gate.

## Out of scope

- Full diarization integration for streaming sessions (remains #178; see
  D1 for the recorded rationale).
- Catalog/install work (done — PR #180).
- Protocol changes. Nothing here adds events or fields.
- Non-English streaming, multi-speaker streaming attribution.

## D1 — Diarization × streaming: gate visibly, do not integrate (decided)

Streaming sessions keep **no speaker attribution** in this release. The
integration is structurally non-trivial, not a bolt-on:

- Speaker labels are decided at *append time* — `TranscriptRenderer.planAppend`
  puts the label in the append **prefix** for single-span utterances — but a
  streaming utterance appends its first partial before any speaker can be
  known (diarization needs the utterance audio; partials start ≤1 s in).
- A diarized multi-speaker final would arrive as a multi-span revision,
  which triggers the body-restructuring recompose branch
  (`src/session/session.ts:419-422`) against text the user may have edited —
  a real correctness risk in the `replaceAnchor`/latch machinery for
  marginal value, since live dictation is overwhelmingly single-speaker.

What this PR does instead:

1. **Settings honesty:** in `src/settings/settings-tab.ts`, when the
   selected model's family capabilities report `supportsStreaming`, append a
   capability-driven note to the existing "Speaker labels (diarization)"
   toggle description: *"Not applied while a streaming (live) model is
   selected — speaker labels currently require a batch model."* The toggle
   stays enabled (it is a global preference that still governs batch
   models). Pattern: the `supportsInitialPrompt` gate at
   `settings-tab.ts:466` (use `state.selectedModelCapabilities`).
2. The sidecar `RequestWarning` backstop
   (`session_request_warnings`, `native/src/worker.rs:664-675`) is unchanged.
3. #178 stays open for real integration; the likely shape (run the
   diarizer on the finalized utterance audio, which is available at
   `finalize_streaming_utterance` — `worker.rs:583` — exactly like the batch
   call site `worker.rs:409-413`) is recorded there, blocked on solving the
   prefix-vs-finalization rendering mismatch above.

## D2 — Defect burn-down (authoritative list)

From a verified line-level review of the merged #176 diff against current
main (2026-07-04). **Fix 1–6 in this PR; each fix lands with a regression
test.** 7–9 are fix-or-defer-with-rationale.

1. **Finalize always re-decodes; incremental fast path is dead code**
   (`native/src/worker.rs:600-608`) — candidate release-blocker.
   Finalization uses the streamed state only when
   `open.utterance.samples == samples`, but `native/src/session.rs:429-431`
   trims the finalized utterance to `pending_end_start +
   post_speech_pad_frames` (2 frames) while the worker has already streamed
   the full silence hangover (20/50/100 frames, `session.rs:71-73`) — the
   vectors never match on a pause-driven finalize, so every utterance end
   does `reset_utterance()` + re-feed + full re-decode. The 30 s cap split
   (`session.rs:349-351`) mismatches too (the cap-triggering frame is never
   streamed; finalize is handled before `dispatch_streaming_audio`,
   `app.rs:242-245`), stalling live text for a full 30 s re-decode on the
   single worker thread. Fix: make finalize reconcile by *suffix* — the
   streamed samples are a prefix (or near-prefix) of the finalized buffer;
   feed only the missing tail (or tolerate the trimmed-tail case) instead
   of equality-gating. Regression test must use a streaming model fake that
   *counts re-feeds* (the existing fixture model cannot distinguish the
   paths — that is why this escaped), driven through the real
   session→worker finalize flow with silence hangover and cap-split cases.
2. **Empty partial after projected text deletes the utterance boundary
   prefix** (`src/session/session.ts:407-453`,
   `src/editor/note-surface.ts:267`). An empty non-final revision (worker
   emits one whenever decode regresses to empty, `worker.rs:522-529`)
   removes `span.start..textEnd` including the separator/timestamp prefix;
   the next partial then glues to the previous utterance. Fix: gate the
   prefix-removing empty-replace path on `isFinal` (empty partials should
   replace the span *body* only, or be held). Regression: partial → empty
   partial → partial sequence preserves prefix and timestamp.
3. **Streaming sessions bypass queue-overload protection**
   (`native/src/app.rs:1016-1039` returns before the `overload_draining`
   guard and `QUEUE_OVERLOAD_DEPTH` check at `app.rs:1086-1098`),
   contradicting spec D4 ("queue overload semantics for finals are
   unchanged"). A slower-than-realtime model accumulates an unbounded
   backlog and the session never auto-stops. Fix: route streaming finals
   through the same overload accounting. Regression: overload tier
   escalation and auto-stop fire for a streaming session.
4. **One failed partial decode cancels the whole session**
   (`src/dictation/dictation-session-controller.ts:1045-1073` treats every
   session-scoped error as fatal, but the worker sends
   `SessionError { finalizes_utterance: false }` for partial-decode errors
   and keeps the utterance recoverable, `worker.rs:309-327`). Fix: when
   `finalizesUtterance` is false, log and continue (partials are droppable
   by design); only finalizing errors cancel. Regression: transient partial
   error → session continues, final still lands.
5. **Per-utterance LLM cleanup blocks the next utterance's live partials**
   (`src/dictation/dictation-session-controller.ts:675-698` serializes all
   `transcript_ready` handling through `entry.cleanupChain`; utterance B's
   partials arrive exactly while A's cleanup HTTP round-trip is in flight).
   Fix: only *finals* enter the cleanup chain; partial projection must not
   await it. Regression: partials project while a cleanup promise is
   pending.
6. **"Show raw below" callout dropped for streamed utterances**
   (`src/session/session.ts:366` emits the callout only on the append path;
   a streamed utterance's cleaned final arrives via `applyReplace`). Fix:
   emit the callout from the replace path when a final's cleaned text
   differs from raw and `showRawBelow` is on. Regression test with a
   projected-then-cleaned utterance.
7. *(polish)* Emptied final leaves doubled spaces in `joinRawSessionText`
   (`src/session/session.ts:568`, `:193-198`) — cosmetic input noise to
   batch cleanup.
8. *(polish)* Provisional-range tail bias (+1,
   `src/editor/provisional-transcript-extension.ts:21-22`) disagrees with
   span mapping bias (−1, `note-surface.ts:596`): typing at the exact tail
   of a live span styles the typed text provisional without latching. No
   data loss; visual glitch at 2 Hz.
9. *(polish)* Streaming path never applies capability gates beyond
   diarization, so e.g. a non-English language setting is dropped without a
   `RequestWarning` (`worker.rs:664-675`).

**Verified solid — do not re-litigate:** revision monotonicity end-to-end
(worker offsets, journal rejection, `applyReplace` guard, FIFO ordering,
pinned by the simulation test `worker.rs:889`); empty-*final*
whitespace/timestamp handling (`test/session.test.ts:199`, `:218`);
partials bypass post-engine stages; LLM cleanup final-gating; no
`context_request` for streaming; provisional decorations cleared on
teardown; Moonshine adapter state reset on error paths.

## D3 — Flicker / stable-prefix rendering: measure first

Do not implement stable-prefix partial emission speculatively. During the
D5 manual pass, watch for visible whole-utterance replacement flicker at
~2 Hz (risk noted in `docs/specs/live-dictation-moonshine.md` § Risks). If
observed, the fix is a worker-side cadence policy (emit only on stable
prefix growth) with no protocol change — file it with the measurement
before implementing.

## D4 — Error and recovery UX

Expected behavior, verified during the manual pass:

- **Missing/corrupt/incompatible model at probe:** existing probe failure
  path with a clear message; selection is refused (no change expected —
  verify with a deliberately corrupted `frontend.ort`).
- **Decode failure mid-utterance with projected partials:** per D2-4, the
  session survives droppable-partial errors; a finalizing error cancels the
  utterance without leaving provisional styling behind.
- **Slow model (slower than realtime):** per D2-3, overload tiers engage
  and auto-stop fires instead of unbounded backlog.

## D5 — Docs and release gate

- Manual validation matrix on representative CPU hardware, tiny/small/
  medium: first partial ≤ 1 s, ~2 Hz refresh, final ≤ 700 ms after VAD
  close **including the ordinary pause-driven finalize** (this re-times
  D2-1's path), plus first-partial-after-30s-cap-split; 5-minute soak with
  no audio loss/reordering/stale provisional styling; typing latches;
  empty finals; one-sentence mode; stop/cancel/drain; note switching;
  session teardown; light/dark themes.
- User docs + release notes: live dictation behavior, hardware
  expectations, and limitations (English-only; no speaker labels on
  streaming models; 30 s utterance cap).
- Release gate: all D2 items 1–6 fixed with regression tests; 7–9 fixed or
  deferred with rationale in the PR; matrix passed; docs updated.

## Verification

- `npm run check` and `npm run check:rust` green.
- One regression test per fixed defect, at the seam named in D2 (the D2-1
  test must be able to detect the re-feed path — a counting fake, not the
  existing fixture model).
- Manual matrix (D5) executed and results recorded in the PR before
  ready-for-review.

## Risks

- D2-1's fix touches finalize reconciliation — the highest-risk edit in
  this PR. The suffix-reconcile logic must preserve the final==batch
  equality contract pinned by the simulation test; if equality cannot be
  preserved exactly, stop and reassess rather than weakening the test.
- D2-5 reorders plugin-side async handling; the FIFO guarantees of the
  journal (revision monotonicity) must be pinned by tests before refactor.
