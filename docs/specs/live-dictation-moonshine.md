# Spec: Live Dictation with Moonshine v2 Streaming

Status: approved for implementation (handoff to Codex)
Issue: [#175](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/175)
Companion plan: `PLANS.md` (repo root, local only).

## Product goal

Apple-Dictation-quality live transcription: words appear in the note within
~1 s of being spoken, and already-visible words revise in place as the model
hears more context, then lock in ("finalize") when the utterance ends. This is
not a toggle or a mode — it is what a session feels like when the selected
model is a *streaming* model. Batch models (Whisper, Cohere Transcribe) are
untouched and keep their current behavior.

First streaming model: **Moonshine v2 streaming**
([UsefulSensors/moonshine-streaming-tiny](https://huggingface.co/UsefulSensors/moonshine-streaming-tiny)
/ `-small` / `-medium`; MIT; English-only; 34M/123M/245M params;
[paper](https://arxiv.org/abs/2602.12241)). Its ergodic sliding-window
streaming encoder (80 ms lookahead, no positional embeddings) is designed for
exactly this: bounded-latency incremental encoding of an open-ended audio
stream. Moonshine's own MIT reference stack (`moonshine-ai/moonshine`) ships a
`Transcriber` that revises a live line every ~500 ms and finalizes it on a
pause — the UX bar and the event shape we replicate.

## Explicitly out of scope (this PR)

- Model Explorer / catalog integration, `install_model` support, packaging,
  release plumbing. The model is downloaded manually and selected through the
  existing `external_file` model selection. Catalog integration is a follow-up
  once the live path is proven.
- Diarization and system-audio speaker attribution for streaming sessions
  (see D8).
- Non-English languages (Moonshine streaming is English-only).

## Why a new code path

Today the sidecar is strictly batch: `ListeningSession` (`native/src/session.rs`)
buffers PCM until Silero VAD closes an utterance, `TranscriptionWorker`
(`native/src/worker.rs`) transcribes the finished clip via
`LoadedModel::transcribe`, and exactly one `transcript_ready` with
`is_final: true` is emitted per utterance (`worker.rs:264`). Nothing reaches
the note while the user is mid-sentence.

The receiving side, however, is already revision-native:

- `TranscriptReady` carries `isFinal` + `revision` (`native/src/protocol.rs`,
  `src/sidecar/protocol.ts`).
- The plugin journal upserts revisions and rejects non-final-after-final
  (`src/session/session-journal.ts:100`).
- `DictationSession.projectRevision` (`src/session/session.ts:304`) appends the
  first revision of an utterance and replaces later ones in place, guarded by
  revision monotonicity (`session.ts:409`).
- `NoteSurface.replaceAnchor` (`src/editor/note-surface.ts:232`) does
  compare-and-swap replacement with latching (`user_edited` / `span_mismatch`)
  so user edits permanently win over machine rewrites.
- LLM cleanup is already gated on `event.isFinal`
  (`src/dictation/dictation-session-controller.ts:1224`).

So the work is: produce partial revisions in the sidecar, and harden/polish the
plugin path that consumes them (it has never run at partial-revision rates).

## Design decisions

### D1 — Native Rust adapter on the existing ONNX runtime

The Moonshine adapter is implemented in Rust against the existing
`OnnxRuntime` (`native/src/runtimes/onnx.rs`, `ort` crate), following the
`cohere_transcribe.rs` precedent (encoder session + autoregressive decoder
session + `tokenizer.json`, siblings resolved from the artifact's parent
directory).

We do **not** link the `moonshine-ai/moonshine` C++ core. Rationale: it embeds
its own ONNX Runtime (symbol/version clash with the `ort` crate), and it
duplicates layers we own (VAD, session state, event cadence). Its value to us
is as a *reference implementation* for streaming cadence and revision
semantics, not as a dependency.

**Phase 0 (pinning, timeboxed):** the exact ONNX asset layout for the
streaming models must be verified before implementation:

1. Prefer an existing ONNX export of `moonshine-streaming-*`
   (check `onnx-community/*` on Hugging Face).
2. Else export from the HF safetensors checkpoint
   (`MoonshineStreamingForConditionalGeneration` is in `transformers`) via a
   local script — the script may live in the repo under `scripts/` but the
   model files are never committed.
3. `.ort` flatbuffers from Moonshine's own CDN are acceptable if the `ort`
   crate loads them cleanly (ONNX Runtime supports the format; verify through
   `commit_from_file`).

Phase 0 output: a pinned model directory layout documented in this spec's
companion plan plus a note in `docs/guides/` describing how to download and
place the files for testing. Default test model: `moonshine-streaming-tiny`
(f32) on CPU; quantized variants are a bonus, not a requirement.

### D2 — Engine layer: a streaming session contract beside `LoadedModel`

Additive extension of `native/src/engine/` (batch trait untouched):

- `ModelFamilyId::Moonshine` (`"moonshine"`, display "Moonshine").
- `ModelFamilyCapabilities` gains `supports_streaming: bool`
  (serialized `supportsStreaming`; TS record in
  `src/models/model-management-types.ts` updated; existing families report
  `false`). Wire contract pinned by serialization tests on both sides, same as
  the existing capability fields.
- New trait (exact shape is the implementer's, contract is not):

  ```rust
  /// Incremental per-utterance decoding. One live utterance at a time.
  pub trait StreamingModel: Send {
      /// Feed the next chunk of 16 kHz mono PCM for the current utterance.
      fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError>;
      /// Best transcript of the audio fed so far for the current utterance.
      fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError>;
      /// Final transcript for the current utterance; resets for the next one.
      fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError>;
  }
  ```

- `ModelFamilyAdapter` gains a way to open a streaming session
  (e.g. `fn load_streaming(&self, path, gpu) -> Result<Box<dyn StreamingModel>, _>`,
  reachable only when `supports_streaming`). Whisper/Cohere adapters are not
  modified beyond the new capability field defaulting to `false`.

Moonshine capability values: `supports_initial_prompt: false` (no
context/glossary request is issued for streaming sessions),
`supports_language_selection: false`, `supported_languages: EnglishOnly`,
`produces_punctuation: true` (verify in Phase 0), segment timestamps per what
the decode actually yields (utterance granularity is acceptable for v1).

The adapter is compiled behind a cargo feature (`engine-moonshine`), enabled in
the default build set exactly like `engine-cohere-transcribe`.

### D3 — Utterance boundaries stay with VAD; streaming rides inside them

`ListeningSession` keeps owning utterance segmentation (Silero VAD, speaking
styles, timestamps, `pause_ms_before_utterance`, session states). The live
path changes *when audio reaches the worker*, not who cuts utterances:

- Batch (today): frames buffer in the session; the worker sees one finished
  clip per utterance.
- Streaming: speech frames are forwarded to the worker continuously while the
  utterance is open. On VAD close, the worker is told to finalize that
  utterance and the next utterance starts a fresh streaming state.

This preserves every downstream identity/formatting contract:
`utterance_id`/`utterance_index` allocation, start/end ms, smart-paragraph
pauses, and the journal keyed by utterance.

### D4 — Emission cadence, revisions, and backpressure

Worker behavior for a streaming session:

- Emit `TranscriptReady { is_final: false, revision: n }` for the open
  utterance at a bounded cadence: target every **~500 ms of wall time**, and
  only when the decoded text changed since the last emission. Revisions are
  strictly increasing within an utterance; the final revision is greater than
  every partial.
- **At most one decode in flight.** If decoding falls behind realtime, skip
  partial emissions (audio keeps accumulating; the next decode sees all of
  it). Partials are droppable by design; the final is not. The existing
  `TranscriptionQueueChanged` backpressure tiers remain the overload signal;
  queue overload semantics for finals are unchanged.
- On utterance close: run `finalize_utterance`, pass the result through the
  post-engine stage pipeline (hallucination filter — final revisions only,
  which is already the stage contract), and emit the final revision.
  **Partials bypass stages entirely** and must be marked accordingly in
  `stage_results` (engine stage outcome with `is_final: false`, which is
  exactly what `Transcript::is_final()` already reads).
- Session-level FIFO ordering: partials and finals for the same utterance are
  emitted in revision order; a new utterance's first partial never precedes
  the previous utterance's final on the wire.

No new protocol event types. The only schema change is the additive
`supportsStreaming` capability field.

### D5 — Plugin: render partials, replace in place, lock on final

The journal/session/surface machinery is reused; the gaps to close:

- **Provisional styling.** Text of an utterance whose latest revision is
  non-final renders with a provisional decoration (CSS class, e.g. reduced
  opacity — final look at implementer's judgment, must respect Obsidian
  themes). Implemented as a CodeMirror `StateField` mapped through document
  changes, following the `session-processing-extension.ts` precedent, driven
  by the session's projection state (`src/session/session.ts`). The decoration
  clears when the final revision lands, when the span latches, or when the
  session ends (whichever first — a session teardown with an utterance still
  provisional must not leave the decoration behind).
- **Latching under live revision.** If the user edits mid-utterance, the span
  latches (existing behavior) and every later partial *and* the final for that
  utterance are denied — verify this holds at partial-revision rates and that
  denial is silent (no error surface, journal still records revisions).
- **Empty final.** If the hallucination filter empties an utterance that
  already has projected partial text, the final must replace the projected
  text with the empty string (today `session.ts:326` early-returns on empty
  finals only for *unprojected* utterances — the projected case is new).
  Leftover boundary whitespace from the append must not accumulate.
- **LLM cleanup** stays final-gated (already true; pin with a test that feeds
  partials and asserts no cleanup runs until the final).
- **Timestamps** emit on the first partial of an utterance (utterance start is
  known then); no timestamp churn across revisions of the same utterance.
- **Cursor/scroll.** Anchor following and `scrollIntoView` already run per
  append/replace; verify the experience at ~2 Hz replacements (no selection
  yank when the user has clicked elsewhere — `replaceAnchor` does not move the
  caret today; keep it that way).

### D6 — Model selection and testing without the Model Explorer

Selection uses the existing `external_file` kind:
`{ kind: 'external_file', runtimeId: 'onnx_runtime', familyId: 'moonshine', filePath: <encoder path> }`.
Sibling files (decoder, `tokenizer.json`, any config) resolve from the parent
directory by fixed filename convention, mirroring `cohere_transcribe.rs`
(`probe_model` validates all siblings and loads the encoder to catch corrupt
bytes). If the settings UI's external-file picker enumerates families, add
Moonshine to that list — that is selection plumbing, not catalog work. Probing
a Moonshine selection on a sidecar built without `engine-moonshine` follows the
existing "runtime/family not compiled" probe failure path.

### D7 — Performance and quality bar (acceptance)

On a mid-range 4-core CPU with `moonshine-streaming-tiny`:

- First partial visible ≤ 1 s after speech onset.
- Partial refresh cadence ~2 Hz sustained without audio drops during a ≥ 5 min
  continuous session.
- Final for an utterance lands ≤ 700 ms after VAD close.
- Streamed-then-finalized text for a fixture clip matches the same model's
  one-shot batch decode of the full utterance (exact match expected since the
  final decodes the full utterance buffer; assert equality, downgrade to
  bounded WER only if Phase 0 reveals nondeterminism).
- CUDA via the existing ORT execution-provider path is a should-work,
  not a gate.

### D8 — Streaming-session feature interactions

- `diarizationEnabled` on a streaming session: ignored with a
  `RequestWarning` (existing dropped-field mechanism). V1 streaming sessions
  have no speaker attribution.
- No `context_request` is issued (no initial-prompt support).
- `one_sentence` listening mode: works unchanged — VAD still closes the
  sentence; the user simply sees it appear live before it completes.
- System audio: allowed; it's the same PCM stream.

## Verification

- **Rust:** unit tests for the adapter (tokenizer round-trip, graph I/O against
  a fixture or a mocked session where feasible); a streaming-simulation test
  that feeds a fixture WAV in 20 ms frames through the session+worker path and
  asserts revision monotonicity, cadence bounds, stage bypass for partials,
  and final==batch equality; protocol serialization tests for the new
  capability field (null/omission contract, matching existing test style).
- **TypeScript:** journal/session tests for partial→final, partial→latch→final
  denial, empty-final-after-projection, provisional decoration lifecycle
  (apply, map through edits, clear on final/latch/teardown), LLM final-gating.
- **Manual:** live session in Obsidian with a locally downloaded
  streaming-tiny; verify D7 targets, theme sanity of provisional styling, and
  behavior when typing while dictating.
- `npm test`, `npm run lint:obsidian`, Biome, `cargo test` + `cargo clippy`
  in `native/` all green.

## Risks and open questions

- **ONNX asset availability (Phase 0).** If no usable streaming-model export
  exists and local export proves unreliable, fallback is re-decoding the
  growing utterance buffer with batch Moonshine (v1-style graphs) at the same
  cadence — the UX contract and all plumbing above are unchanged; only the
  adapter internals differ (and compute grows with utterance length instead of
  staying bounded). Decide in Phase 0, before any protocol/plugin work is
  blocked.
- **Streaming encoder state vs. re-encode.** Whether the exported graphs
  expose incremental encoder state or require re-encoding the window is a
  Phase 0 finding; the `StreamingModel` trait hides it either way.
- **Revision-rate UX.** 2 Hz whole-utterance replacement may flicker; if so,
  prefer emitting only on stable-prefix growth (Moonshine's reference stack
  does similar). Cadence policy is worker-side and tunable without protocol
  change.
- **Long utterances.** The 30 s utterance hard cap (`MAX_UTTERANCE_FRAMES`)
  still applies and bounds streaming state; acceptable for v1.
