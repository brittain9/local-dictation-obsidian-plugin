# First-class local text translation

## Status and scope

Specification only. Nothing in this document is implemented; no catalog,
dependency, protocol, or release change ships with it. Research was performed
on 2026-07-27 against the repository head at that date and the pinned upstream
revisions recorded below. Any prior discussion of translation architecture is
superseded by this document, which was verified against the current head.

Owner decisions recorded 2026-07-27, after the first review of this document:

- Gemma Terms of Use accepted, including the use-restriction passthrough and
  the required notice. Documented obligations must ship with the feature.
- A ~3 GB managed download is accepted for this feature.
- UX specifics are delegated to the implementer's judgment, with the required
  shape being commands that translate a selection and a whole note, and with
  the text-preservation guarantees below treated as non-negotiable.
- `Translate last utterance…` and dictate→translate chaining remain later
  waves, not v1.

Scope: general local text-to-text translation of note text — final dictation
transcripts, selected note text, and (later) larger structures — for the eight
product languages. Whisper's built-in speech-to-English translation mode is
explicitly out of scope as a product answer: it is English-target-only,
audio-input-only, and cannot translate existing note text.

The local/private path is the product default: translation inference happens
on the user's machine, there is no cloud translation provider and no silent
cloud fallback, and the network is used only for explicit, managed model
installation. The optional Ollama/OpenRouter transformation feature remains a
separate, disableable path and is not required for translation.

## Product loop and user stories

Target loop:

audio or speech → local transcription → optional LLM cleanup → optional local
translation → optional local read aloud.

Translation also applies to text that never came from speech.

User stories for v1:

1. After dictating a note in Spanish, I select the transcript and translate it
   to English without any text leaving my machine.
2. I select a paragraph a colleague wrote in German and read it in French,
   previewing the translation before deciding whether it replaces the source
   or lands below it.
3. I translate a whole note into another language from one command, without
   selecting anything.
4. I translate a section to Japanese and then use Read aloud with a Japanese
   voice to hear it.
5. If the translation model is not installed, the feature tells me exactly
   what to install and takes me to Manage Models; it never falls back to a
   cloud service.

## Non-goals

- No cloud translation provider, no hybrid routing, no silent fallback.
- No automatic translation of anything. Translation runs only from an explicit
  user command; no setting causes content to be translated as a side effect
  of dictation, cleanup, or read aloud in v1.
- No whole-vault or multi-note translation.
- No automatic source-language detection in v1 (explicit decision below).
- No translation glossary/do-not-translate term list in v1.
- No new ribbon icon.
- No regional-dialect targets (`pt-BR` vs `pt-PT`); base tags only, matching
  the dictation language policy in
  [multilingual-support.md](multilingual-support.md).
- No claim of quality for language directions that have not passed the
  verification gates, regardless of what the upstream model card lists.

## Current architecture and reusable seams

Verified against the current head:

- `native/src/engine/capabilities.rs` defines `ModelTask { Stt, Tts }`,
  `ModelFamilyId`, `LanguageSupport`, and per-family capability structs that
  serialize into the TypeScript `ModelFamilyCapabilitiesRecord`
  (`src/models/model-management-types.ts`). Task is part of both the catalog
  and capability wire contracts, so a third task variant is an additive,
  mechanical extension.
- `native/src/catalog.rs` + `native/catalog.json` pin every managed artifact
  (https URL, SHA-256, size) and validate `languageTags` against
  `VERIFIED_MULTILINGUAL_LANGUAGE_TAGS` (`en es de fr pt it nl ja`). Catalog
  validation already enforces a required primary artifact per task
  (`transcription_model` / `synthesis_model`), which extends naturally to a
  `translation_model` role.
- `native/src/engine/registry.rs` registers feature-gated (runtime, family)
  adapter pairs; `merged_capabilities` composes runtime and family caps for
  the wire. A translation family adapter slots in without registry changes.
- `native/src/synthesis_worker.rs` is the on-demand lifecycle template:
  dedicated worker thread, model loaded on first request, cached with a 90 s
  idle TTL, dropped afterwards so a dictation session can claim the memory.
  Translation copies this lifecycle rather than inventing one.
- The synthesis protocol (`start_synthesis` with `SynthesisTextChunk[]`,
  per-chunk events, `cancel_synthesis`, `synthesis_error` with a machine code)
  in `src/sidecar/protocol.ts` / `native/src/protocol.rs` is the wire-contract
  template for a chunked, cancellable text operation.
- `native/src/adapters/moonshine.rs` already runs an autoregressive ONNX decoder
  with cached KV state inside `ort`, and the Nemotron adapter runs a stateful
  RNNT decode loop. A decoder-only generation loop is established competence
  in this codebase, not new ground.
- `src/tts/read-aloud-controller.ts` shows the TypeScript controller shape
  for a sidecar-backed text operation (id allocation, event filtering, stale
  cancellation), and `register-commands.ts` shows the command-palette-first
  UX with no ribbon icon.
- LLM cleanup (`src/llm/router.ts`) is a separate optional path whose
  built-in prompts explicitly forbid implicit translation; translation must
  not be routed through it.
- Known limitation to inherit: ONNX Runtime retains ~380–400 MB after a model
  is dropped ([#323](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/323)).
  The translation worker's "release after operation" promise is bounded by
  the same behavior.

Open work checked for overlap on 2026-07-27: no open or closed issue or PR
proposes text translation. Adjacent work that must stay compatible:
[#324](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/324)
(read-aloud language selection), PR #287 (LLM provider routing spec), PR #302
(release decoupling). None conflicts with this design.

## Model/runtime candidate comparison

Research date 2026-07-27. Sizes from upstream repositories; throughput and
memory figures are estimates from published community benchmarks unless
marked measured — no local feasibility probe has been run yet (see Blockers).

| Candidate | Revision | Params / v1 artifact | License | 8 product languages | Runtime fit |
| --- | --- | --- | --- | --- | --- |
| **TranslateGemma 4B** (`google/translategemma-4b-it`, 2026-01-15) | `10042cb0e6e7fdce748996a71dc3dc432a4e0c89` | ~4B (Gemma 3); int4 ONNX 2.71 GB (`q4f16`) or 3.09 GB (`q4`), + 20 MB tokenizer | Gemma Terms of Use (commercial use and redistribution permitted with use-restriction passthrough) | Yes — evaluated on WMT24++, whose 55 configs include `de_DE es_MX fr_FR it_IT ja_JP nl_NL pt_BR pt_PT` | Decoder-only Gemma 3. A text-only ONNX export already exists and is **not** gated: `onnx-community/translategemma-text-4b-it-ONNX` @ `f7874a1ac60758872a4f78aac0df95b17b776994` (2026-02-14), the same publisher the shipped Cohere Transcribe entries already pin |
| **Seed-X-PPO-7B** (ByteDance) | `6ef78fc034ec86c0036d7a7ca2bfc24607f48050` | 7B Mistral; int4 ≈ 4.5 GB | OpenMDW (same family as the shipped Nemotron license) | Yes — 28 languages including all eight | Official quants are GPTQ-Int8/AWQ-Int4 (GPU-oriented); upstream recommends vLLM + beam search and warns against unofficial quantizations; no ONNX export; 7B decode on CPU is roughly 2× the cost of 4B |
| **Hunyuan-MT-7B** (Tencent, WMT25 winner in 30/31 pairs) | `9305c78383f0bcc94358e08667ee2c76107877e3` | 7B | Tencent Hunyuan community license — Territory **excludes the EU, UK, and South Korea** | Yes (33 languages) | Disqualified on license alone; the plugin is distributed worldwide |
| **MADLAD-400-3B-MT** (Google, 2023) | `fa184c675da0b5c9e1c8694fccd4e12e2d422094` | 3B T5 encoder-decoder; int8 ≈ 3 GB | Apache-2.0 | Yes (400+ languages) | Community ONNX exports exist; quality is a 2023 baseline clearly below the 2025/26 systems above; known short-input hallucination reports; upstream effectively unmaintained |
| **NLLB-200-distilled-600M** (Meta) | `f8d333a098d19b4fd9a8b18f94170487ad3f821d` | 600M encoder-decoder; int8 ≈ 0.6 GB | **CC-BY-NC-4.0** | Yes (200 languages) | Best size/quality ratio of the small dedicated MT models, but the non-commercial license disqualifies it for this product |
| **Opus-MT per-pair Marian** (Helsinki-NLP, e.g. `opus-mt-en-de` @ `6183067f`) | per model | ~300 MB per direction | CC-BY-4.0 / Apache-2.0 | Partial — strong European pairs; `en↔ja` artifacts are weak or trained on narrow corpora | Small and CPU-fast, but 14 separate per-direction artifacts, uneven quality, and a second graph/tokenizer family to verify per pair |

Also reviewed and set aside: EuroLLM-1.7B/9B (Apache-2.0, covers the eight
languages, but MT quality evidence is thinner than TranslateGemma at similar
CPU cost), LFM2-350M-ENJP (single pair), SMaLL-100 (non-commercial), and
general-purpose LLMs via Ollama (already available as the separate cleanup
path; not a managed first-class local feature).

### Runtime comparison

- **ONNX Runtime (existing native path, recommended).** Zero new native
  dependencies, existing accelerator probe/policy, existing install and
  verification machinery, existing adapter patterns for autoregressive
  decoding. A published text-only int4 export already exists at
  `onnx-community/translategemma-text-4b-it-ONNX`, so no in-house export and
  no self-hosting is required; the catalog pins that repository at a fixed
  revision with per-file SHA-256, exactly as the Cohere Transcribe entries
  already do. Decode throughput for a 4B int4 decoder under `ort` on CPU is
  the main open measurement.
- **llama.cpp (GGUF).** Best-in-class CPU decode and ready-made community
  GGUFs, but a new C++ runtime dependency, a second copy of the ggml stack
  next to whisper.cpp, new packaging/CI surface on three platforms, and a new
  accelerator policy. Held as the named contingency if the T0 ONNX gates
  fail, not the default.
- **Bundled Python runtime (CTranslate2/transformers).** Rejected. Python
  cannot be assumed on user systems; bundling one adds hundreds of MB per
  platform, a large security/update surface, slower cold start, and a
  permanent release burden. No candidate's advantage justifies it — the
  strongest license-clean model runs without it.
- **CTranslate2 as a native library.** Viable engine for the encoder-decoder
  candidates (NLLB/MADLAD/Opus-MT), but those candidates lost on license or
  quality, and it would still be a new native dependency plus a new adapter
  family. Rejected with its candidates.

## Recommended model and rationale

**TranslateGemma 4B, int4-quantized text-only ONNX export, on the existing
ONNX Runtime path.**

- It is the strongest current openly downloadable translation model that
  plausibly fits a 16 GiB CPU-only machine: Google reports WMT24++ MetricX
  5.32 / COMET 81.6 for the 4B, rivaling its own 12B Gemma 3 baseline. The
  clearly stronger 7B systems either exclude major markets by license
  (Hunyuan-MT) or roughly double CPU latency and memory for a quality gain
  the product cannot absorb (Seed-X).
- All eight product languages are inside its evaluated 55-language set, with
  per-language WMT24++ evidence rather than family marketing copy.
- The download lands between the two largest models the catalog already
  ships: 2.71 GB (`q4f16`) or 3.09 GB (`q4`) against `cohere_transcribe_q4`
  at 2.13 GB and `cohere_transcribe_fp16` at 4.13 GB. Large, but the largest
  managed download in the product is already in this class, and the owner has
  accepted the size.
- A text-only int4 ONNX export is already published, and the codebase already
  implements cached autoregressive ONNX decoding.
- The 2K-token input context matches the chunked design below; translation is
  a per-paragraph operation, not a long-context one.

**No smaller fallback model for v1.** Every candidate small enough to matter
either fails licensing (NLLB, SMaLL-100) or would introduce a second model
family and a per-direction verification matrix (Opus-MT) for quality below
the product bar in `en↔ja`. Low-spec machines get the same model, slower,
with honest progress UI and cancellation. Revisit only if T0 measurements
fail the minimum envelope.

**Hardware envelope (estimates; T0 must measure).** Minimum: 8 GiB RAM,
x86-64 with AVX2 or Apple silicon; peak translation RSS target < 4.5 GiB;
throughput floor ≥ 3 output tok/s. Recommended: 16 GiB, ≥ 8 performance
cores, ≈ 8–20 tok/s expected on 2020+ x86 CPUs and ≈ 25–45 tok/s on Apple
silicon. If measured throughput on the development machine falls below the
floor, the implementer does not switch runtimes unilaterally: record the
measurement, ship the feature behind its existing opt-in install gate with
honest progress and cancellation, and raise llama.cpp as a follow-up with the
numbers attached. Quantization choice (`q4` vs `q4f16`) is a T0 measurement,
not a preset — `q4f16` is 0.38 GB smaller but fp16 compute is frequently
emulated and slower on CPU execution providers.

## Language and direction policy

- The translation language set equals the verified product set: `en es de fr
  pt it nl ja`, base tags only.
- **v1 ships the 14 English-anchored ordered directions** (`en→xx`, `xx→en`
  for the seven non-English languages). Direct non-English pairs (`es→de`)
  are technically possible with this model but ship only in a later wave
  with their own fixture and review evidence. They are refused with a clear
  message in v1, never silently pivoted through English. This deliberately
  trades early breadth for honest claims.
- Each direction is individually declared in catalog metadata (below); the UI
  derives eligibility from the exact installed model, mirroring the
  model-level eligibility invariant of multilingual dictation.
- **Source language is explicit in v1; no `auto`.** The model's prompt
  contract requires a source language code, and shipping a separate detector
  is new unverified surface. Defaults make this cheap: the modal pre-selects
  the dictation language (when not `auto`) or the last-used source. Automatic
  detection is a named future wave.
- Same-language requests (source = target) are rejected before inference with
  an actionable message.
- Mixed-language and code-switched input carries no quality guarantee; the
  declared source language wins. This matches the dictation policy.

## UX and text-preservation behavior

Smallest coherent v1: two commands, one modal, no ribbon icon, no toggle.
Explicitness comes from the commands themselves — nothing translates unless
the user invokes translation, so no arm/disarm setting is needed.

- **Commands.** `Translate selection…` (editor command; also offered in the
  selection context menu like Read aloud) and `Translate note…` (whole active
  note, subject to the same size cap). Both open the translation modal.
  `Translate last utterance…` is a later wave, once the core is proven.
- **Modal.** Header: source and target language dropdowns (source defaults
  as above; target persists as `translationTargetLanguage`), swap button.
  Body: source excerpt and a translation pane that fills chunk-by-chunk as
  results stream in, with per-chunk progress and a Cancel button. Footer
  (enabled on completion): **Replace selection** (primary), **Insert below**,
  **Copy**. Esc or Cancel discards everything.
- **Preview-first is the v1 decision**: translated text never touches the
  note until the user accepts it in the preview. A power-user "replace
  without preview" variant is deliberately deferred.
- **Atomic insertion.** Replace/insert happens as a single editor
  transaction. The controller captures the selection range and a hash of its
  text at start; if the note changed during translation, Replace is disabled
  and Insert below / Copy remain. A failed or cancelled translation changes
  nothing. Partial output is never written to the note.
- **Missing model recovery.** If no translation model is installed (or the
  selected one fails its probe), the modal explains and offers "Open Manage
  Models" pre-filtered to the Translation collection — same recovery shape
  as Read aloud. Setup wizard is unchanged; translation is a post-setup,
  opt-in install.
- **Composition.** Cleanup-then-translate is the natural order (translation
  acts on whatever text is selected, including cleaned-up text). Read aloud
  composes downstream: accepted translations are ordinary note text.
  Automatic chaining (dictate → clean → translate → speak in one gesture) is
  explicitly future work.

### Markdown and text semantics

A TypeScript segmentation pass splits the selection into *translatable* and
*protected* spans before chunking. Protected spans are reassembled verbatim,
byte-for-byte:

- fenced code blocks, inline code, and math;
- YAML frontmatter (if the selection intersects it, frontmatter lines pass
  through unchanged);
- URLs, Markdown link destinations (`[label](url)` translates the label
  only), footnote ids, and raw HTML tags;
- wikilinks and embeds (`[[target]]`, `[[target|alias]]`, `![[…]]`) pass
  through entirely in v1 — translating aliases risks breaking meaning for no
  clear gain; revisit with evidence;
- Obsidian tags (`#tag`) and callout type markers (`> [!note]`) — callout
  body text is translated;
- heading markers, list bullets/numbers, checkbox states, blockquote
  markers, and table pipes are structure, not text: the text inside is
  translated, the markers and column counts are preserved;
- whitespace policy: paragraph breaks, leading indentation, and trailing
  newline presence are preserved exactly; intra-paragraph line wrapping may
  be renormalized by translation.

Chunking is paragraph-aligned and token-aware: paragraphs are packed into
chunks under a budget calibrated to the model's 2K-token input context
(input budget ≈ 800 tokens per chunk, leaving room for the prompt scaffold
and output). A paragraph exceeding the budget alone splits at sentence
boundaries. Chunks carry source ranges (the `SynthesisTextChunk` pattern) so
the preview can map output to input. Hard cap for v1: 50,000 source
characters per operation, with a confirmation warning above 10,000.

Proper nouns and do-not-translate terms rely on model behavior in v1; a
glossary is future work. Unsupported pairs, uninstalled models, and
same-language requests fail before inference with specific messages.

## Proposed data flow and contracts

The narrow TypeScript/Rust boundary is preserved: TypeScript owns Markdown
semantics, segmentation, chunking, preview, and insertion; Rust owns model
lifecycle and inference on plain text chunks. The sidecar never sees Markdown
structure, only translatable text.

### Rust-side types (additive)

- `ModelTask::Translation` (wire: `"translation"`).
- `ModelFamilyId::TranslateGemma` (wire: `"translate_gemma"`), registered on
  `RuntimeId::OnnxRuntime` behind an `engine-translate-gemma` feature.
- `ArtifactRole::TranslationModel`; catalog validation requires one required
  translation artifact for translation-task models, mirroring STT/TTS.
- Catalog model metadata gains an optional `translationPairs` field:
  `[{ "source": "en", "target": "de" }, …]` — exactly the verified ordered
  directions, validated against `VERIFIED_MULTILINGUAL_LANGUAGE_TAGS`,
  non-empty and duplicate-free for translation-task models, forbidden
  otherwise. `languageTags` stays the flat display set.
- `ModelFamilyCapabilities` gains `translationPairs: Vec<LanguagePair>`
  (empty for non-translation families), serialized like every other family
  capability so `ModelProbeResultRecord.mergedCapabilities` carries it to the
  plugin.

### Wire contract (JSON frames, existing framing)

Commands:

```
start_translation {
  translationId: number,
  modelSelection: SelectedModel,
  modelStorePathOverride?: string,
  sourceLanguage: string,   // base tag, never "auto" in v1
  targetLanguage: string,
  chunks: [{ seq: number, text: string }]
}
cancel_translation { translationId: number }
```

Events:

```
translation_started  { translationId, totalChunks }
translation_chunk    { translationId, seq, text }
translation_complete { translationId }
translation_error    { translationId, code, message, details? }
```

Error codes (machine-readable, stable): `model_missing`, `model_invalid`,
`unsupported_language_pair`, `chunk_too_long`, `inference_failed`,
`cancelled`. Chunk results stream in order; `translation_complete` follows
the final chunk; after `cancel_translation`, the worker stops decoding at the
next token-batch boundary and emits `translation_error` with `cancelled`.
Per-chunk events double as progress; no separate progress event is needed.

### Sidecar internals

A `translation_worker.rs` mirroring `synthesis_worker.rs`: one worker thread,
commands over a channel, model loaded on demand via the adapter, cached with
the same 90 s idle TTL, dropped afterwards. One translation at a time; a new
`start_translation` while one is active is refused (`inference_failed` with
details) — the UI serializes operations anyway. The adapter renders the
model's chat-template prompt for (source, target, text), runs greedy or
small-beam decoding with cached KV state, strips the scaffold, and returns
plain text. Requests validate language pairs against the resolved model's
`translationPairs` before loading weights.

### TypeScript side

- `TranslationController` (shape of `ReadAloudController`): id allocation,
  event filtering, stale-cancel handling, lifecycle around the modal.
- `src/translation/markdown-segmentation.ts` and `chunking.ts` as pure,
  fixture-tested modules.
- Settings (defaults; no migration machinery, per repo convention):
  `selectedTranslationModel: SelectedModel | null` (default `null`),
  `selectedTranslationModelCapabilitiesSnapshot` (same pattern as TTS),
  `translationTargetLanguage: string | null` (default `null`),
  `translationSourceLanguage: string | null` (last-used override, default
  `null`). With defaults untouched, translation is invisible dormant surface.
- `model-management-types.ts` extends `ModelTask`, family ids, capability
  and catalog records with the fields above; Manage Models renders a new
  "Translation" collection with the existing install/remove/progress UI.

## Model lifecycle and resource policy

- Load on first chunk of an operation; keep loaded across chunks; idle-evict
  90 s after the last operation (constant shared conceptually with the
  synthesis worker; tests inject shorter TTLs).
- Accelerator policy: CPU is the v1 execution provider. GPU execution for a
  4B int4 decoder is not enabled until evaluated under
  [#328](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/328);
  the request contract carries no acceleration field in v1 so nothing is
  silently dropped.
- Memory honesty: "release after the operation" is bounded by the known ONNX
  Runtime retention (#323, ~380–400 MB). The spec inherits, not fixes, that
  behavior; the perf gate measures release-after-eviction explicitly.
- Translation never preempts an active dictation session's model; the worker
  is independent, and users on minimum hardware are warned in docs that
  concurrent dictation + translation is not a supported envelope.

## Error, cancellation, and recovery behavior

- Every failure mode surfaces a specific, actionable message keyed by the
  machine code above; none writes to the note.
- Cancel is always available in the modal; target latency from click to
  worker stop < 500 ms (gate). Cancellation preserves the source text and
  the partial preview (copyable), and the sidecar returns to idle.
- Sidecar crash mid-translation: the controller times out, surfaces the
  standard sidecar-restart recovery, and the note is untouched because
  nothing is inserted before acceptance.
- Model removed while selected: next operation fails with `model_missing`
  and the Manage Models recovery path, mirroring TTS behavior.

## Privacy, licensing, and artifact provenance

- Text never leaves the machine for translation. No telemetry, no cloud
  path, no network use outside explicit installs. The privacy section of the
  README gains one line only when the feature ships.
- **License:** Gemma Terms of Use. Commercial use is permitted; distribution
  requires passing through the use restrictions (Gemma Prohibited Use
  Policy) and the notice "Gemma is provided under and subject to the Gemma
  Terms of Use found at ai.google.dev/gemma/terms". The product already
  ships a use-restriction license (Supertonic, OpenRAIL-M) and shows model
  licenses before download; TranslateGemma follows the same flow. The
  obligations that must actually ship: the catalog entry carries the Gemma
  Terms label and URL and a note that installing accepts them, a
  THIRD_PARTY_NOTICES entry records the terms and the derivative status of
  the ONNX export, and the notice "Gemma is provided under and subject to the
  Gemma Terms of Use found at ai.google.dev/gemma/terms" appears in
  THIRD_PARTY_NOTICES and in the README's model documentation.
- **Provenance:** upstream `google/translategemma-4b-it`
  (`10042cb0e6e7fdce748996a71dc3dc432a4e0c89`) is gated, but the text-only
  int4 ONNX derivative is published ungated by the same organization the
  catalog already trusts for Cohere Transcribe:
  `onnx-community/translategemma-text-4b-it-ONNX` @
  `f7874a1ac60758872a4f78aac0df95b17b776994`. Catalog artifacts pin that
  revision in the download URL and carry per-file SHA-256 and sizes, matching
  the existing entries. The repository also ships `chat_template.jinja`
  (16,982 bytes) and `tokenizer.json` (20,323,013 bytes), which resolves the
  prompt-contract question that could not be pinned before. No project-owned
  artifact repository is needed.

## Staged delivery

- **T0 — feasibility spike (blocks everything).** Outside the production
  tree: download the pinned `q4` and `q4f16` artifacts, verify SHA-256, load
  each under `ort` on the CPU execution provider, render the prompt from
  `chat_template.jinja`, and translate a fixed fixture set across several
  directions. Measure cold load, peak RSS, and decode throughput; confirm
  output is real translation and not degenerate repetition. Record which
  quantization wins and the exact tensor I/O contract. Discard the spike code
  once its findings are written down.
- **T1 — core feature.** Protocol + worker + adapter + catalog entry +
  capability plumbing + Manage Models collection + `Translate selection…`
  and `Translate note…` with the modal, segmentation, chunking, and atomic
  insertion. All 14 directions wired; each direction's *claim* gated by T3
  evidence.
- **T2 — polish.** Context-menu entry, docs, README language table row,
  settings surface.
- **T3 — quality certification.** Fixtures, weekly real-model workflow runs,
  bilingual review, and only then per-direction claims in product copy.
- **Future waves (explicitly not v1):** `Translate last utterance…` and
  dictate→translate chaining, automatic source detection, direct non-English
  pairs, glossary/do-not-translate, GPU execution per #328.

## Test and release-readiness gates

Fast CI (no real model):

- Unit: segmentation fixtures for headings, lists, tables, callouts, code
  fences/inline code, math, frontmatter, links/wikilinks/embeds/tags,
  whitespace preservation; chunker budget/boundary tests; same-language and
  unsupported-pair rejection; settings normalization defaults.
- Protocol round-trip tests on both sides for all new commands/events,
  including the null/omission pins the existing capability tests model.
- Catalog validation: `translationPairs` presence/absence rules, tag
  validation, required translation artifact, task/family consistency —
  `bundled_catalog_is_valid` extended.
- Regression proof: with default settings (no translation model selected),
  the full existing dictation/LLM/TTS suites pass unchanged, and no
  translation command touches the sidecar.

Real-model evidence (weekly `multilingual-quality`-style workflow, not a
release publication gate):

- Install/remove behavior for the catalog entry, including hash verification
  and the model-removal gate.
- Per-direction quality fixtures for all 14 directions: pinned source
  sentences (drawn from WMT24++/FLORES-class public test data with license
  checks) scored with chrF++ against pinned references as a deterministic
  regression floor, plus COMET/MetricX offline where practical. Automated
  metrics establish *non-regression and gross adequacy only* — they cannot
  establish naturalness, terminology fitness, or formatting fidelity; no
  single-metric threshold is treated as proof of production quality.
- Bidirectional coverage: every claimed direction has its own fixtures; the
  reverse direction is never inferred.
- Markdown-preservation fixtures run through the real model (structure out
  == structure in).
- Long-text chunking and mid-operation cancellation against the real model.
- Performance: cold-load latency, peak RSS, tok/s throughput, first-chunk
  latency, and post-eviction memory, CPU-only, on all three platforms.
- Human bilingual review per direction before any README/product claim, per
  the multilingual-support precedent.

## Risks, rejected alternatives, and remaining blockers

Risks:

- **Unmeasured CPU throughput under `ort`** is the top technical risk; T0
  exists to retire it before any production code.
- The pinned export is community-published rather than first-party. It is the
  same publisher the catalog already depends on for Cohere Transcribe, and
  the bytes are hash-pinned, but an upstream re-export or deletion is a
  supply risk that a project-owned mirror would remove. Not worth doing
  pre-emptively; worth doing if the feature ships broadly.
- A ~3 GB download for an optional feature may skew install-funnel metrics;
  the Manage Models size display and license gate already mitigate surprise.
  Owner has accepted the size.
- Gemma use restrictions are passthrough obligations on users; same class as
  the shipped OpenRAIL-M model. Owner has accepted them.

Rejected alternatives (strongest first):

- **Seed-X-PPO-7B**: closest quality competitor with a friendlier license
  family (OpenMDW), rejected because 7B roughly doubles CPU latency and
  memory against the envelope, official quantizations target GPU serving
  stacks, upstream warns against unofficial quants, and there is no ONNX
  path — it fits a llama.cpp future better than this product's present.
- **Hunyuan-MT-7B**: best measured quality (WMT25); license territory
  exclusions (EU/UK/KR) make it undistributable for this product.
- **NLLB-200-distilled-600M**: would have been the easy small answer;
  CC-BY-NC-4.0 disqualifies it.
- **Opus-MT per-pair / MADLAD-3B**: license-clean but quality and
  maintenance downsides recorded in the comparison table.
- **Routing translation through the existing Ollama path**: violates
  first-class local (external daemon, unmanaged models, no capability
  gating, contradicts the cleanup prompts' no-translation contract).
- **Speech→English via Whisper's translate mode**: not general text
  translation.

Remaining blockers, after the 2026-07-27 owner decisions:

1. **T0 feasibility measurements** — throughput, peak RSS, and cold load
   under `ort` on the CPU execution provider are still unmeasured, and the
   `q4` vs `q4f16` choice depends on them. This is the only gate that can
   still change the recommendation.
2. **Per-direction quality evidence** (T3). No direction may be claimed in
   the README, catalog copy, or settings UI until its fixtures and bilingual
   review exist. Wiring a direction and claiming it are separate acts.

Resolved: Gemma Terms acceptance, download size, artifact hosting (the pinned
`onnx-community` export removes the self-hosting requirement), prompt-contract
verification (`chat_template.jinja` ships in the pinned repository), and UX
sign-off (delegated to the implementer within the constraints above).
