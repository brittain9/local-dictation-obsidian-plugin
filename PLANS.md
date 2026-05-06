# Live Dictation Plan

## Summary

Build a local, desktop-first live dictation experience for the Obsidian plugin. The user-facing goal is not just "better final transcripts"; it is text that appears while the user is speaking, revises safely as confidence improves, finalizes cleanly at pauses, and then receives deterministic dictation cleanup for numbers, dates, punctuation, and casing.

This plan keeps the existing runtime boundary intact:

- The TypeScript plugin owns microphone capture, settings, Obsidian editor projection, and user-wins latching.
- The Rust sidecar owns VAD, live/final inference, revision sequencing, post-engine stages, and model capability gating.
- No Web Speech API, cloud STT, telemetry, or frontend-owned model inference.

The next major work should be live dictation. The LLM cleanup branch should stay parked until live partial revisions are working end to end; LLM cleanup is final-text polish, not the core product feel.

## External Facts Checked

Checked on 2026-05-06 because the Moonshine ecosystem is moving:

- Moonshine's current public docs position Moonshine Voice as a library for live speech applications with JavaScript, Python, and C++ support: <https://usefulsensors.com/>
- MoonshineJS explicitly distinguishes default VAD mode, which waits for pauses, from streaming mode, which calls `onTranscriptionUpdated` with continuous transcript updates and commits after longer pauses: <https://dev.moonshine.ai/js>
- The Moonshine streaming model card describes a 50 Hz audio frontend and sliding-window Transformer encoder for low-latency on-device English ASR: <https://huggingface.co/UsefulSensors/moonshine-streaming-tiny/blob/main/README.md>
- The Moonshine repository describes cross-platform C++ core support, ONNX Runtime under the hood, streaming cache behavior, update intervals, and CLI benchmarks: <https://github.com/moonshine-ai/moonshine>
- For deterministic English number cleanup, `text2num` is a Rust crate for recognizing and replacing spoken-form numbers in ASR-like text streams: <https://docs.rs/text2num/latest/text2num/>

## Current Baseline

The current app is final-utterance oriented:

- `AudioWorklet` sends 16 kHz mono PCM frames to the Rust sidecar.
- `ListeningSession` buffers frames and emits only `FinalizedUtterance`.
- `AppState` creates the `utterance_id` only when a finalized utterance is enqueued.
- Context is requested only immediately before final dispatch.
- `TranscriptionWorker` runs one blocking `LoadedModel::transcribe()` call per finalized utterance.
- `assemble_transcript()` currently starts every transcript at revision `0`.
- The TypeScript `Session` can already accept multiple revisions for the same utterance and replace projected text, but it stores only the last inserted utterance text, not the full projection prefix plus text.

The frontend is close to the right shape, but the sidecar is not yet a live producer.

## Target Behavior

Acceptance target for the first useful live version:

- First visible partial text appears roughly 500-1000 ms after speech starts on supported models.
- Partial text updates at a controlled cadence, defaulting around 500 ms, without unbounded queue growth.
- Later revisions replace the same utterance span, not append duplicates.
- User edits to the projected span stop all later replacements for that utterance.
- Final revisions may add or adjust timestamp/paragraph prefixes and may replace the partial text.
- Final-only cleanup can convert common spoken numbers and dates, for example `twenty twenty five` to `2025`, without using an LLM.
- Unsupported or slow models degrade to the existing final-only behavior.
- Stopping or cancelling dictation cannot leave a live partial worker running.

## Non-Goals

- Do not use the browser Web Speech API. It is not reliably local, portable, or controllable enough for this project.
- Do not add cloud STT as a shortcut.
- Do not merge LLM cleanup as a prerequisite for live dictation.
- Do not add full rich styling for interim text in v1. The existing anchor and replacement behavior are enough; in-note styling can come later if it proves valuable.
- Do not make Whisper Large V3 Turbo a live default. It is good final ASR, but repeated live decode is too expensive for the default live path.

## Architectural Decisions

### 1. Live Text Is The Existing Revision Stream

Keep `transcript_ready` as the single transcript event. The semantic change is that the sidecar may emit multiple events for one `utteranceId`:

```text
transcript_ready { utteranceId: U1, revision: 1, isFinal: false, text: "twenty twenty" }
transcript_ready { utteranceId: U1, revision: 2, isFinal: false, text: "twenty twenty five" }
transcript_ready { utteranceId: U1, revision: 3, isFinal: true,  text: "2025" }
```

Do not add separate `interim_transcript` and `final_transcript` event types. That would duplicate the journal/projection path and create two sources of truth.

### 2. The Sidecar Owns Partial Production

The plugin continues to send PCM frames and command frames only. It should not own recognizer-specific buffering or partial inference. Live dictation belongs inside the Rust sidecar because that is where VAD, inference, model capabilities, and post-engine stages already live.

### 3. Active Utterances Get Identity Before Finalization

Live dictation requires a stable `utterance_id` while speech is still active. Move utterance identity creation from "final enqueue time" to "speech-start time" for live-capable sessions.

Implementation default:

- `ListeningSession` exposes whether an active utterance exists and can produce an active-utterance snapshot.
- `AppState::ActiveSession` owns `active_utterance_id: Option<Uuid>`.
- The first frame that makes `ListeningSession` enter active speech causes `AppState` to allocate the utterance ID.
- Finalization reuses that ID. If no live ID was allocated, final-only sessions allocate one at finalization as they do today.

### 4. Context Is Frozen Per Utterance

For live modes, prompt/context must not change between partial decodes and the final decode for the same utterance. Otherwise final text can swing too aggressively.

Implementation default:

- When a live utterance starts, `AppState` sends a `context_request` immediately if context is needed.
- A live context deadline of `150 ms` is used before the first partial can dispatch.
- The utterance context is frozen when the first decode dispatches.
- If context arrives after the first decode, it is ignored for that utterance.
- Final decode uses the same frozen context as partial decode.
- Final-only sessions can keep the current 2 second context timeout.

### 5. Partial Jobs Are Coalesced And Finals Have Priority

Do not enqueue every partial snapshot into the current unbounded worker channel. That would create stale partial work and delay final results.

Change the worker from "one command in, one blocking decode" to a scheduler:

- Drain pending commands into local worker state before choosing work.
- Keep only the latest pending partial snapshot per active utterance.
- Keep finalized utterances in order.
- Process final work before partial work.
- Drop stale partial output when a newer revision or a final revision has already been emitted.
- Never count partial jobs in the finalized-utterance backpressure queue.

This preserves the existing "never drop finalized audio during normal processing" rule while allowing partial UI updates to degrade gracefully.

### 6. Post-Engine Stages Stay Final-Only Unless Explicitly Partial-Safe

The current `StageProcessor::runs_on_partials()` contract is correct. For live dictation:

- Engine stage runs on partials.
- Hallucination filter may run only its documented hard partial-safe subset.
- Dictation normalization, punctuation restoration, user rules, and LLM cleanup are final-only unless each stage later defines a narrower partial-safe contract.

### 7. Moonshine Is The Streaming Engine, But Not The First Contract Test

Build the live revision contract first, then use Whisper speculative partials as the first end-to-end implementation. This validates editor replacement, worker scheduling, finality, latching, and settings without adding a new native dependency.

Moonshine comes after that as a streaming model family. Use the Moonshine C++ core through its C-compatible boundary in the Rust sidecar. Do not run MoonshineJS in the Obsidian frontend and do not add a Python child process.

### 8. Deterministic Dictation Normalization Comes Before LLM Cleanup

The "2025" behavior belongs first in a final-only deterministic stage, not in an LLM. Add a scoped English dictation normalizer after live partials are working.

Default implementation:

- Add a `DictationNormalizerStage`, final-only.
- Use `text2num` for cardinals, ordinals, and decimals.
- Add owned, well-tested year/date rules for forms like `twenty twenty five`, `twenty oh five`, `nineteen ninety nine`, and month-day-year phrases.
- Preserve segment boundaries. Rewrite segment text only.
- If normalization would be ambiguous or too broad, leave the text unchanged.

## Public Contract Changes

### Settings

Add a session-scoped setting:

```ts
export const LIVE_PARTIAL_MODES = ['auto', 'always', 'off'] as const;
export type LivePartialMode = (typeof LIVE_PARTIAL_MODES)[number];
```

Default: `auto`.

Semantics:

- `off`: never emit partial transcript revisions.
- `auto`: enable only when the selected catalog model declares live partials as a default-supported path.
- `always`: force live partials for selected models whose adapter exposes a live strategy, even when the catalog does not make it the default. This is mainly for developer validation and external files. It must still reject unsupported families.

`StartSessionCommand` / `Command::StartSession` gains `livePartialMode`.

Settings are snapshotted at dictation start, matching the existing advanced-feature behavior.

### Model Capabilities

Add a model-level live capability instead of hard-coding model IDs in TypeScript.

Rust catalog and TypeScript catalog records gain:

```ts
type LivePartialStrategy = 'snapshot' | 'streaming';

interface LivePartialModelCapability {
  autoEnabled: boolean;
  minAudioMs: number;
  recommendedUpdateMs: number;
  strategy: LivePartialStrategy;
}

interface CatalogModelRecord {
  livePartials: LivePartialModelCapability | null;
}
```

Defaults:

- Whisper tiny/base catalog entries: `strategy: 'snapshot'`, `autoEnabled: true`, `minAudioMs: 1000`, `recommendedUpdateMs: 500`.
- Whisper small/medium/large: `null` initially. They can be forced later only if benchmarking proves acceptable.
- Cohere Transcribe: `null`.
- Moonshine streaming models: `strategy: 'streaming'`, `autoEnabled: true`, `minAudioMs` and `recommendedUpdateMs` based on Moonshine integration benchmarks.

Family capabilities gain adapter-level support:

```rust
pub enum LivePartialStrategy {
    Snapshot,
    Streaming,
}

pub struct ModelFamilyCapabilities {
    pub live_partial_strategies: Vec<LivePartialStrategy>,
    ...
}
```

The sidecar resolves the effective live plan from:

```text
session setting + selected catalog model livePartials + adapter live_partial_strategies
```

The plugin UI reads the model probe result and explains why live dictation is enabled, disabled, or forceable. TypeScript must not infer support from engine names or model IDs.

### Transcript Revisions

`TranscriptReadyEvent` keeps its current shape. The new rules are:

- `revision` is monotonic per `utteranceId`.
- `isFinal: false` may arrive zero or more times.
- Exactly one `isFinal: true` revision should arrive for any utterance that reaches final ASR.
- A partial after a final for the same utterance is stale and ignored by the journal.
- Empty partials are not projected when the utterance has no existing span.
- Empty finals may replace an existing partial span with empty text, for example after final hallucination filtering.

### Transcript Assembly

`assemble_transcript()` must accept an input revision number. It can no longer initialize every transcript at `0`.

The worker owns per-utterance revision state:

```text
next_revision_by_utterance[utterance_id] -> u32
final_seen_by_utterance[utterance_id] -> bool
```

The engine stage uses the requested revision. Post-engine stages may increment from there as they already do.

### Editor Projection

The current projection path can replace only the utterance text range. Live finalization needs to replace the whole projected span because final revisions may add timestamp prefixes or adjust projection metadata after a partial was already inserted.

Change the plugin-side projection model:

- `Session` stores the last full `TranscriptInsertProjection`, not only `projectedText` for the utterance text.
- `NoteSurface` gains `replaceProjection(utteranceId, newProjection, expectedOldProjection)`.
- `replaceProjection` rewrites the full span when unlatched and expected text matches.
- `replaceAnchor` can remain as a convenience wrapper or be replaced by `replaceProjection`.
- User edits to any part of the projected span, including boundary/timestamp prefix, latch the utterance.

Renderer behavior:

- First partial append includes normal boundary spacing/paragraph prefix but no timestamp marker.
- Final revision may add a timestamp marker if timestamps are enabled.
- If the final revision is the first projected revision, append normally.
- If a partial already exists, replace the full projection so timestamp and text offsets remain correct.

## Sidecar Implementation Plan

### Phase 1: Contract And Projection Foundation

Goal: the app can correctly consume partial/final revisions from a fake or test producer before any real live ASR is added.

Implementation:

- Add `livePartialMode` to settings, command types, parsing, defaults, and tests.
- Add model-level `livePartials` catalog metadata and adapter-level `live_partial_strategies`.
- Extend model probe output so the plugin can display effective live support for the selected model.
- Change `assemble_transcript()` to accept a starting revision.
- Add worker-side revision tracking.
- Update `SessionJournal` tests for:
  - partial -> partial -> final accepted,
  - duplicate partial rejected,
  - stale partial rejected,
  - partial after final rejected,
  - empty initial partial ignored by projection.
- Replace plugin projection with full-projection replacement.
- Add tests where:
  - a partial is appended,
  - a final replaces it,
  - the final adds a timestamp prefix,
  - a user edit latches the span and prevents later replacement.

Verification:

- `npm run check:frontend`
- Rust unit tests for protocol/capability parsing and transcript assembly.

### Phase 2: Active Utterance Lifecycle

Goal: the sidecar can track a live utterance before finalization without changing final-only behavior for unsupported models.

Implementation:

- Add `ListeningSession::active_utterance_snapshot()` returning cloned PCM samples, VAD probabilities, voice activity bounds, utterance index, pause metadata if known, and current duration.
- Add `ListeningSession::has_active_utterance()`.
- Add `ActiveSession.active_utterance_id`.
- Allocate `utterance_id` when active speech starts in a live-capable session.
- Freeze per-utterance context before first partial dispatch.
- Reuse the same `utterance_id` and frozen context for finalization.
- Keep final-only sessions on the existing final enqueue path except where shared helper functions remove duplication.

Snapshot constraints:

- Minimum audio before any partial decode: `1000 ms`.
- Partial cadence: default `500 ms`.
- Do not dispatch a new partial if the prior partial for that utterance is still the latest pending worker job.
- Do not dispatch partials while the session is draining, cancelled, or overload-draining.

Verification:

- Rust `session.rs` tests for active snapshots and final metadata consistency.
- Rust `app.rs` tests for ID reuse from live partial to final.
- Tests that context is frozen before first decode and late context is ignored for that utterance.

### Phase 3: Worker Scheduler And Whisper Snapshot Partials

Goal: first end-to-end live text using existing Whisper models, limited to models where repeated decode is realistic.

Implementation:

- Replace the worker's direct command loop with an internal scheduler.
- Add worker commands:
  - `TranscribePartialSnapshot`
  - `TranscribeFinalizedUtterance` or keep `TranscribeUtterance` as final-only
  - `BeginSession`, `EndSession`, `Shutdown`
- Coalesce partial snapshots per utterance.
- Prioritize finals over partials.
- Drop stale partial results after finalization or after a newer revision has emitted.
- Add `LoadedModel::transcribe_partial_snapshot()` with a default unsupported error.
- Implement Whisper snapshot partials using separate decode params:
  - no prompt changes within utterance,
  - single segment,
  - temperature 0,
  - no context carryover from prior partial output,
  - short audio context,
  - pad to minimum duration if whisper requires it.
- Add a small partial stabilizer for Whisper:
  - LocalAgreement-2 for token/word prefixes,
  - volatile suffix allowed but bounded,
  - suppress identical visible partials.
- Enable `auto` only for Whisper tiny/base catalog models.

Verification:

- Unit tests with fake slow partial and final jobs proving final priority.
- Unit tests proving stale partials do not delay or overwrite finals.
- Integration-style sidecar tests with fake loaded model emitting partial/final revisions.
- Manual Obsidian check with Whisper tiny/base:
  - first partial appears within target range,
  - text is replaced in place,
  - stop drains final,
  - cancel removes active session without late writes,
  - user edit latches span.

### Phase 4: Moonshine Streaming Integration

Goal: add a true local streaming ASR engine that makes live dictation feel good without Whisper re-decode cost.

Implementation decision:

- Use Moonshine Voice C++ core through the Rust sidecar.
- Do not use MoonshineJS in the frontend.
- Do not add a Python runtime or Python child process.

Native structure:

- Add Cargo feature `engine-moonshine`.
- Add `RuntimeId::MoonshineVoice` or reuse `OnnxRuntime` only if the integration directly uses the existing Rust `ort` sessions. Default decision is a separate `moonshine_voice` runtime because Moonshine's C++ core owns model loading, streaming state, update intervals, and ONNX Runtime usage.
- Add `ModelFamilyId::MoonshineStreaming`.
- Add `native/src/runtimes/moonshine_voice.rs`.
- Add `native/src/adapters/moonshine_streaming.rs`.
- Add a small FFI boundary module that wraps the C API in safe Rust types.
- Streaming model state lives inside the loaded model or per-utterance stream object; do not reload weights per utterance.

Model store changes:

Moonshine models are directory-shaped, not always a single primary file. Replace "runtime path is always a file" with a proper runtime location:

```rust
pub enum ModelRuntimeLocation {
    File(PathBuf),
    Directory(PathBuf),
}
```

Catalog model metadata gains:

```ts
type RuntimeLocationKind = 'primary_artifact_file' | 'install_directory';

interface CatalogModelRecord {
  runtimeLocationKind: RuntimeLocationKind;
}
```

Defaults:

- Whisper and Cohere: `primary_artifact_file`.
- Moonshine: `install_directory`.

Installer and scanner changes:

- Continue verifying every required artifact by SHA-256.
- Probe receives `ModelRuntimeLocation`.
- Installed model `runtimePath` may point to a file or directory; rename internally to `runtimeLocation` where practical, but wire field can remain `runtimePath` if it is documented as a path string rather than file-only.

Catalog defaults:

- Add Moonshine streaming tiny first.
- Add small/medium only after local benchmark data confirms acceptable CPU and package size.
- `livePartials.autoEnabled = true` for Moonshine streaming tiny.
- Keep Whisper tiny/base available as fallback and comparison.

Verification:

- Build sidecar on Linux first.
- Add release-packaging notes for macOS/Windows before enabling release builds.
- Add smoke tests for model probe, model install metadata, and missing-artifact failures.
- Manual benchmark:
  - record first partial latency,
  - update cadence,
  - final latency after VAD endpoint,
  - CPU load,
  - memory footprint,
  - quality on dictated notes with numbers and technical terms.

### Phase 5: Final-Only Dictation Normalizer

Goal: make final text look like dictation output, not raw ASR, without giving an LLM authority over the transcript.

Implementation:

- Add `StageId::DictationNormalizer`.
- Add `DictationNormalizerStage` after hallucination filtering and before any future user rules.
- `runs_on_partials() == false`.
- Use `text2num` for general number spans.
- Add owned year/date rules with focused tests.
- Preserve segment boundaries and timestamp provenance.
- Emit `Skipped { reason: "no_changes" }` when unchanged.
- Emit payload with compact normalized spans for developer diagnostics only.

Initial rules:

- Cardinals and decimals: `one hundred twenty three`, `three point five`.
- Years: `twenty twenty five`, `twenty oh five`, `nineteen ninety nine`.
- Dates: `january fifth twenty twenty five`, `may six twenty twenty six`.
- Leave ambiguous short phrases unchanged when the surrounding context does not make written-form digits clearly preferable.

Verification:

- Rust unit tests for normalizer rules and no-change cases.
- Stage validation tests proving boundaries do not change.
- Regression tests for ordinary prose where small numbers should remain words when configured threshold says so.

### Phase 6: Revisit LLM Cleanup

Only after live dictation and deterministic normalization are stable:

- Keep LLM cleanup final-only.
- Keep it opt-in and alignment-preserving.
- Do not let it disable or block live partials unless the user explicitly enables an incompatible cleanup mode.
- Prefer a replacement revision after deterministic normalization.

## TypeScript Implementation Plan

### Settings UI

- Add a "Live dictation" setting under Transcription.
- Values: Auto, Always, Off.
- Auto is default.
- Disable or explain Always when selected model has no adapter live strategy.
- Show model details with live capability, strategy, and update cadence.

### Dictation Controller

- Snapshot `livePartialMode` at session start.
- Send `livePartialMode` in `startSession`.
- Treat partial and final `transcript_ready` events through the same `handleTranscriptReady`.
- Keep current logging but include `isFinal` and `revision` in developer logs.

### Session And Projection

- Change `ProjectionState.projected` to store the last full projection.
- Ignore initial empty partials.
- Append first non-empty partial or final.
- Replace full projection on later accepted revisions.
- Allow final empty text to clear an existing partial projection.
- Preserve user-wins latching exactly as today.

### Renderer

- Add `planRevision()` or extend `planAppend()` so it knows whether a revision is partial/final and whether it is replacing an existing projection.
- Do not render timestamps on partial first append.
- Add timestamp prefix on final replacement if timestamps are enabled.
- Commit timestamp state only after the final projection that actually inserted the timestamp.

## Rust Implementation Plan

### Protocol And Capabilities

- Add `LivePartialMode` to `protocol.rs`.
- Add live capability types to `engine/capabilities.rs`.
- Add catalog fields and validation.
- Add protocol tests for defaulting, serialization, and unknown-field handling.

### Session

- Add active snapshot APIs.
- Ensure pause metadata for active snapshots matches final metadata.
- Keep `FinalizedUtterance` as the final-only dispatch object.
- Add a separate `PartialUtteranceSnapshot` type; do not overload `FinalizedUtterance` for non-final audio.

### AppState

- Add live plan resolution at session start.
- Track active utterance ID, context state, last partial dispatch time, and last dispatched audio duration.
- Dispatch partial snapshots only when the live plan allows it.
- Reuse active utterance ID on final enqueue.
- Ensure `finish_active_session(UserStop)` finalizes current utterance and allows the final revision to supersede partials.
- Ensure `CancelSession` ends live partial tracking immediately.

### Worker

- Add scheduler with final priority and partial coalescing.
- Add per-utterance revision state.
- Add partial/final stale guards.
- Keep panic isolation around model load, partial inference, final inference, and post-engine stages.
- Keep request warnings per emitted transcript.

### Adapters

- Whisper:
  - final path unchanged except for revision input.
  - partial snapshot path added behind live plan.
  - enabled by default only for tiny/base catalog models.
- Cohere:
  - no live path.
  - final path unchanged.
- Moonshine:
  - new family/runtime in a later phase.
  - streaming path through C++ core.

## Edge Cases

- **User edits live text:** latch span, journal continues, no further editor replacements for that utterance.
- **Final text is empty after filtering:** replace existing partial text with empty text; if no span exists, project nothing.
- **Partial arrives after final:** journal rejects as stale.
- **Worker falls behind:** coalesce partials and prioritize finals; do not queue unlimited partial jobs.
- **Always-on mode with rapid utterances:** finalized utterance queue behavior remains authoritative; partials are best-effort only.
- **One-sentence mode:** do not stop on partial; stop only after final transcript or existing timeout.
- **Context timeout:** live context freezes to null after 150 ms for that utterance.
- **Timestamps with live partials:** partial append has no timestamp; final replacement may add timestamp.
- **Stop while speaking:** finalize current utterance, emit final revision, then `session_stopped`.
- **Cancel while speaking:** end session and discard pending partial/final work for that session.
- **Model switched mid-session:** ignored until next session because settings are snapshotted.

## Verification Plan

Before merging each implementation PR, run the highest-signal checks for the touched surface.

Minimum for TypeScript-heavy phases:

```bash
npm run check:frontend
```

Minimum for Rust-heavy phases:

```bash
npm run build:sidecar
npm run check:rust
```

Full gate before merging the complete live dictation sequence:

```bash
npm run check
```

Manual acceptance checklist:

- Whisper tiny/base live partials insert and replace text in Obsidian.
- Large Whisper remains final-only in Auto mode.
- User editing a partial prevents later replacement.
- Stop drains a final revision.
- Cancel prevents late writes.
- Timestamps enabled with live partials do not render stale timestamp prefixes.
- Moonshine tiny streaming, once added, produces useful updates without CPU runaway.
- Final normalizer converts representative year/date/number phrases without rewriting ordinary prose.

## Rollout

- This is greenfield. Break command and catalog shapes cleanly; do not add schema migrations or compatibility shims.
- Land in focused PRs in the phase order above.
- Keep `PLANS.md` as the active plan until live dictation and deterministic final normalization are merged, then delete it or replace it with the next active large-change plan.
- Update `timeline.md` only after the first implementation PR lands, so the roadmap reflects shipped reality rather than duplicating this active plan.
