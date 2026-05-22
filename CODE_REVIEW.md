# CODE_REVIEW — 2026-05-22

Comprehensive principal-engineer review of the full pipeline (audio capture → sidecar → VAD → inference → stages → editor) and the supporting install / settings / test infrastructure. Generated from seven parallel reviewer passes against `main` at `1b89fc6`.

---

## How to use this document

You — the agent executing these fixes — should treat each finding as a self-contained work item.

For every finding, you have:

- **ID** (`H1`, `M3`, etc.) — stable across the doc; reference it in commit messages and PRs.
- **Location** — `file:line` ranges at the time of writing. Re-verify line numbers before editing; the file may have moved.
- **Problem** — one paragraph stating the concrete defect or weakness.
- **Why it matters** — observable consequence. If a finding's "why it matters" no longer applies (e.g., consumer was removed), update or close the finding instead of fixing.
- **Fix** — concrete direction. Where there's a meaningful design choice, options are listed; pick the one that fits the scope of your PR and justify in the commit message.
- **Acceptance** — what counts as "done" for that item, including the test that must exist.
- **Risk / blast radius** — what could regress, what to watch for during manual verification.

### Recommended sequencing

Work in small, independently reviewable PRs. Each bundle below maps to one PR. Bundles are ordered so earlier ones reduce risk for later ones (e.g., M8 round-trip tests land before H3/H4 so the shutdown-path changes have coverage to lean on).

Sequence assumes single-agent execution; if you want parallelism, PR-1 and PR-3 can run side-by-side (no overlapping files).

**PR-1 — Protocol robustness (Bundle A.1, ~half day) — DONE**
- ~~H1 (frame payload cap)~~ — RESOLVED
- ~~H2 (deliver-then-fail on parse error)~~ — RESOLVED

Touches: `src/sidecar/protocol.ts`, `src/sidecar/sidecar-connection.ts`, `test/protocol.test.ts`. Smallest blast radius; pure parser-and-caller changes; high downstream value because it makes everything else safer to test.

**PR-2 — Install crash-safety + streaming decompress (Bundle A.2, ~half day)**
- H7 (atomic install promotion via `.old` rename)
- H8 (streaming gunzip)

Touches: `src/sidecar/sidecar-installer.ts`, `test/sidecar-installer.test.ts`. Self-contained file. Land before any next CUDA work; H8 specifically matters once large bundles ship.

**PR-3 — Zero-coverage modules (Bundle A.3, parallel with PR-1/2, ~half day)**
- H9 (`path-validation.ts` tests)
- H10 (`PcmFrameProcessor` tests)
- M9 (`enforceLlmContextCap` tests)
- M12 (`SidecarInstallManager` re-install path test)

Touches: only new files under `test/`. Independent of PR-1/PR-2; safe to run concurrently with another agent. If any of these tests fail on `main`, you have discovered a latent bug — escalate before continuing.

**PR-4 — `SidecarConnection` round-trip coverage (~half day)**
- M8 (round-trip tests)

Touches: new `test/sidecar-connection.test.ts`. Must land before PR-5 because PR-5 changes the shutdown semantics this test pins.

**PR-5 — Shutdown / restart correctness (Bundle B.1, ~half day)**
- H3 (shutdown command write race — prefer Option A: drop the wire command)
- H4 (drain waiters in `shutdown()`)

Touches: `src/sidecar/sidecar-connection.ts`, possibly `src/sidecar/sidecar-process.ts`, new tests in `test/sidecar-connection.test.ts`. Bundles cleanly because both fix the same lifecycle bug.

**PR-6 — Rust shutdown contract (Bundle B.2, ~half day)**
- H6 (document `Command::Shutdown` as hard cancel + smoke test)
- H5 (queue saturation naming alignment — pure docstring/rename)
- M5 (`stage_payload_with_duration` always sets `durationMs`)

Touches: `native/src/app.rs`, `native/src/stages/mod.rs`, `docs/system-architecture.md`. All small, all Rust-side, all align contracts.

**PR-7 — Hallucination filter tightening (Bundle B.3, ~half to full day)**
- H11 (domain + prompt-leak false-positive fixes)
- M4 (LLM postprocess char-length cap)
- M11 (`done_reason: "length"` + HTTP-error tests)

Touches: `native/src/stages/hallucination_filter.rs`, `native/src/stages/llm_postprocess.rs`. Read M4 first — small change unlocks one of the M11 test assertions.

**PR-8 — Settings hardening (Bundle C, ~quarter day)**
- M6 (`schemaVersion` field — one line)
- M7 (`setupCompletedAt` ISO-8601 validation)
- M10 (note-closed-mid-session warn log)

Touches: `src/settings/plugin-settings.ts`, `src/dictation/dictation-session-controller.ts`, tests. Trivial individually; bundle to avoid PR overhead.

**PR-9 — Worker hot-path allocations (Bundle D.1, ~quarter day)**
- M3 (cache `Arc<ModelFamilyCapabilities>` and `supports_initial_prompt` on `WorkerSession`)
- L2 (worklet allocation reduction — only if you can verify with a profile)

Touches: `native/src/worker.rs`, `src/audio/pcm-frame-processor.ts`. L2 ships only if H10 has landed (you need the test bed). Skip L2 if you can't measure the win.

**PR-10 — Test slimming and consolidation (Bundle E, ~half day)**
- L6 delete list (~125 LOC recovered)
- L6 consolidate list (~80 LOC recovered)
- L5 (visualizer threshold tests → directional assertions)

Touches: many `test/*.test.ts` files. Lowest priority; ship when you want to reduce maintenance load. Do **not** bundle with bug fixes — keep test slimming reviewable on its own.

**Refactor-when-touched (no scheduled PR)**
- M1 (`app.rs` → `SessionRegistry` extraction) — biggest refactor in the doc. Only do it when you have another reason to touch `app.rs` substantially, or schedule a dedicated PR with one reviewer.
- M2 (`local-dictation-view.ts` → settings panel extraction) — only when next adding a settings section.
- L7 (`missingNewlines` dedupe) — when next touching `transcript/renderer.ts` or `session/session.ts`.
- L4 (`mapPos` intent pin-down test) — when next investigating an editor edge case.
- L8 (`dictation-ribbon` dead `_queueTier`) — when H5/H6 outcomes clarify the UX intent.
- L1 (audio aliasing doc) — backlog item; no PR until someone wants to add the biquad LPF.
- L3 (`cancelModelInstall` short-circuit) — fold into the next install-related PR.
- L9 (`Runtime` trait doc) — fold into M1 or any Rust-side touch.

### Sanity checks per PR

Before opening each PR:

```
npm run check:js     # typecheck + lint + tests + frontend build
npm run check:rust   # cargo check + tests (long)
```

For PRs touching protocol or connection: also manually run a 30-second dictation session in dev to confirm no regression in the happy path.

### Verification before starting

Run these from the repo root before any of the work:

```
git status
git log --oneline -10           # confirm you are on or after 1b89fc6
npm run typecheck
npm run lint
npm test
npm run check:rust
```

The TS test suite is fast (<20s) and the Rust check is the long pole. The Rust sidecar is built on Fedora 44 against GLIBC_2.43 (see `memory/linux-glibc-portability.md`) — do **not** rebuild it unless the user has explicitly asked for a release-ready binary; you'll mint a binary that breaks installs on older Linux distros.

### Out of scope / do not do

These were considered and rejected, or explicitly out of scope:

- **Do not rename or reformat files.** Findings cite line ranges; renames invalidate the doc.
- **Do not add a settings migration framework.** The single-line `schemaVersion` addition (M2) is enough. No `MigrationV1ToV2` classes.
- **Do not add retry/backoff to Ollama** beyond the explicit one-shot retry called out in L2. Local dictation is not a network-distributed service.
- **Do not split `app.rs` into more than one new module** unless you are doing M1 in full. Partial splits leave the invariants worse off than the monolith.
- **Do not delete tests outside the explicit list in §6.** The lists are exhaustive for what's safe to drop; everything else earns its keep.
- **Do not introduce `node:tar` or another archive dep** for H8. Stream the gunzip; keep the in-house tar parser.

---

## Findings index

| ID | Severity | Title | File |
|----|----------|-------|------|
| ~~H1~~ | ~~HIGH~~ | ~~Frame parser has no payload-length cap~~ — **RESOLVED** | `src/sidecar/protocol.ts` |
| ~~H2~~ | ~~HIGH~~ | ~~`pushChunk` discards valid frames on later parse failure~~ — **RESOLVED** | `src/sidecar/protocol.ts` + `sidecar-connection.ts` |
| H3 | HIGH | Shutdown command can be truncated by immediate `stdin.end()` | `src/sidecar/sidecar-connection.ts` |
| H4 | HIGH | `restart()` may reject waiters against the new process | `src/sidecar/sidecar-connection.ts` |
| H5 | MEDIUM | Queue saturation threshold: intent vs. behavior alignment | `native/src/app.rs` |
| H6 | HIGH | `Command::Shutdown` drops sessions before draining the worker | `native/src/app.rs` |
| H7 | HIGH | TS install promotion is not crash-safe | `src/sidecar/sidecar-installer.ts` |
| H8 | HIGH | `extractTarGz` buffers and decompresses synchronously | `src/sidecar/sidecar-installer.ts` |
| H9 | HIGH | `path-validation.ts` has zero direct tests | `src/filesystem/path-validation.ts` |
| H10 | HIGH | `PcmFrameProcessor` has zero test coverage | `src/audio/pcm-frame-processor.ts` |
| H11 | HIGH | Hallucination filter false-positives (domain + prompt leak) | `native/src/stages/hallucination_filter.rs` |
| M1 | MEDIUM | `app.rs` (2639 LOC) — extract session/queue state machine | `native/src/app.rs` |
| M2 | MEDIUM | `local-dictation-view.ts` (872 LOC) — extract section renderers | `src/ui/local-dictation-view.ts` |
| M3 | MEDIUM | Per-utterance allocations in worker hot path | `native/src/worker.rs` |
| M4 | MEDIUM | LLM postprocess byte-length cap on multibyte input | `native/src/stages/llm_postprocess.rs` |
| M5 | MEDIUM | `stage_payload_with_duration` silently no-ops on missing placeholder | `native/src/stages/mod.rs` |
| M6 | MEDIUM | `plugin-settings.ts` has no `schemaVersion` | `src/settings/plugin-settings.ts` |
| M7 | MEDIUM | `setupCompletedAt` accepts any string | `src/settings/plugin-settings.ts` |
| M8 | MEDIUM | `SidecarConnection` round-trip is untested | `src/sidecar/sidecar-connection.ts` |
| M9 | MEDIUM | `enforceLlmContextCap` is untested | `src/dictation/dictation-session-controller.ts` |
| M10 | MEDIUM | Note-closed-mid-session silently loses batch cleanup | `src/dictation/dictation-session-controller.ts` |
| M11 | MEDIUM | `done_reason: "length"` and Ollama HTTP-error tests missing | `native/src/stages/llm_postprocess.rs` |
| M12 | MEDIUM | `SidecarInstallManager` re-install path untested | `test/sidecar-install-manager.test.ts` |
| L1 | LOW | Audio resample aliasing is silent and undocumented | `src/audio/pcm-frame-processor.ts` |
| L2 | LOW | Per-render-quantum allocations in worklet | `src/audio/pcm-frame-processor.ts` + worklet |
| L3 | LOW | `cancelModelInstall` respawns sidecar to send a no-op | `src/sidecar/sidecar-connection.ts` |
| L4 | LOW | `mapPos` text-bias intent unclear; needs pin-down test | `src/editor/note-surface.ts` |
| L5 | LOW | Visualizer smoothing-math tests assert on internal constants | `test/audio-visualizer-tap.test.ts` |
| T1 | TESTS | Delete tautological tests (~125 LOC) | various — see TESTS section |
| T2 | TESTS | Consolidate near-duplicate tests (~80 LOC) | various — see TESTS section |
| T3 | TESTS | Add high-ROI tests for uncovered modules | cross-ref H9/H10/M8/M9/M12 |
| L7 | LOW | `missingNewlines` duplicated between renderer and session | `src/transcript/renderer.ts` + `src/session/session.ts` |
| L8 | LOW | `dictation-ribbon.ts` `_queueTier` parameter is dead | `src/ui/dictation-ribbon.ts` |
| L9 | LOW | `runtime` trait doc oversells what it actually does | `native/src/engine/traits.rs` |

---

# HIGH

## H1 — Frame parser has no payload-length cap

**Status.** RESOLVED. `MAX_FRAME_PAYLOAD_BYTES` (16 MiB, mirroring `native/src/protocol.rs`) now caps `pushChunk` before any payload slice is allocated; over-cap frames raise a fatal that drains waiters and tears down the sidecar via the unexpected-exit path.

**Location:** `src/sidecar/protocol.ts:540-578` (`FramedMessageParser.pushChunk`) and `src/sidecar/protocol.ts:623-629` (`readUint32LE`).

**Problem.** `pushChunk` reads a `u32` payload length from the frame header and then `buffered.slice(offset + 5, offset + 5 + payloadLength)`. The Rust side enforces `MAX_FRAME_PAYLOAD = 16 * 1024 * 1024` (`native/src/protocol.rs:21`); the TS side accepts the full `u32` range. A single corrupted byte at a frame boundary that mutates the kind byte or the length header can cause the parser to wait for, and eventually allocate, up to ~4 GiB.

**Why it matters.** The renderer is Electron — a 1+ GiB allocation will OOM the Obsidian window. The current recovery (`frameParser.reset()` inside `handleStdoutChunk`'s catch at `sidecar-connection.ts:398-407`) only runs *after* the allocation attempt and never runs while the parser is still buffering toward a bogus target length. A misbehaving or compromised sidecar binary (or a transient disk/IPC corruption) reaches this trivially.

**Fix.**

1. In `src/sidecar/protocol.ts`, add a module-level constant matching the Rust value:

   ```ts
   const MAX_FRAME_PAYLOAD_BYTES = 16 * 1024 * 1024;
   ```

2. In `FramedMessageParser.pushChunk` at the line where `payloadLength` is read (currently 549), guard immediately after the read and before any slicing:

   ```ts
   if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
     throw new Error(
       `Sidecar frame payload exceeds limit: ${payloadLength} bytes (max ${MAX_FRAME_PAYLOAD_BYTES}).`,
     );
   }
   ```

3. Ensure `handleStdoutChunk` (sidecar-connection.ts ~398-407) treats this throw as **stream-fatal**: respawn the sidecar rather than continuing. The current catch already resets the parser; extend it to also reject pending waiters and trigger the process restart path that exit-on-crash uses. The cleanest expression is to convert the throw into a synthetic `Event { type: 'error', code: 'protocol_fatal', ... }` and then call `process.stop()` so the existing `onExit` flow handles respawn.

**Acceptance.**

- A new test in `test/protocol.test.ts` that calls `parser.pushChunk()` with a hand-crafted byte sequence whose length header encodes `0xFFFFFFFF`; expect a thrown error mentioning `MAX_FRAME_PAYLOAD_BYTES`.
- A second test confirming a 16 MiB payload at the boundary is accepted (or rejected — pick the spec, document the inclusivity, and pin it).
- Manual: trigger a corrupted-stream scenario in dev (e.g., have the sidecar write a single garbage byte then a normal frame) and confirm the connection recovers without OOM.

**Risk.** Aligning TS to Rust is symmetry-positive. The only risk is if some legitimate frame is currently >16 MiB; grep for any TS-side caller that might construct a payload that large (`get_system_info`, `model_catalog`, `installed_models` responses — none should approach the cap).

---

## H2 — `pushChunk` discards valid frames on later parse failure

**Status.** RESOLVED. `pushChunk` now returns `{ frames, fatal }`; `handleStdoutChunk` dispatches every decoded frame before reacting to the fatal, then logs, rejects pending waiters with a meaningful message, and calls `process.stop()` so the existing unexpected-exit handler respawns on the next request.

**Location:** `src/sidecar/protocol.ts:556-578` (`FramedMessageParser.pushChunk`) and `src/sidecar/sidecar-connection.ts:398-407` (`handleStdoutChunk`).

**Problem.** The loop decodes frames into a local `frames` array. If frame N+1 fails to parse (bad JSON, unknown kind, unsupported payload), the throw propagates out of `pushChunk` before `return frames`. The catch in `handleStdoutChunk` then calls `frameParser.reset()`, which clears `this.buffered`. Frames N and earlier — already correctly decoded — are dropped on the floor.

**Why it matters.** A single malformed frame causes collateral loss of adjacent valid frames. A `transcript_ready` arriving in the same chunk as a corrupted later frame would be silently lost while the user's pending-waiter ticks toward a timeout error. Two months from now, a user reports "sometimes my transcripts just disappear" and there's no log line because the parser threw on the *next* frame.

**Fix.** Restructure `pushChunk` so that already-decoded frames are delivered even when a later frame fails. The minimum-diff version:

```ts
pushChunk(chunk: Uint8Array): {
  frames: ParsedFrame[];
  fatal?: Error;
} {
  this.buffered = concatBytes(this.buffered, chunk);
  const frames: ParsedFrame[] = [];
  let offset = 0;
  let fatal: Error | undefined;

  while (this.buffered.byteLength - offset >= FRAME_HEADER_LENGTH) {
    const kind = this.buffered[offset];
    if (kind === undefined) break;

    const payloadLength = readUint32LE(this.buffered, offset + 1);
    if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
      fatal = new Error(`Sidecar frame payload exceeds limit: ${payloadLength} bytes.`);
      break;
    }

    const frameLength = FRAME_HEADER_LENGTH + payloadLength;
    if (this.buffered.byteLength - offset < frameLength) break;

    const payload = this.buffered.slice(offset + FRAME_HEADER_LENGTH, offset + frameLength);

    try {
      if (kind === JSON_FRAME_KIND) {
        frames.push({ envelope: this.parseJsonEnvelope(textDecoder.decode(payload)), kind });
      } else if (kind === AUDIO_FRAME_KIND) {
        const { frameBytes, sessionId } = decodeAudioFrameEnvelope(payload);
        frames.push({ frameBytes, kind, sessionId });
      } else {
        fatal = new Error(`Unsupported sidecar frame kind: ${kind}`);
        break;
      }
    } catch (error) {
      fatal = asError(error, 'Failed to parse sidecar frame.');
      break;
    }

    offset += frameLength;
  }

  this.buffered = fatal ? new Uint8Array(0) : this.buffered.slice(offset);
  return { frames, fatal };
}
```

Update `handleStdoutChunk` to dispatch `frames` first, then if `fatal` is set, log + reject waiters + trigger respawn (same path as `onExit`). The `reset()` call is no longer needed because we already cleared `this.buffered` on the fatal branch.

**Acceptance.**

- Update `test/protocol.test.ts` "throws on unknown frame kind" to assert that frames *before* the bad one are still delivered.
- Add a test: two well-formed `transcript_ready` frames followed by an unknown-kind byte in one chunk → both transcripts delivered, fatal returned.
- Confirm the existing chunk-split tests still pass.

**Risk.** Callers (currently `handleStdoutChunk` only) need to change return-shape handling. No external API change; `pushChunk` is private to the protocol layer's consumers via the parser instance held by `SidecarConnection`. Grep for `.pushChunk(` to confirm.

---

## H3 — Shutdown command can be truncated by immediate `stdin.end()`

**Location:** `src/sidecar/sidecar-connection.ts:295-306` (`shutdown()`) and `src/sidecar/sidecar-process.ts:90-106` (`stop()` / stdin-end semantics).

**Problem.** `shutdown()` does `this.process.write(encodeJsonFrame(createShutdownCommand()))` in a `try` block, then `await this.process.stop()` in `finally`. `stop()` closes stdin via `child.stdin.end()`. Node's `Writable.write()` returns when the chunk is *buffered*, not when it's *flushed* to the OS pipe. If the OS pipe buffer is saturated (large audio writes in flight), the shutdown command's bytes can be split or dropped when `end()` runs.

**Why it matters.** Two bad outcomes:

1. Rust reads a partial header and emits a `ProtocolError` (`native/src/protocol.rs:622`). The TS catch on `onExit` doesn't get a special signal; the next sidecar launch is fine but exit telemetry is dirtied.
2. Worse: the Rust `Command::Shutdown` path drains active sessions (H6 below). Truncated shutdown means the Rust process exits via stdin EOF instead — both paths exist (`native/src/main.rs:62` handles `Ok(None)` cleanly), but they have *different* semantics for in-flight stages. The plugin's expected behavior diverges from the Rust side's actual behavior.

**Fix.** Two options.

**Option A (preferred — smaller change).** Drop the wire-level `shutdown` command and rely on stdin EOF.

Steps:

1. In `src/sidecar/sidecar-connection.ts:295-306`, remove the `process.write(...)` call. Keep `expectedStop = true` and the `await this.process.stop()`.
2. In `native/src/protocol.rs`, deprecate but keep `Shutdown` for backward compat with any external host that sends it. The Rust `main.rs` handles `Ok(None)` (EOF) by exiting cleanly, which is functionally equivalent.
3. Add a comment in `shutdown()` explaining: "Stdin EOF is the shutdown signal; the wire-level Shutdown command is redundant and was removed to avoid write-vs-end races."

**Option B (preserve the command).** Make the write actually drain.

Steps:

1. In `src/sidecar/sidecar-process.ts`, expose `flush(): Promise<void>` that resolves when the stdin write buffer is empty (use `child.stdin.write(... , callback)` semantics with `cork`/`uncork` or simply track outstanding writes and resolve when drained).
2. In `shutdown()`, await `process.flush()` before `process.stop()`.

Take Option A unless you discover a host beyond this plugin that depends on the wire command.

**Acceptance.**

- New test in `test/protocol.test.ts` or a new `sidecar-connection.test.ts` that drives the connection through `shutdown()` and asserts `child.stdin.end()` is called and no audio frame is partially written. For Option A: assert the wire-level `shutdown` command is *not* written.
- Manual: run a session, send several seconds of audio, immediately call shutdown; confirm clean exit and no Rust-side `ProtocolError` in logs.

**Risk.** Option A changes the protocol surface (no more `shutdown` command). Search for any external consumer; there should be none. The Rust side keeps decoding the command if some legacy host sends it.

---

## H4 — `restart()` may reject waiters against the new process

**Location:** `src/sidecar/sidecar-connection.ts:289-306` (`restart`, `shutdown`, `onExit` handler at lines 97-116).

**Problem.** `restart()` calls `shutdown()` → `ensureStarted()` → `healthCheck()`. `shutdown()` sets `expectedStop = true`. The `onExit` handler eventually fires, calling `rejectPendingWaiters(...)` and resetting `expectedStop = false`. `process.stop()` only awaits exit with a 2s timeout (`sidecar-process.ts:152-163`). If exit fires *after* `ensureStarted()` resolves (e.g., the process took >2s to die), `rejectPendingWaiters` runs against waiters that may belong to the *new* process.

A second issue: pre-existing waiters from before `restart()` (e.g., an `installModel` whose user-facing promise is still live) keep their `setTimeout` running and resolve/reject against events from the new sidecar.

**Why it matters.** Restart is invoked when the user changes the model variant or after a crash. Today the failure mode is rare (requires the 2s grace to be exceeded), but it produces a confusing user-facing error: "Timed out waiting for sidecar event: health_ok" appears when the request actually succeeded against the new process.

**Fix.** Drain pending waiters explicitly inside `shutdown()` before touching the process state.

In `src/sidecar/sidecar-connection.ts:295-306`, replace `shutdown()` with:

```ts
async shutdown(): Promise<void> {
  if (!this.process.isRunning()) {
    return;
  }

  this.expectedStop = true;
  this.rejectPendingWaiters(new Error('Sidecar is shutting down.'));

  try {
    // Option A path: no wire-level shutdown command.
    // Option B path: write + flush before stop.
  } finally {
    await this.process.stop();
  }
}
```

Note: the `onExit` handler also calls `rejectPendingWaiters` — that becomes a no-op for waiters we already drained, which is fine.

**Acceptance.**

- Test: queue a `sendCommandAndWait`, call `shutdown()` immediately. The waiter rejects with "Sidecar is shutting down." (not "Sidecar exited unexpectedly").
- Test: call `restart()`, then issue a new `healthCheck()` against the new process; assert it resolves and was not affected by any prior waiter cleanup.

**Risk.** Low. Callers that ignored shutdown-time rejections will now see them; double-check `restart()` itself isn't sitting on a waiter created inside `shutdown()`'s scope (it isn't — `healthCheck()` runs after `ensureStarted()`).

---

## H5 — Queue saturation threshold: intent vs. behavior alignment

**Location:** `native/src/app.rs:902-948` (`enqueue_utterance`) and the constant `MAX_QUEUED_UTTERANCES` (defined near top of `app.rs`). Test at `app.rs:2204` (`enqueue_at_saturation_accepts_and_enters_overload_drain`).

**Severity note.** The reviewer flagged this as HIGH; my read on a second pass is the behavior and the user-facing message are already consistent ("queue depth reached saturation at 30" fires when `queued_utterances == 30`). The genuine concern is that the test cements the exact threshold, so any policy change must update the test. Downgrading to MEDIUM unless verification (below) finds a real off-by-one.

**Problem.** The increment-then-check order means `queued_utterances` reaches `MAX_QUEUED_UTTERANCES` only after the 31st enqueue (1 in-flight + 30 queued). The constant name implies "max queued depth allowed"; the comparison `>= MAX_QUEUED_UTTERANCES` reads as "fire on equality". Whether the policy is "30 queued is OK, 31 is overload" or "30 queued is overload" depends on which reading you take.

**Why it matters.** If you intend overload to *prevent* the 31st enqueue, current code accepts it before firing. If you intend overload to fire *at* depth 30, current code matches. Confirm intent.

**Fix.**

1. Read `app.rs` constants block and find the docstring on `MAX_QUEUED_UTTERANCES`.
2. Decide between two consistent options:
   - **A — fire-at-N:** keep `>= N`, rename constant to `QUEUE_OVERLOAD_DEPTH`, update docstring: "When `queued_utterances` reaches this value, the session enters overload-drain."
   - **B — accept-up-to-N-1:** change comparison to `> N - 1` (equivalent to `>= N`, no behavior change) but rename to `MAX_QUEUED_UTTERANCES_ALLOWED` with docstring: "Maximum queued utterances accepted before overload."
3. Update the test name and the user-facing message string to match.

**Acceptance.** Constant name, docstring, comparison, message, and test all describe the same policy. No behavior change required.

**Risk.** Pure naming/docstring fix. No wire-protocol impact.

---

## H6 — `Command::Shutdown` drops sessions before draining the worker

**Location:** `native/src/app.rs:566-573`.

**Problem.**

```rust
Command::Shutdown => {
    for (_, active_session) in self.active_sessions.drain() {
        let _ = active_session.cancel_tx.send(true);
    }
    let _ = self.transcription_worker.send(WorkerCommand::Shutdown);
    (ControlFlow::Shutdown, events)
}
```

Drain order: `ActiveSession` values are dropped first, which drops their `cancel_tx` watch senders. Any worker task awaiting on those receivers (e.g., LLM postprocess at `stages/llm_postprocess.rs:97`, `wait_until_cancelled`) sees the channel close. `tokio::watch::Receiver::changed()` returns `Err` on a closed channel; depending on how `wait_until_cancelled` interprets that, the stage either treats it as cancellation (silently dropping the LLM result) or returns an error.

Either way, the user-visible "shutdown drops a final transcript" behavior is undocumented and depends on subtleties in the cancel-await path.

**Why it matters.** Shutdown is the moment users are most likely to expect "either finish or tell me you didn't." Silent drops here surface as lost transcripts after the user closes Obsidian or restarts the plugin.

**Fix.** Define the contract explicitly and align code.

Recommended contract: **Shutdown is a hard cancel.** In-flight stages are aborted, no final events are emitted, the process exits. Users should not assume shutdown completes pending work; they should call `requestStopSession` first if they want graceful completion.

Steps:

1. Add a docstring above the `Command::Shutdown` arm describing: hard cancel, no graceful drain, callers must `Stop` first if they want completion.
2. Add a Rust integration test in `native/src/app.rs` (or a new `native/tests/`): start a session, enqueue an utterance, send `Command::Shutdown`, assert no `TranscriptReady` arrives after the shutdown.
3. Document in `docs/system-architecture.md`: "`shutdown` ≠ graceful stop. Use `stop_session` per session, then `shutdown` to terminate the process."

**Acceptance.** Test exists; doc updated.

**Risk.** No behavior change. Purely documentation + a regression test pinning current semantics.

---

## H7 — TS install promotion is not crash-safe

**Location:** `src/sidecar/sidecar-installer.ts:181-196`.

**Problem.**

```ts
await options.beforeReplace?.();
await rm(destinationDirectory, { force: true, recursive: true });
await rename(stagingDirectory, destinationDirectory);
```

If the process dies between the `rm` and the `rename`, the user has no installed sidecar and a populated staging dir. The error path (`rm(stagingDirectory)` in catch at line 192) cleans up only on a caught throw, not on a hard crash.

The Rust installer does this correctly: per-artifact `.part` rename, then staging-dir → target-dir promotion (`native/src/installer.rs:677-711`).

**Why it matters.** Atomic install is the difference between "user retries and it works" and "user has to manually delete a half-installed plugin directory." This is a one-line crash window today; it widens once CUDA installs ship (more time spent in the gap).

**Fix.** Rename existing destination to `.old` first, promote staging, then remove `.old`.

In `src/sidecar/sidecar-installer.ts:181-196`, replace the `rm` + `rename` block with:

```ts
await options.beforeReplace?.();

const backupDir = `${destinationDirectory}.old`;
const destExists = (await getExistingPathKind(destinationDirectory)) !== 'missing';

if (destExists) {
  await rm(backupDir, { force: true, recursive: true }); // clean any prior leftover
  await rename(destinationDirectory, backupDir);
}

try {
  await rename(stagingDirectory, destinationDirectory);
} catch (renameError) {
  if (destExists) {
    await rename(backupDir, destinationDirectory).catch((rollbackError) => {
      options.logger?.warn(
        'installer',
        `Failed to roll back install backup: ${asError(rollbackError, 'rollback').message}`,
      );
    });
  }
  throw renameError;
}

if (destExists) {
  await rm(backupDir, { force: true, recursive: true });
}
```

Add `getExistingPathKind` import from `'../filesystem/path-validation'` if not already present. (It is exported there.)

**Acceptance.**

- New test in `test/sidecar-installer.test.ts`: inject a failure between the two renames (e.g., make `rename` from staging throw) and assert the destination directory is restored to its pre-install state.
- Existing tests continue to pass without modification.

**Risk.** The `.old` dir lingers if the process crashes between rename-out and rename-in. On the next install, the cleanup `rm(backupDir)` at the top of the new path handles it. Verify this manually by killing the process mid-install in dev.

---

## H8 — `extractTarGz` buffers and decompresses synchronously

**Location:** `src/sidecar/sidecar-installer.ts:434-436`.

**Problem.** `await readFile(archivePath)` loads the entire tarball into memory; `gunzipSync(compressed)` is a blocking synchronous decompress on the Node event loop. For the CPU sidecar (~20-50 MB) it's barely noticeable. For the CUDA bundle (hundreds of MB) it will block the Obsidian renderer thread for multi-second windows and double peak RSS.

**Why it matters.** The first CUDA install on a user machine will be the worst-case path. Obsidian will visibly freeze. This is fixable cheaply now while the only consumer is the CPU sidecar; once CUDA ships, the freeze is in the field.

**Fix.** Stream the gunzip into a buffer, keep the existing tar parser (do not introduce `node:tar` as a dep).

Replace the body of `extractTarGz` (lines 434-436) with:

```ts
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const chunks: Buffer[] = [];
  await pipeline(
    createReadStream(archivePath),
    createGunzip(),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  const decompressed = Buffer.concat(chunks);
  // ... existing tar block-parsing loop, unchanged ...
}
```

This removes the blocking sync gunzip while keeping the in-house tar parser. Memory is still O(archive size) but at least the event loop is not blocked.

**Acceptance.**

- Existing `test/sidecar-installer.test.ts` extract tests pass unchanged (they construct tar.gz via `gzipSync` and the new code path handles that identically).
- Add one test verifying the new path: extract a fixture tar.gz containing two files; assert both are present in destDir.

**Risk.** Low. The streaming-into-buffer pattern is well-trodden. Watch for memory pressure on very large CUDA bundles — if the in-memory buffer becomes a problem, the follow-up is a streaming 512-block tar parser (not in scope here).

---

## H9 — `path-validation.ts` has zero direct tests

**Location:** `src/filesystem/path-validation.ts` (whole file, 57 lines).

**Problem.** `assertAbsoluteExistingFilePath` is the trust boundary for any user-configured external file path that the plugin reads or passes to the sidecar. It is referenced indirectly by other tests (via UI flows) but has no direct coverage.

Current contract (from the source):

- Empty / whitespace → "not configured"
- Relative → "must be absolute"
- Missing → "does not exist"
- Directory → "must point to a file"
- Other (FIFO, device, socket) → "must point to a file"
- Symlink → followed by `stat`; if target is a regular file, returns the (unresolved) symlink path

**Why it matters.** Security-adjacent. Even if no current consumer is exploit-relevant, a missing test means a contract change can ship undetected.

**Fix.** Add `test/path-validation.test.ts` with these cases:

- empty string → throws (`/${label} is not configured/`)
- whitespace-only string → throws "not configured" (verify behavior; current `trim()` makes this true)
- relative path `'./foo'` → throws "must be absolute"
- missing absolute path `/nonexistent/path/12345` → throws "does not exist"
- existing directory (use `os.tmpdir()`) → throws "must point to a file"
- existing regular file (create a temp file with `fs.writeFile`) → returns the path unchanged
- symlink to file (create via `fs.symlink`) → returns the symlink path (document this is the contract)
- symlink to directory → throws "must point to a file"

Use `vitest`'s `beforeAll` + `afterAll` to create + tear down temp fixtures under `os.tmpdir()`.

**Acceptance.** `npm test` passes with the new file. Manual: change one of the assertion strings in `path-validation.ts` and confirm the test fails loudly.

**Risk.** None. Pure test addition.

**Open design question (raise before extending the contract).** Should the validator resolve symlinks (`fs.realpath`) and re-check the resolved path? Today it doesn't. If a future feature lets users configure an arbitrary file path that the sidecar then reads with elevated context (it shouldn't, but if), symlinks become a vector. For now: document the no-resolution behavior, add the symlink-passes-through test, surface this question in the PR description.

---

## H10 — `PcmFrameProcessor` has zero test coverage

**Location:** `src/audio/pcm-frame-processor.ts` (whole file).

**Problem.** The resampler + frame packer is the highest-risk module in the audio path. Off-by-one errors in `nextOutputPosition`, drift across `push()` calls, mishandling of frame boundaries — any of these silently corrupts the audio the sidecar transcribes. The visualizer (purely UI) has ~200 lines of tests; the resampler has none.

**Why it matters.** A drift bug here manifests as Whisper transcribing garbage on long sessions. There is no observable signal during a 30-second test; you need long-form drift coverage.

**Fix.** Add `test/pcm-frame-processor.test.ts` with these tests. The exact API surface (constructor options, `push`, `reset`, output frame format) is documented in `src/audio/pcm-frame-processor.ts`; read it before authoring tests so the test reflects the real contract.

Test plan:

1. **16 kHz identity.** Construct with `sourceSampleRate: 16000, targetSampleRate: 16000`. Push N=4800 samples (300 ms) as a known ramp (0, 1, 2, ..., 4799 normalized to f32). Collect emitted frames; concatenate i16; assert the i16 sequence equals the input ramp (after f32→i16 quantization).

2. **48 kHz → 16 kHz decimation.** Push 14400 samples (300 ms at 48 kHz) of a constant value 0.5. Expect 4800 output samples (300 ms at 16 kHz, ≈15 frames of 320 samples). All output samples should be 0.5 (after quantization).

3. **44.1 kHz → 16 kHz drift.** Push 44100 samples (1 s) of a 1 kHz sine. Expect 16000 output samples. Assert frame count = 50 (50 × 320 = 16000); assert the last frame's first sample is the correctly interpolated value (not zero, not silence). Then push another 44100 samples and assert no drift in frame count over 2 seconds.

4. **Frame boundary continuation.** Configure such that one `push()` of 333 samples (at 16 kHz, identity) produces 1 frame (320 samples) plus 13 samples buffered. Second `push()` of 307 samples should produce exactly 1 more frame (320 = 13 + 307). Assert the boundary samples are continuous (no dropped or duplicated sample at frame seams).

5. **`reset()` re-initialization.** Push a partial frame, call `reset()`, push a full frame's worth. Assert the partial samples did not bleed into the post-reset output.

**Acceptance.** All five tests pass. Manual: run a 5-minute dictation session and confirm Whisper output remains coherent (already implicit baseline; mention it in PR test plan).

**Risk.** None. Pure test addition.

---

## H11 — Hallucination filter false-positives (domain heuristic + prompt leak)

**Location:** `native/src/stages/hallucination_filter.rs:392-402` (`is_bare_domain`) and `:461-480` (`is_prompt_leak`).

**Problem.**

1. **`is_bare_domain`** returns Soft (eligible to drop with minor corroboration) for any whitespace-free token containing a dot and only alphanumeric/dot/dash/slash/underscore/`?` chars. This matches legitimate dictation tokens: `node.js`, `v1.2`, `U.S.A.`, `ctrl.shift`, `step.1`. With even one weak corroborator (e.g., a brief low-VAD segment), these can be dropped.

2. **`is_prompt_leak`** drops segments on exact 8-word n-gram match against context, with one corroborator. If the user is intentionally re-dictating a phrase that appears in `PriorUtterance` context (correction flow, glossary re-statement), the legitimate utterance can be dropped. The `glossary:` prefix shortcut also bypasses corroboration entirely.

**Why it matters.** Silent transcript drops are the worst-class hallucination-filter failure: the user sees nothing arrive and has no idea why. Compared to a leaked hallucination, a missed drop is a much better failure mode.

**Fix.**

**Domain heuristic (`is_bare_domain`).** Tighten the post-dot suffix check:

```rust
fn is_bare_domain(normalized: &str) -> bool {
    let text = normalized
        .strip_prefix("https://")
        .or_else(|| normalized.strip_prefix("http://"))
        .unwrap_or(normalized);
    if text.contains(' ') || !text.contains('.') {
        return false;
    }
    if !text.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '/' | '_' | '?')) {
        return false;
    }
    // Require the final dot-separated component to look like a TLD:
    // 2+ ASCII alphabetic chars, optionally followed by /path.
    let after_last_dot = text
        .rsplit_once('.')
        .map(|(_, tail)| tail.split('/').next().unwrap_or(tail))
        .unwrap_or("");
    after_last_dot.len() >= 2 && after_last_dot.chars().all(|ch| ch.is_ascii_alphabetic())
}
```

This rejects `node.js` (suffix `js` — but wait, `js` is 2 chars alphabetic — still passes). Hmm. We need a stricter rule. Better: require the suffix to be in a small allowlist of common TLDs *or* require the whole segment to be only that token. Pick one:

- **Option A — TLD allowlist.** `matches!(after_last_dot, "com" | "org" | "net" | "io" | "ai" | "co" | "edu" | "gov" | "uk" | "us" | "de" | "fr" | ...)`. Maintainable; misses long-tail TLDs.
- **Option B — "domain alone in segment" rule.** Only classify as bare-domain when the segment normalizes to exactly one token. Loses some hallucination coverage but reduces false-positives drastically.

Recommend Option B for simplicity. The hallucination filter's job is to drop *segments that consist of* a hallucinated URL, not to drop legitimate prose that happens to contain a dotted identifier.

```rust
fn is_bare_domain(normalized: &str) -> bool {
    // Only flag when the entire segment is a single token resembling a URL.
    if normalized.split_whitespace().count() != 1 {
        return false;
    }
    let text = normalized
        .strip_prefix("https://")
        .or_else(|| normalized.strip_prefix("http://"))
        .unwrap_or(normalized);
    text.contains('.')
        && text.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '/' | '_' | '?'))
}
```

Add tests in the existing `mod tests` block:

```rust
#[test]
fn node_js_not_classified_as_bare_domain() {
    assert!(!is_bare_domain("we use node.js for the backend"));
}

#[test]
fn standalone_url_classified_as_bare_domain() {
    assert!(is_bare_domain("example.com"));
}

#[test]
fn standalone_url_with_path_classified_as_bare_domain() {
    assert!(is_bare_domain("https://example.com/api"));
}
```

**Prompt leak.** Two changes:

1. Require ≥2 corroborators (not 1). The corroborator counting lives in `apply_filter` (read the surrounding code to find the exact site).
2. Exclude `PriorUtterance` source from the leak check — only `NoteContext` or `Glossary` count.

You will need to read the `ContextWindow` / `SegmentEvidence` types to find where source provenance is tracked. If the current `normalized_context` is a single flattened string with no source labels, this is a slightly larger refactor (tracking source in evidence). In that case, ship the domain-heuristic fix in one PR and the prompt-leak refactor in a follow-up.

**Acceptance.**

- Domain heuristic: new tests above; existing tests continue to pass.
- Prompt leak: add a fixture where the leak phrase appears only in `PriorUtterance`; assert no drop. Add a fixture where the leak phrase appears in `NoteContext` with one corroborator; assert no drop (raised threshold). Add a fixture with two corroborators; assert drop.

**Risk.** The filter's primary job is to *prevent* hallucinations from leaking through. Loosening the heuristic raises the false-negative rate (real hallucinations slipping through). Mitigate by running the existing fixture suite end-to-end after the change and reading the `repeated_ngram_dominates` + `repeated_suffix_dominates` paths to confirm the strongest hallucinations are still caught.

---

# MEDIUM

## M1 — Extract session/queue state machine from `app.rs`

**Location:** `native/src/app.rs` (entire file, especially `ActiveSession` and its co-dependent fields).

**Problem.** `app.rs` is 2639 lines. Most of the complexity is concentrated in the session/queue state machine: `ActiveSession` has 11 fields (`draining`, `overload_draining`, `transcription_active`, `queued_utterances`, `pending_context_requests`, `last_reported_*`, etc.) manipulated across 8 free/method functions (`graceful_stop`, `finish_session`, `maybe_complete_drain`, `enqueue_utterance`, `advance_transcription_queue`, `emit_queue_tier_if_changed`, `derive_session_state`, `dispatch_pending`). Reasoning about cross-field invariants requires reading the whole file.

**Why it matters.** The next non-trivial change to session semantics (per-model overrides, per-session feature flags, a second engine family) will pay an outsized maintenance tax here. Today it's working code — but adding to it without an extraction means the next reviewer pays for the postponement.

**Fix.** Extract a `SessionRegistry` (new file `native/src/session_registry.rs`) owning the `HashMap<SessionId, ActiveSession>` and exposing intent-shaped methods:

- `enqueue(&mut self, session_id, utterance) -> Result<EnqueueOutcome, EnqueueError>`
- `record_engine_complete(&mut self, session_id, utterance_id) -> Vec<Event>`
- `request_graceful_stop(&mut self, session_id) -> Vec<Event>`
- `try_complete_drain(&mut self, session_id) -> Option<Event>`
- `expire_pending_context(&mut self, now: Instant) -> Vec<Event>` (the `tick()` path)
- `derive_session_state(&self, session_id) -> SessionStateSnapshot`

`AppState` retains command dispatch, model-resolution, and worker plumbing. `ActiveSession` and its helpers move out, taking their tests with them.

**Acceptance.**

- `app.rs` drops by ~600-800 lines.
- All existing tests pass without modification (the tests live in `mod tests` blocks at the bottom of `app.rs` — move the session-state ones with the extraction).
- `native/src/lib.rs` exposes the new module if it needs cross-module access; otherwise it's private to the binary.

**Risk.** Largest refactor in the doc. Do this only when you have a reason to touch `app.rs` anyway, or as a standalone scheduled refactor with a dedicated PR. Do not bundle with bug fixes.

**Do not** further split `app.rs` beyond this one extraction. Smaller files at the cost of more cross-module signatures is a worse trade for this codebase's size.

---

## M2 — Extract section renderers from `local-dictation-view.ts`

**Location:** `src/ui/local-dictation-view.ts` (entire file, 872 lines).

**Problem.** The class blends three concerns: (a) view lifecycle + Ollama health refresh + render scheduling; (b) settings persistence + preset application; (c) section-by-section DOM construction via 13 `render*Section`/`render*` methods. The renderers are pure builders that take `(parent, settings)` and emit DOM — they don't read mutable instance state beyond `lastEnabledMode`, `models`, `ollamaHealth`.

**Why it matters.** A new settings section means adding to a 872-line file. Find/jump is slower; PR diffs are larger; testing a renderer in isolation requires a full view instance.

**Fix.** Extract a `LocalDictationSettingsPanel` (new file `src/ui/local-dictation-settings-panel.ts`). The panel takes a context interface:

```ts
interface LocalDictationViewContext {
  getSettings(): PluginSettings;
  persistSettings(next: PluginSettings): Promise<void>;
  saveField<K extends keyof PluginSettings>(key: K, value: PluginSettings[K]): Promise<void>;
  openModal(modal: 'manage-models' | 'save-style' | ...): void;
  readonly ollamaHealth: OllamaHealth;
  readonly models: ModelState[];
  readonly lastEnabledMode: Mode | null;
  refreshModels(): Promise<void>;
}
```

Move all `render*` methods + `activePresetOverride` + `describeMode` + `formatStyleOptionLabel` into the panel. `LocalDictationView` retains `onOpen`/`onClose`, focus tracking, render scheduling, and Ollama health refresh.

**Acceptance.**

- `local-dictation-view.ts` shrinks to ~300 LOC.
- No behavior change; existing tests pass.
- New file is unit-testable with a fake context; do not add new tests unless they cover a bug not already covered.

**Risk.** Low. Pure refactor. Watch for `this.` references inside renderer methods that depend on mutable state — those need to move through the context interface, not be captured.

---

## M3 — Per-utterance allocations in worker hot path

**Location:** `native/src/worker.rs:270-286`.

**Problem.** `worker_main` looks up `(runtime_id, family_id)` in the registry on each utterance, and clones `ModelFamilyCapabilities` per utterance. Capabilities are fixed at session open; both the lookup and the clone are pure waste.

**Why it matters.** Hot-path allocations contribute to GC pressure under sustained dictation. On its own, small. As one of several allocation sources (see L2 for the audio thread), worth fixing while you're nearby.

**Fix.** Cache an `Arc<ModelFamilyCapabilities>` on `WorkerSession` at `BeginSession`. Also cache the derived `supports_initial_prompt: bool` (output of `apply_capability_gates` for the fixed-input case). Reuse on every utterance.

**Acceptance.**

- No behavior change; existing tests pass.
- Diff is small (one new field on `WorkerSession`, one assignment in `BeginSession`, two reads replaced).

**Risk.** None. The registry lookup result and capabilities are immutable for a given session.

---

## M4 — LLM postprocess byte-length cap on multibyte input

**Location:** `native/src/stages/llm_postprocess.rs:152`.

**Problem.** `output.len() > input.len() * 10 + 1000` compares byte lengths. For CJK or accented inputs where a 3-character word is 9 bytes, the cap inflates. For an ASCII "yes" input (3 bytes), the cap is 1030 bytes — a legitimate cleanup that adds a sentence trips it.

**Why it matters.** Today's user base is mostly English, so the cap effectively works. Once a non-English user runs the LLM postprocess on a short utterance, legitimate output is rejected as "too long."

**Fix.** Use character counts:

```rust
let max_output_chars = trimmed_input.chars().count() * 10 + 1000;
if output.chars().count() > max_output_chars {
    return /* truncation failure */;
}
```

Or, replace the heuristic with an absolute cap derived from `NUM_PREDICT`:

```rust
let max_output_chars = NUM_PREDICT * 8; // ~8 chars per token average
```

Pick whichever expresses the intent more clearly. The byte-length cap was never the intent; it was a misuse of `.len()`.

**Acceptance.**

- Add a test: input = "好" × 10 (3-byte chars), output = "好" × 50. With the old byte rule: input bytes = 30, cap = 30 * 10 + 1000 = 1300; output bytes = 150. Passes. With ASCII "yes" × 10 (30 bytes), output that's 1500 bytes (legitimate elaboration) — passes too. The test should verify the new char-based rule rejects only true runaways.
- Existing length-cap tests continue to pass.

**Risk.** Tightens the cap for ASCII inputs (10× chars instead of 10× bytes). For ASCII these are identical. No regression.

---

## M5 — `stage_payload_with_duration` silently no-ops on missing placeholder

**Location:** `native/src/stages/mod.rs:188-197`.

**Problem.** `stage_payload_with_duration` only patches `durationMs` when the key already exists in the payload. Stages that forget to emit the placeholder produce events with no `durationMs` field and no warning.

**Why it matters.** Today only two stages exist (hallucination_filter, llm_postprocess) and both emit the placeholder. As `punctuation` and `user_rules` land, the contract is easy to violate.

**Fix.** Unconditionally set `durationMs` from the loop:

```rust
fn stage_payload_with_duration(payload: &mut serde_json::Value, duration_ms: u64) {
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("durationMs".to_string(), serde_json::json!(duration_ms));
    }
}
```

Remove the "must contain placeholder" requirement; stages no longer need to emit it.

**Acceptance.**

- Existing tests pass.
- Add one test: a fake stage that returns a payload without `durationMs` placeholder — assert the runner inserts it.

**Risk.** None. The only behavior change is that stages no longer need to declare an intent to participate in duration reporting; they get it automatically.

---

## M6 — `plugin-settings.ts` has no `schemaVersion`

**Location:** `src/settings/plugin-settings.ts` (resolver near top of file).

**Problem.** `resolvePluginSettings` silently back-fills every default. There is no version field, so future renames or default-semantic changes will silently coerce old data through the new shape.

**Why it matters.** Greenfield today, so it's costless. The cost arrives the first time a key is renamed or its semantics shift, and that's exactly when you need the version field already present.

**Fix.** Add a single field to `DEFAULT_PLUGIN_SETTINGS`:

```ts
schemaVersion: 1 as const,
```

Update the resolver to read and preserve it (no migration logic; just pass it through). Update the type. Write a one-line comment: "Bump `schemaVersion` and add a migration step when renaming a key or changing default semantics."

**Acceptance.**

- Existing `plugin-settings.test.ts` passes.
- Loading a settings blob without `schemaVersion` resolves to `schemaVersion: 1` (the resolver's default-fill behavior gives this for free).

**Risk.** None. Single field addition.

**Do not** build a `MigrationStep[]` array or migration framework. Wait until the first real rename. YAGNI.

---

## M7 — `setupCompletedAt` accepts any string

**Location:** `src/settings/plugin-settings.ts:222`.

**Problem.** The resolver coerces `setupCompletedAt` with `typeof === 'string'`. A garbage value (e.g., `"corrupted"`) silently survives and the wizard treats the user as onboarded.

**Why it matters.** Tiny window; the only way to set this is via the plugin itself, which always writes ISO-8601. But it's a two-line hardening.

**Fix.** Validate ISO-8601:

```ts
function coerceSetupCompletedAt(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? raw : null;
}
```

**Acceptance.**

- Test: `resolvePluginSettings({ setupCompletedAt: 'corrupted' }).setupCompletedAt === null`.
- Test: `resolvePluginSettings({ setupCompletedAt: '2026-05-22T10:00:00.000Z' }).setupCompletedAt === '2026-05-22T10:00:00.000Z'`.

**Risk.** None.

---

## M8 — `SidecarConnection` round-trip is untested

**Location:** `src/sidecar/sidecar-connection.ts` (whole file, 503 LOC).

**Problem.** Every higher test mocks `SidecarConnection`. The layer that does request/response correlation, event multiplexing, error envelope handling, subscribe/unsubscribe accounting — none of it is tested directly.

**Why it matters.** A regression in correlation-id matching, stale-response leakage, or subscribe-accounting ships unnoticed.

**Fix.** Add `test/sidecar-connection.test.ts` with a fake `SidecarProcessLike` that lets the test drive `onStdoutChunk` with framed bytes. Use `encodeJsonFrame` from `protocol.ts` to construct fixtures.

Minimum tests:

1. **Correlation:** issue `sendCommandAndWait(command, matches, ...)` where `matches` checks an `installId`; deliver an unrelated event first, then the matching event. Assert the waiter receives only the matching event.
2. **Subscribe:** call `subscribe(listener)`, deliver an event, assert listener fires. Call the unsubscribe function, deliver another event, assert listener does not fire.
3. **Timeout:** issue a command, deliver no response, advance fake timers past the timeout. Assert rejection.
4. **Crash mid-request:** issue a command, fire `onExit` from the fake. Assert rejection with "Sidecar exited unexpectedly..." and `pendingWaiters.size === 0`.
5. **Error frame:** issue a command, deliver an `Event { type: 'error', code: 'invalid_frame' }`. Assert the waiter rejects (default `rejectOnError` returns true).

**Acceptance.** Five tests pass. Suite uses Vitest's fake timers (`vi.useFakeTimers()`) for the timeout case.

**Risk.** None. Pure test addition.

---

## M9 — `enforceLlmContextCap` is untested

**Location:** `src/dictation/dictation-session-controller.ts:980-1015` (verify the line range; the function may have moved).

**Problem.** The only thing keeping the LLM context window inside `totalContextCap`. The loop trims `note_text` first, then `prior_utterance`, using `truncateLeadingText` to shrink the head. No direct tests; `dictation-session-controller.test.ts` only mocks `readNoteText` to return null.

**Why it matters.** Off-by-one on `overflow`, wrong source kind dropped first, or input-array mutation would ship undetected.

**Fix.**

1. Export `enforceLlmContextCap` from the controller (or pull it into a sibling util file if you want a cleaner unit).
2. Add `test/enforce-llm-context-cap.test.ts` with:
   - cap met without trim → array unchanged
   - cap exceeded by `note_text` → note_text trimmed from the front, others untouched
   - cap exceeded across multiple sources → trim order matches the documented preference (note_text → prior_utterance)
   - cap-zero edge case → no sources retained
   - input array is not mutated (assert by reference equality on the original)

**Acceptance.** Five tests; all pass.

**Risk.** Low. Export adds a small public surface; gate behind a comment marker if you want to keep it internal-by-convention.

---

## M10 — Note-closed-mid-session silently loses batch cleanup

**Location:** `src/dictation/dictation-session-controller.ts:665-696` and `src/session/session.ts:432-445`.

**Problem.** If the locked note closes after `requestStopSession` but before `session_stopped` arrives, the session's surface is `null` by the time the controller tries `requestBatchCleanup`. `readCurrentSessionText` returns `''`, the controller calls `disposeLocalSession`, and returns. No notice, no log. The raw transcript is gone.

**Why it matters.** This is a UX silent-failure path. The user closed the note, expected nothing to happen, got nothing — but if they expected the cleanup to run on what they dictated, it didn't.

**Fix.** At the silent-bail site (~line 669-672), emit at minimum a `logger.warn`:

```ts
this.logger.warn(
  'dictation',
  'batch cleanup skipped: locked note closed before transcript could be read',
);
```

Stronger fix: surface an Obsidian `Notice` so the user sees "Cleanup skipped because the note was closed." Decide based on whether you want the user to learn this, or treat it as expected behavior.

**Acceptance.** Test that drives the controller through the close-before-stopped sequence and asserts the log/notice fires.

**Risk.** None.

---

## M11 — `done_reason: "length"` and Ollama HTTP-error tests missing

**Location:** `native/src/stages/llm_postprocess.rs:127-139` (truncation branch), `:236-238` (HTTP error branch), `:675` (existing mock server harness).

**Problem.** The two most common Ollama failure modes are untested. The mock server harness already exists; the missing assertions are one or two extra response shapes.

**Fix.** Add two tests in `llm_postprocess.rs`'s `mod tests`:

```rust
#[tokio::test]
async fn done_reason_length_reports_truncation() {
    // Mock server returns done_reason: "length" with a partial response.
    // Assert StageProcess::Failed with truncated: true in the payload.
}

#[tokio::test]
async fn http_503_reports_unavailable() {
    // Mock server returns HTTP 503.
    // Assert StageProcess::Failed with an unavailable-style code in the payload.
}
```

Match the exact failure-reporting conventions used by the stage today; read `:127-139` and `:236-238` first.

**Acceptance.** Two tests pass.

**Risk.** None.

---

## M12 — `SidecarInstallManager` re-install path untested

**Location:** `test/sidecar-install-manager.test.ts`.

**Problem.** Coverage exists for concurrent-install rejection, abort/cancel, and install failure. The "successful install completes → state cleared → second install runs cleanly" path is missing. This is exactly where a stale `activeInstall` would bite.

**Fix.** Add one test:

```ts
it('allows a second install to start after the first completes successfully', async () => {
  installSidecarMock.mockResolvedValueOnce(/* success result */);
  await manager.installSidecar(/* args */);
  expect(manager.activeInstall).toBeNull();

  installSidecarMock.mockResolvedValueOnce(/* success result */);
  await manager.installSidecar(/* args */);
  expect(manager.activeInstall).toBeNull();
  expect(installSidecarMock).toHaveBeenCalledTimes(2);
});
```

**Acceptance.** Test passes.

**Risk.** None.

---

# TESTS

This section consolidates **test-quality** findings that span multiple files. Individual test gaps that map to specific source defects are still listed under the relevant HIGH/MEDIUM finding (e.g., H10 for `PcmFrameProcessor`, M8 for `SidecarConnection`).

## T1 — Delete tautological tests

The following tests assert that the code does what its source code literally does, with no externalized contract. Each one would pass against a regex-or-constant copy of the implementation. Delete them.

| File | Test | Lines saved | Reason |
|------|------|-------------|--------|
| `test/audio-visualizer-tap.test.ts` | "snaps to the peak on the first tick after silence" | ~10 | Implementation-detail constant |
| `test/audio-visualizer-tap.test.ts` | "releases slowly between syllables" | ~14 | Pins RELEASE coefficient |
| `test/audio-visualizer-tap.test.ts` | "boosts midrange amplitude via the perceptual sqrt curve" | ~9 | Tautology with sqrt constants in comment |
| `test/model-install-manager.test.ts` | "produces unique install IDs in the expected format" | ~10 | Asserts the regex the impl literally constructs |
| `test/model-install-manager.test.ts` | "isTerminalInstallState" matrix | ~10 | Collapse to single `it.each` |
| `test/plugin-settings.test.ts` | three `useLlmNoteContext` tests | ~14 | Subsumed by existing matrix |
| `test/note-surface.test.ts` | "keeps same-cursor sessions ordered when the earlier session writes first" | ~15 | Tautology; the "later writes first" twin is the interesting case |
| `test/protocol.test.ts` | "encodes get_system_info and health as bare-typed payloads" | ~6 | Duplicates framing test |
| `test/dictation-anchor-extension.test.ts` | three direct effect-readback tests | ~25 | Tautological dispatch-and-read |
| `test/transcript-renderer.test.ts` | "isMeaningfulPause" | ~7 | Tautology |
| `test/transcript-renderer.test.ts` | "formatSessionHeader" | ~7 | Round-trip; covered indirectly elsewhere |

**Method.** Delete one test at a time. After each removal, run `npm test`. If removing reveals a real coverage gap (a test elsewhere now fails or a downstream invariant becomes shaky), restore the test and document why.

**Acceptance.** Suite passes; ~125 LOC recovered.

**Risk.** Low, but irreversible without git. Open one PR for the whole batch so reviewers can object individually.

## T2 — Consolidate near-duplicate tests

These groups exercise the same property with trivial variations. Collapse using `it.each` and the shared fixtures already present in `test/fixtures/` and `test/helpers/`.

| File | Tests to consolidate | Target |
|------|---------------------|--------|
| `test/note-surface.test.ts` | glossary acronym / identifier trio (lines 437-471) | one `it.each([doc, expectedGlossary])` |
| `test/note-surface.test.ts` | rewriteRegion trio (lines 362-407) | one `it.each` driven by `{ userEdit?, allowedSpans }` |
| `test/protocol.test.ts` | model_probe_result pair (305-371) | extract `probeResultPayload(overrides)` fixture beside the existing `transcriptReadyPayload` |
| `test/plugin-settings.test.ts` | user-preset validation quartet (263-309) | one `it.each` table over `[input, expected]` |
| `test/presets.test.ts` | per-builtin existence tests (28-50) | one `it.each` over `[id, mode, /promptRegex/]` |
| `test/dictation-anchor-extension.test.ts` | cursor-overlap pair (93-103, 105-117) | one test that walks the selection through all four positions inside a single state machine |
| `test/session.test.ts` | "range tracking follows transcript revisions" (355-366) + "replaceSessionRangeWithCleaned succeeds when current range matches" (313-327) | one combined test that exercises `accept rev0 → accept rev1 → accept u2 → replaceSessionRangeWithCleaned` and asserts both properties in one pass |

**Acceptance.** Same behavioral coverage; ~80 LOC recovered.

**Risk.** Low. `it.each` reports per-row failures, so signal granularity is preserved.

## T3 — Add high-ROI tests for uncovered modules

Index of test-additions called out elsewhere in this document. Each is described in detail under its primary finding; cross-referenced here so test-focused reviewers can scan the list:

1. **`path-validation.ts` boundary tests** — see H9. Whole module untested; security-adjacent trust boundary.
2. **`PcmFrameProcessor` resample + frame-pack tests** — see H10. Whole module untested; highest-risk audio path.
3. **`SidecarConnection` round-trip** — see M8. 503 LOC of correlation/multiplexing/error handling between two well-tested layers.
4. **`enforceLlmContextCap` unit tests** — see M9. Only thing enforcing the LLM context cap.
5. **`SidecarInstallManager` re-install path** — see M12. Where stale `activeInstall` state would bite.

Plus a sixth that doesn't have its own headline finding:

6. **`Session.replaceSessionRangeWithCleaned` denied-rewrite paths.** `session.test.ts` covers the happy path but never exercises the `nextRewriteResult = { kind: 'denied', reason: { kind: 'range_partial' } }` or `range_invalid` branches. Add one test for each; assert the function returns the documented "failed" outcome and the document state is unchanged.

**Acceptance.** All six test files exist; each test fails if the corresponding source contract is broken.

## T4 — Residual notes on existing high-LOC test files

These are **not** flagged for change; documenting why so a future agent doesn't try to slim them and discover the rationale the hard way.

- **`test/sidecar-installer.test.ts` (553 LOC)** — every test pins a real attack surface (path traversal, redirect chain, write-stream failure, manifest atomicity). Cost-to-blast-radius ratio is correct. Keep all.
- **`test/model-install-manager.test.ts` (760 LOC)** — earned by the state-machine surface (init / install / cancel / cancelStuck / remove / select / independence / capabilities). Two specific cuts noted in T1; the harness at lines 611-660 is load-bearing for test readability.
- **`test/note-surface.test.ts` (533 LOC)** — earned by anchor-survival logic under concurrent edits. Consolidations in T2 reduce it modestly; do not pursue further.
- **`test/session.test.ts` FakeSurface (lines 21-138)** — re-implements span tracking. Acceptable today because the alternative is a real CodeMirror harness, but a bug in `NoteSurface.rewriteRegion` could be masked by a matching bug in the fake. Re-evaluate if `Session` and `NoteSurface` drift apart again.
- **`test/dictation-session-controller.test.ts` "silently enforces the five-session cap" (lines 191-203)** — borderline tautological. Tighten to assert the user-visible signal (notice, state, or logged warning) on the rejected 6th attempt. This is a small fix; bundle with PR-3 above.

---

# LOW

## L1 — Audio resample aliasing is silent and undocumented

**Location:** `src/audio/pcm-frame-processor.ts:54-69` (the linear-interp loop).

**Problem.** Linear interpolation with no anti-alias low-pass filter applied to inputs at 44.1/48 kHz downsampled to 16 kHz. Content above 8 kHz folds back into the speech band.

**Fix.** Document the trade-off in a file-header comment. Optional follow-up: add a cheap biquad LPF at ~7.5 kHz before decimation (a few hundred multiplies per 128-sample quantum). Not in scope here; flag as a backlog item.

**Acceptance.** Comment added; behavior unchanged.

---

## L2 — Per-render-quantum allocations in worklet

**Location:** `src/audio/pcm-frame-processor.ts:98` and `src/audio/pcm-recorder.worklet.ts:49`.

**Problem.** `mixChannelsToMono` returns a new `Float32Array` per 128-sample quantum (50-750 Hz allocation rate in the audio thread). `PcmFrameProcessor.push` allocates a copy of `frameBuffer` per emitted frame (50/sec). Allocation in the audio render thread is the classical pattern that causes intermittent glitches under GC pressure.

**Fix.** Reuse a single mono buffer (member of `PcmFrameProcessor`); skip the `.slice()` on the i16 frame buffer since `postMessage(..., [frame.buffer])` already transfers the underlying ArrayBuffer.

**Acceptance.** Tests added in H10 continue to pass. Manual: profile in dev with the Performance tab; allocation rate in the audio thread should drop materially.

**Risk.** Transfer-then-reuse semantics are subtle. If you transfer the underlying `ArrayBuffer`, the worklet-side `Int16Array` is detached and must be reallocated for the next frame anyway. Read `postMessage` semantics carefully before changing.

---

## L3 — `cancelModelInstall` respawns sidecar to send a no-op

**Location:** `src/sidecar/sidecar-connection.ts:241-243`.

**Problem.** `cancelModelInstall` calls `sendCommand`, which always calls `ensureStarted()`. If the sidecar crashed mid-install, this respawns a new sidecar purely to send a cancel for an install that no longer exists in the new process's state.

**Fix.** Short-circuit when `!this.process.isRunning()`:

```ts
cancelModelInstall(installId: string): void {
  if (!this.process.isRunning()) {
    return;
  }
  this.process.write(encodeJsonFrame(createCancelModelInstallCommand(installId)));
}
```

**Acceptance.** Add a test: with a stopped process, calling `cancelModelInstall` does not spawn a new process.

**Risk.** None.

---

## L4 — `mapPos` text-bias intent unclear; needs pin-down test

**Location:** `src/editor/note-surface.ts:499`.

**Problem.** The recent change to `textEnd, -1` bias is correct for sibling appends but has knock-on behavior on the `replaceAnchor` path when the user types at `textEnd`. The intent — should typing at the tail latch the span, or not? — is not pinned by any test.

**Fix.** Add one test in `test/note-surface.test.ts`:

```ts
it('keeps a single span replaceable when the user types after it', () => {
  // append span "hello", user types " world" at position 5,
  // replaceAnchor "hello" → "HELLO!".
  // Expected: document is "HELLO! world".
});
```

(Or assert the opposite if that's the intended contract — pick one and document it.)

**Acceptance.** Test exists and passes.

**Risk.** None. Pure pin-down.

---

## L5 — Visualizer smoothing-math tests assert on internal constants

**Location:** `test/audio-visualizer-tap.test.ts:147-153, 155-168, 170-178`.

**Problem.** Three tests assert numeric thresholds (`> 0.85 && < 0.97`, `> 0.6`) derived by recomputing the exact `ATTACK`/`RELEASE` constants in the test comments. Any tweak to the perceptual smoothing breaks the tests without revealing a real defect.

**Fix.** Replace with direction + ordering assertions:

- "first tick after silence: level > 0.5" (instead of "> 0.85 && < 0.97")
- "level decays monotonically over the next 10 ticks of silence" (instead of pinning the RELEASE coefficient)
- Drop the sqrt-curve test entirely; the band-routing pair already covers the observable contract.

**Acceptance.** Tests are ~10 lines shorter; same behavior verified directionally.

**Risk.** None.

---

## L7 — `missingNewlines` duplicated between renderer and session

**Location:** `src/transcript/renderer.ts:194` and `src/session/session.ts:608`.

**Problem.** Two copies of the same helper. The session-side copy lives in `applyRawPostprocessCallout`, which constructs a `TranscriptInsertProjection` outside the renderer's "render is the single endpoint" contract.

**Fix.** Extract `missingNewlines` to a shared util (`src/transcript/missing-newlines.ts` or co-located with the renderer). Both call sites import it.

Stronger fix: route the callout through the renderer with a "callout append" affordance, so `Session` is no longer constructing projections.

**Acceptance.** No behavior change; existing tests pass.

**Risk.** Low.

---

## L8 — `dictation-ribbon.ts` `_queueTier` parameter is dead

**Location:** `src/ui/dictation-ribbon.ts:139`.

**Problem.** Parameter is named `_queueTier` (underscore indicates "intentionally unused"), and the field `queueTier` is set but never read in `buildRibbonState`. `setQueueTier` triggers a render that produces identical output.

**Fix.** Either:

- **A** — remove the parameter and the field. Dead code.
- **B** — wire `queueTier` into the label/icon to give the user visible feedback when the queue saturates.

Pick B if the queue-saturation UX is intentional; A otherwise. Decide based on the H5 / H6 outcomes (do users learn about queue state? if no, drop the dead field).

**Acceptance.** No dead parameters in the ribbon controller.

**Risk.** None.

---

## L9 — `Runtime` trait doc oversells what it actually does

**Location:** `native/src/engine/traits.rs:11-15`.

**Problem.** The doc comment claims the trait "owns accelerator registration/probe and the model-file formats it understands." In reality, it only carries `id()` and `capabilities()`. All build logic lives in `runtimes/onnx.rs::build_session` (free function) and `WhisperContext::new_with_params` (called directly from `whisper.rs`).

**Fix.** Two options.

- **A** — rewrite the doc to match reality: "Capability reporter. Returns identifier and supported features; does not execute model loading."
- **B** — lean into the trait by moving CUDA pre-check / dylib preload behind it.

Recommend A unless you find a real need for B.

**Acceptance.** Doc matches code.

**Risk.** None.

---

# Legacy / compat shims

Greenfield audit: **none found across all seven reviewer passes.** PRs #98/#99 effectively removed the remaining compat layers. No `#[deprecated]`, no `// TODO`, no fallback "v1/v2" branches. The closest things are:

- `native/src/stages/hallucination_filter.rs:8` `version: u32 = 1` — forward-versioning, not a compat shim. Keep.
- `native/src/app.rs:1057-1061` `Treating Ready as Invalid keeps the dispatch exhaustive…` — defensive narrowing in a state-machine dispatch. Keep.
- `src/audio/pcm-recorder-worklet-source.ts` — one-line bridge to a virtual esbuild module. Intentional indirection. Keep.

Do not delete anything in this category without explicit verification.

---

# Appendix — File map of changes implied by HIGH bundle

If you do Bundle A (H1, H2, H7, H8, H9, H10) in one PR, the touched files are:

- `src/sidecar/protocol.ts` (H1, H2)
- `src/sidecar/sidecar-connection.ts` (H2 caller-side)
- `src/sidecar/sidecar-installer.ts` (H7, H8)
- `src/filesystem/path-validation.ts` (read-only; no source change)
- `test/protocol.test.ts` (H1, H2 acceptance)
- `test/sidecar-installer.test.ts` (H7 acceptance)
- `test/path-validation.test.ts` (new — H9)
- `test/pcm-frame-processor.test.ts` (new — H10)

If you do Bundle B (H3, H4, H6, H11):

- `src/sidecar/sidecar-connection.ts` (H3, H4)
- `src/sidecar/sidecar-process.ts` (H3 if Option B)
- `native/src/app.rs` (H6 docstring + test)
- `native/src/stages/hallucination_filter.rs` (H11)
- `docs/system-architecture.md` (H6)

Run `npm run check:js && npm run check:rust` before opening any PR.
