# Spec: Read Aloud with Pocket TTS

Status: draft for maintainer review (then handoff to Codex)
Issue: [#288](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/288)
Research: [`local-tts-landscape-2026.md`](local-tts-landscape-2026.md)

## Product goal

Select text or open a note, run "Read aloud," and hear a natural, local voice
within ~1 s — with pause/resume, stop, and speed control. Everything stays
on-device, in the languages the model supports (English, French, German,
Spanish, Portuguese, Italian). The voice quality bar is Pocket TTS as heard on
Kyutai's demo: clearly better prosody than OS/Web-Speech voices — that is the
reason this model was chosen over faster or broader alternatives.

Model: **Pocket TTS** (Kyutai) — 100M-parameter autoregressive codec-LM
(text → Mimi codec tokens → audio), CC-BY-4.0 weights, MIT reference code,
native chunked streaming (~200 ms to first audio), ~6× real-time on two
M4-class CPU cores. ([blog](https://kyutai.org/blog/2026-01-13-pocket-tts/),
[repo](https://github.com/kyutai-labs/pocket-tts))

## Explicitly out of scope (this feature branch)

- **Voice cloning.** The MVP uses pre-computed voice embeddings from the
  ungated weights repo. Cloning (which requires the gated `kyutai/pocket-tts`
  repo and the cloning encoder) is a follow-up.
- **Follow-along highlighting** of the sentence being read. The protocol
  carries the text ranges needed for it (D5); the UI work is deferred.
- **Export to audio file**, additional TTS model families (Supertonic is the
  planned 31-language breadth adapter later; see #288), GPU inference for TTS,
  sherpa-onnx, and any espeak-ng-dependent model.
- **Language auto-detection.** Each Pocket model is single-language; the
  selected TTS model determines the language (D9).
- Reading-view (preview mode) support. MVP reads from editor state; the
  selection/note text APIs work either way, but the MVP makes no promises
  about rendered-embed content.

## Why a new code path

The sidecar's dataflow is audio-in → text-out; every trait, protocol frame,
and catalog assumption points that direction:

- `stdout` carries JSON events only; binary audio frames exist only on
  `stdin` (`native/src/protocol.rs`: `JSON_FRAME_KIND 0x01`,
  `AUDIO_FRAME_KIND 0x02`).
- The engine traits (`native/src/engine/traits.rs`) model batch transcription
  (`LoadedModel::transcribe`) and streaming transcription (`StreamingModel`);
  nothing produces audio.
- The catalog (`native/src/catalog.rs`) keys entries by
  `(runtimeId, familyId, modelId)` with no task dimension — every entry is
  implicitly STT, and the plugin's single `selectedModel` slot
  (`src/settings/plugin-settings.ts`) assumes it.

TTS therefore adds: a task axis to the catalog, a synthesis trait beside the
transcription traits, a binary frame kind on stdout, and a plugin-side
playback path. Dictation behavior is untouched.

## Design decisions

### D1 — Phase 0 (pinning, timeboxed): runtime route and artifact contract

Two viable inference routes exist; the decision is made by measurement, not
preference, exactly like the Moonshine spec's Phase 0. **Order of
evaluation (maintainer decision 2026-07-18): measure the candle route's
binary cost first; it wins if it fits the size budget**, because it is the
lowest-correctness-risk path (first-party Kyutai code, no third-party graph
contract, no hand-rolled autoregressive loop). The ONNX route is the
fallback if candle exceeds the budget.

1. **candle route (evaluate first; wins if within budget).** The
   `pocket-tts` crate (v0.6.x, [babybirdprd/pocket-tts](https://github.com/babybirdprd/pocket-tts),
   MIT, pure-Rust candle port with int8 support and full-pipeline
   streaming). Verified API (2026-07-18):
   `TTSModel::load_from_bytes(config, weights, tokenizer)`,
   `model.get_voice_state_from_prompt_file(path)` (loads the D2 safetensors
   voice embeddings — no cloning encoder needed),
   `model.generate_stream_long(text, &voice)` → iterator of PCM tensors;
   quantized loading via `load_quantized_with_params_device`. Weights load
   directly from the pinned D2 safetensors.
   **Gate: the compressed CPU sidecar archive may grow by at most 20 MB.**
   Proxy measurement: a scratch bin crate with the sidecar's release profile
   (`lto = "thin"`, `codegen-units = 1`, `strip = "symbols"`), built with and
   without the `pocket-tts` dependency and real calls to the
   load → voice-state → streaming-generate path (so LTO cannot strip the
   inference code); compare stripped and gzipped binary sizes. Confirm on
   the real sidecar build before Stage A1 merges.
2. **ONNX route on the existing `ort` runtime (fallback — zero new native
   dependencies, but we own the autoregressive loop against a third-party
   graph contract).** Kyutai publishes no official ONNX export; credible
   conversions surveyed on 2026-07-18:
   - `csukuangfj2/sherpa-onnx-pocket-tts-2026-01-26` (+`-int8`): the
     sherpa-onnx conversion — `text_conditioner.onnx`, `lm_main.onnx`,
     `lm_flow.onnx`, `encoder.onnx`, `decoder.onnx`, `vocab.json`.
   - `KevinAHM/pocket-tts-onnx`: covers `english_2026-04` (the exact revision
     pinned in D2) with fp32 **and int8** variants of
     `text_conditioner` / `flow_lm_main` / `flow_lm_flow` /
     `mimi_encoder` / `mimi_decoder`, plus `tokenizer.model` and — decisive
     for maintenance — `generate.py`, the conversion script. We can re-run
     conversion ourselves for new Kyutai revisions and the non-English
     models rather than depending on a third party staying current.

   Five graphs with threaded autoregressive state is the same integration
   shape as the Moonshine adapter (five ORT graphs, persistent KV), so the
   token loop / state management is known-difficulty work, with Kyutai's
   Python/Rust reference code as the correctness oracle.

   Phase 0 validation for this route (only if candle fails the gate): load
   all five graphs under the pinned `ort` version; replicate the generation
   loop for one fixture sentence; byte-compare/audibly compare against
   Kyutai's reference output; verify (or produce via `generate.py`,
   committed under `scripts/`) exports for every D2 language; then pin
   sizes + SHA-256 of the chosen artifacts — which supersede the
   safetensors artifact table in D2 for whatever the catalog actually
   downloads. Prefer int8 variants if the round-trip gate (D10) passes with
   them; the CPU RTF benchmark decides.

Whichever route wins, Phase 0 must also:

- Verify output sample rate and format (expected: 24 kHz mono f32 from the
  Mimi decoder — confirm, do not assume).
- Verify whether the model exposes a generation-side speed control; record
  the answer in this spec (feeds D7).
- Produce one reference WAV per shipped language from the pinned weights and
  compare audibly + via STT round-trip against the same text synthesized by
  Kyutai's Python reference. Store the scripts under `scripts/`; never commit
  model files or audio.
- Benchmark real-time factor for the English model and one `_24l` model on
  the oldest x86 hardware available; record numbers in the companion plan.
- Pin exact artifact sizes + SHA-256 for every file in D2 via the HF
  `paths-info` API, recorded in the catalog entries.

### D2 — Pinned model artifacts (ungated, CC-BY-4.0)

Source repo: [`kyutai/pocket-tts-without-voice-cloning`](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning)
— verified ungated on 2026-07-18 (the main `kyutai/pocket-tts` repo is
auto-gated and is NOT used). License CC-BY-4.0: attribution goes in
`THIRD_PARTY_NOTICES.md` and the catalog entry's license field.

Per-language directory layout (verified):
`languages/<variant>/model.safetensors`, `languages/<variant>/tokenizer.model`,
`languages/<variant>/embeddings/<voice>.safetensors` (~26 named voices per
language).

Catalog models (one per language; `_24l` = the higher-quality 24-layer
variants Kyutai recommends for non-English):

| Catalog model | HF variant dir |
|---|---|
| Pocket TTS English | `english_2026-04` |
| Pocket TTS French | `french_24l` |
| Pocket TTS German | `german_24l` |
| Pocket TTS Spanish | `spanish_24l` |
| Pocket TTS Portuguese | `portuguese_24l` |
| Pocket TTS Italian | `italian_24l` |

Each model entry's artifact set: `model.safetensors` + `tokenizer.model` +
a **curated default set of 6 voice embeddings** (3 F / 3 M, chosen by ear in
Phase 0). Remaining voices are additive artifacts installable individually
(D4). Every artifact pinned by size + SHA-256, downloaded and verified through
the existing installer (`native/src/installer.rs`) unchanged.

Only "Pocket TTS English" ships in Stage A; the five other entries land in
Stage B once the round-trip CI (D10) covers them.

### D3 — Engine layer: a synthesis contract beside the transcription traits

Additive extension of `native/src/engine/` (existing traits untouched):

- Cargo feature `engine-pocket-tts`, following the existing per-engine
  feature pattern; the adapter file is `#![cfg]`-gated like the other gated
  adapters (see `docs/specs/*` and the cargo-test gating precedent).
- `ModelFamilyId::PocketTts` (`"pocket_tts"`, display "Pocket TTS").
- A new trait pair, mirroring the adapter/loaded split (exact shape is the
  implementer's; the contract is not):
  - `load_synthesis(&self, path, …) -> Box<dyn SynthesisModel>` on the family
    adapter (STT families return `unsupported`).
  - `SynthesisModel`: `begin(request) -> Result<…>` where the request carries
    the full ordered list of text chunks (each with its source char range),
    voice embedding path, and speed; `next_chunk() -> Option<PcmChunk>`
    yielding PCM + the source range it voices; `cancel()`. Synthesis runs on
    the existing worker thread; `catch_unwind` wraps it like transcription.
- `ModelFamilyCapabilities` gains task-relevant fields (serialized to TS like
  the existing ones, both sides' serialization tests updated):
  `task: "stt" | "tts"` (existing families report `"stt"`),
  `availableVoices`, `supportsSpeedControl`, `outputSampleRate`.

### D4 — Catalog and plugin model-management: the task axis

- `task` field on `ModelFamilyDescriptor` and `CatalogModel`
  (`native/src/catalog.rs`), serialized as `task`; validation requires model
  task == family task; existing entries are `stt`. Version-bump/compat rules
  follow whatever the catalog payload already does for additive fields.
- Voice embeddings are per-model **optional artifacts** with a new
  `ArtifactRole::Voice`; installing a voice later reuses `install_model` with
  the artifact subset (installer already handles multi-file sets).
- `probe_model_selection` / `model_probe_result.mergedCapabilities` become
  task-aware and report the TTS capability fields.
- Plugin (`src/models/`, `src/settings/`): Manage Models groups by task
  ("Dictation models" / "Read-aloud models"); settings gain
  `selectedTtsModel` + `selectedTtsModelCapabilitiesSnapshot` +
  `selectedTtsVoice` + `ttsSpeed`, all independent of the dictation
  selection. Guidance/recommended-default logic gets a TTS variant
  (`model-guidance.ts`).

### D5 — Protocol: synthesis session and a stdout binary frame

Commands (TS → Rust):

- `start_synthesis { synthesisId, model selection, voiceId, speed, chunks: [{ text, sourceRange }] }`
  — the plugin sends fully extracted, segmented text (D6); the sidecar never
  sees markdown.
- `cancel_synthesis { synthesisId }` — immediate; discard queued chunks.
- `synthesis_playback_position { synthesisId, playedThroughSeq }` — flow
  control: the sidecar synthesizes at most **30 s of audio ahead** of the
  last played chunk, so pausing a 40-minute note doesn't burn CPU
  synthesizing the whole document.

Events (Rust → TS):

- `synthesis_started { synthesisId, sampleRate }`
- Binary frame kind `0x03` on stdout: header `u32 synthesisId, u32 seq`
  (LE) + PCM16LE mono payload. (JSON-with-base64 rejected: ~33% overhead and
  it breaks the existing "one frame kind per payload type" symmetry.)
- `synthesis_chunk_meta { synthesisId, seq, sourceRange, durationMs }` — the
  JSON twin of each binary frame, carrying what the UI needs for progress and
  (later) follow-along highlighting.
- `synthesis_complete { synthesisId }` / `synthesis_error { synthesisId, … }`

`FramedMessageParser` (TS) and the Rust writer gain the new kind; both sides'
framing tests extend. One synthesis session at a time (a second
`start_synthesis` cancels the first).

### D6 — Plugin: text extraction, segmentation, playback

- **Extraction** (`src/tts/`, new): markdown → speakable text with a
  char-range map back to the source. Rules: drop frontmatter, headings speak
  their text, links/embeds speak display text, code blocks and math are
  skipped entirely (MVP), tables read cell text row-wise, list markers and
  formatting syntax stripped. Every emitted sentence carries its source
  range.
- **Segmentation**: `Intl.Segmenter` sentence granularity (available in
  Obsidian's Electron), merged to a minimum chunk length (~1–2 sentences) so
  the model gets enough context for prosody.
- **Playback**: Web Audio, feeding received PCM into a scheduled
  `AudioBufferSourceNode` queue at the reported sample rate. Pause/resume =
  suspend/resume of scheduling (positions tracked per chunk); stop cancels
  the sidecar session. The playback engine lives beside the capture code in
  `src/audio/` and never touches the capture path.
- **Speed** (D7 decides mechanism) is applied uniformly; changing it
  mid-session restarts synthesis from the current sentence (acceptable MVP
  behavior, documented in the UI).

### D7 — Speed control mechanism (finalized by Phase 0)

Preference order:

1. Model-side speed control, if Phase 0 finds Pocket exposes one.
2. Synthesis-side time-stretch in the sidecar (e.g. a WSOLA/`soundtouch`-style
   pass on the PCM before framing) — pitch-preserving, engine-agnostic.
3. Plugin-side `playbackRate` **only if** pitch-preserving playback is
   achievable in Electron for our streaming path; naive `playbackRate` on
   Web Audio shifts pitch and is not acceptable beyond ±10%.

Whichever lands, the setting is `ttsSpeed` (0.75–2.0, default 1.0).

### D8 — Read scopes, commands, and dictation interlock

Commands (`src/commands/register-commands.ts` pattern):

- **Read aloud** — reads the selection if one exists, else from the cursor's
  block to the end of the note. (Covers "selection," "note," and
  "from cursor" with one predictable command; a separate explicit
  **Read entire note** command reads from the top.)
- **Pause / resume reading** (one toggle command), **Stop reading**.
- Editor context menu gets "Read aloud" when there's a selection.
- No ribbon presence in MVP; the dictation ribbon and its state machine are
  untouched. Status bar shows a small "reading… ⏸/⏹" widget while active.
- **Interlock**: starting read-aloud while a dictation session is listening
  stops the dictation session first (graceful stop, transcripts drain), and
  starting dictation stops read-aloud. No simultaneous operation — this also
  prevents TTS audio from feeding the mic/system-audio capture path.

### D9 — Language and voice selection

The selected TTS model *is* the language (one catalog entry per language,
D2). The voice picker (settings + a submenu on the status-bar widget) lists
installed voice artifacts for the selected model. Default voice per language
is pinned in the catalog entry (chosen in Phase 0). No auto-detection, no
per-note language overrides in MVP; a mixed-language note reads in the
selected model's language, exactly like a mismatched dictation model does
today.

### D10 — Testing and verification

- **Unit (plugin)**: extraction rules (frontmatter/code/links/tables with
  range-map assertions), segmentation merging, framing parser round-trip for
  frame kind `0x03`, settings migration defaults.
- **Unit (sidecar)**: catalog task-axis validation, capability gating
  (`start_synthesis` against an STT selection → typed error), protocol
  serialization both sides, flow-control window arithmetic.
- **Integration (sidecar, gated like other engine tests)**: load pinned
  English model, synthesize a fixture paragraph, assert chunk sequence
  monotonicity, range coverage, and non-silent PCM.
- **Round-trip quality gate (CI, per shipped language)**: synthesize a fixed
  multilingual fixture text → transcribe with the repo's own Whisper path →
  assert WER under a per-language threshold. Catches gross regressions
  (wrong tokenizer, broken voice embedding, garbage audio) cheaply. Wire into
  `sidecar-e2e.yml` beside the existing multilingual quality job — do not
  duplicate it (see #279).
- **Manual acceptance** (`docs/guides/pocket-tts-testing.md`, written with
  Stage A): install via Manage Models, read a real mixed-markdown note,
  pause/resume/stop/speed, dictation interlock both directions, kill-sidecar
  recovery mid-read.

## Staged delegation plan (Codex)

Each stage is one reviewable PR against the feature worktree; no stage merges
without review (diff any test Codex modifies against main first).

- **Stage 0 — Phase 0 experiment** (D1): runtime route decision + pinned
  artifact table + reference WAVs + RTF numbers. Output is a report and spec
  amendment, minimal committed code (`scripts/` only).
- **Stage A1 — sidecar**: task axis (D3, D4 native side), protocol (D5),
  Pocket adapter behind `engine-pocket-tts`, integration tests.
- **Stage A2 — plugin**: catalog/settings/Manage Models task awareness (D4
  plugin side), extraction + segmentation + playback (D6), commands +
  interlock (D8), status-bar widget, unit tests.
- **Stage A3 — quality + polish**: speed mechanism (D7), round-trip CI gate
  for English (D10), manual acceptance guide, release-notes entry.
- **Stage B (separate spec amendment)**: the five non-English catalog
  entries + per-language CI thresholds, voice-picker polish, additional
  voices, then the deferred ladder from #288 (highlighting, cloning, export,
  Supertonic breadth adapter).

## Open items pinned to Phase 0

- candle vs ONNX route (25 MB budget gate) — D1.
- Output sample rate/format confirmation — D1.
- Model-side speed control existence — D7.
- Curated 6-voice default set + per-language default voice — D2/D9.
- Whether the `_24l` variants meet real-time on baseline x86 — D1 (if not,
  the non-`_24l` variants exist for de/es/pt/it and become the fallback
  catalog choice, quality permitting).
