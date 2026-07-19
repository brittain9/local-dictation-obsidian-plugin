# Spec: Read Aloud with Pocket TTS

Status: approved; Phase 0 complete, Stage A implementation in progress
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
preference, exactly like the Moonshine spec's Phase 0. **Order of evaluation
(maintainer decision 2026-07-18): measure the candle route's binary cost first;
if it fits the budget it advances to functional validation.** It is selected
only if it also loads and synthesizes with the pinned D2 artifacts. The ONNX
route is the fallback if either gate fails.

1. **candle route (evaluate first).** The
   `pocket-tts` crate (v0.6.x, [babybirdprd/pocket-tts](https://github.com/babybirdprd/pocket-tts),
   MIT, third-party pure-Rust candle port advertising int8 support and full-pipeline
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
     `mimi_encoder` / `mimi_decoder`, plus `tokenizer.model` and
     `generate.py`, a generation CLI around the exported graphs. The
     repository does **not** publish a conversion script, so reproducibility
     of future exports remains a Stage B maintenance risk.

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

#### Phase 0 result — 2026-07-19

**Decision: use the pinned INT8 ONNX export on the sidecar's existing ORT
runtime.** The Candle port passed the size gate but failed functional
compatibility, so size alone did not decide the route.

Environment: Fedora Linux, Intel Core i5-12600K (10 cores / 16 logical CPUs),
Rust 1.94.1. The reproducible commands and complete measurements are in
[`scripts/pocket-tts-phase0/README.md`](../../scripts/pocket-tts-phase0/README.md).

| Candle size probe | stripped bytes | gzip -9 bytes |
|---|---:|---:|
| Baseline | 355,672 | 172,670 |
| With `pocket-tts` 0.6.2 | 7,144,720 | 2,568,140 |
| Delta | 6,789,048 | 2,395,470 (2.28 MiB) |

The compressed delta is 17.71 MiB below the 20 MiB gate. Functional loading
then failed against the pinned `english_2026-04` weights with a shape mismatch
at `mimi.downsample.conv.conv.weight` (crate expected `[512, 512, 32]`; artifact
contains `[32, 512, 32]`). The port hard-codes the older `b6369a24` shape, and
its `load_quantized*` functions load the ordinary model and return
`is_quantized() == false`. This makes the Candle route unusable for D2 despite
its excellent binary cost.

The repository's exact `ort = 2.0.0-rc.12` binding (resolving ORT 1.24.2)
loaded all five exported graph families at ONNX revision
`58a6d00cf13d239b6748cb0769f35c580a8f606c`. The pinned Python runner at that
revision supplied the full autoregressive correctness oracle; Python is not a
production dependency. Stage A loads only the four inference graphs needed by
precomputed voice states. `mimi_encoder.onnx` is excluded from runtime downloads
because it exists solely for out-of-scope voice cloning.

| Route / variant | CPU threads | audio | generation | RTF | real-time multiple |
|---|---:|---:|---:|---:|---:|
| ONNX INT8 English | 2 | 10.08 s | 3.260 s | 0.323 | 3.09x |
| ONNX INT8 English | ORT default | 10.08 s | 4.555 s | 0.452 | 2.21x |
| ONNX FP32 English | 2 | 10.32 s | 3.902 s | 0.378 | 2.65x |
| ONNX FP32 English | ORT default | 10.32 s | 8.043 s | 0.779 | 1.28x |
| ONNX INT8 French 24-layer | 2 | 9.60 s | 10.251 s | 1.068 | 0.94x |
| ONNX INT8 French 24-layer | ORT default | 9.60 s | 14.381 s | 1.498 | 0.67x |

The output contract is confirmed as **24-kHz mono float32** from the Mimi
decoder; protocol/WAV conversion is PCM16LE. The model exposes temperature,
flow-step, and EOS controls but **no speaking-rate control**. D7 therefore uses
sidecar-side pitch-preserving time stretch.

At temperature zero, ONNX fp32 matched Kyutai's Python waveform at correlation
0.999979, 43.84 dB SNR, and 0.000496 RMSE. The maintainer found no material
audible fp32-to-INT8 regression in the labeled comparison, so INT8 is selected;
the shipping Whisper round-trip test is the ongoing regression gate.

Artifact pins for all six D2 variants are generated in
[`scripts/pocket-tts-phase0/artifacts.json`](../../scripts/pocket-tts-phase0/artifacts.json):

| Variant | Runtime + all six curated voices |
|---|---:|
| `english_2026-04` | 162,974,582 bytes (155.42 MiB) |
| `french_24l` | 504,328,524 bytes (480.97 MiB) |
| `german_24l` | 504,328,191 bytes (480.96 MiB) |
| `spanish_24l` | 504,329,252 bytes (480.97 MiB) |
| `portuguese_24l` | 504,329,358 bytes (480.97 MiB) |
| `italian_24l` | 504,328,435 bytes (480.97 MiB) |

**Contradictions discovered:** `babybirdprd/pocket-tts` is a community port,
not first-party Kyutai code; `KevinAHM/pocket-tts-onnx/generate.py` does not
convert models; and the French 24-layer model is slower than real time at two
threads on this host. The five 24-layer catalog entries remain Stage B and must
not ship without smaller-variant benchmarking or an explicit hardware floor.

### D2 — Pinned model artifacts (ungated, CC-BY-4.0)

Voice-state source repo:
[`kyutai/pocket-tts-without-voice-cloning`](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning)
— verified ungated on 2026-07-18 (the main `kyutai/pocket-tts` repo is
auto-gated and is NOT used). Model graph source repo:
[`KevinAHM/pocket-tts-onnx`](https://huggingface.co/KevinAHM/pocket-tts-onnx),
using the immutable Phase 0 revision above. Kyutai weights are CC-BY-4.0:
attribution goes in `THIRD_PARTY_NOTICES.md` and the catalog entry's license
field.

Per-language voice-state layout (verified):
`languages/<variant>/embeddings/<voice>.safetensors` (~26 named voices per
language). ONNX bundle layout is `onnx/<variant>/`; exact files are generated in
the Phase 0 artifact manifest.

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

Each model entry's required artifact set is `bundle.json` +
`tokenizer.model` + `text_conditioner.onnx` +
`flow_lm_main_int8.onnx` + `flow_lm_flow_int8.onnx` +
`mimi_decoder_int8.onnx`. `mimi_encoder.onnx` is not installed. The curated
voice set is Alba (default), Cosette, Fantine, Javert, Jean, and Marius. The
initial English install includes the runtime and Alba (131,654,174 bytes,
125.56 MiB). `bos_before_voice.npy` is intentionally excluded: the native path
restores precomputed flow state directly and never conditions raw voice
embeddings. Manage Models offers the other five as individually installable
voice artifacts, and the voice picker lists installed voices. Voice states use
`ArtifactRole::Voice`; remaining voices outside this curated set are follow-up
artifacts (D4). Every artifact is pinned by size + SHA-256 and downloaded
through the existing verified installer.

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

Pocket TTS has no model-side speaking-rate control. Stage A applies
pitch-preserving time stretch to decoded PCM in the sidecar before PCM16LE
framing. The implementation is engine-agnostic and streaming-safe. Naive Web
Audio `playbackRate` is prohibited because it shifts pitch. The setting is
`ttsSpeed` (0.75–2.0, default 1.0).

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

## Phase 0 closures and Stage B follow-up

- Route: ONNX INT8; Candle is functionally incompatible (D1).
- Output: 24-kHz mono float32 decoder output, PCM16LE wire format (D1).
- Speed: no model-side control; sidecar pitch-preserving time stretch (D7).
- English voices: Alba (default), Cosette, Fantine, Javert, Jean, Marius
  (D2/D9).
- French `_24l` misses real time at two threads. Stage B must benchmark the
  smaller non-24-layer variants for all five deferred languages before adding
  catalog entries (D1/D2).
- Export maintainability: no conversion script is published with the pinned
  ONNX repository. Stage B must establish a reproducible exporter before
  updating Kyutai revisions.
