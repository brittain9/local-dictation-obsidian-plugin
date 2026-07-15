# Nemotron 3.5 ASR streaming engine

## Status and scope

This spec defines the integration of NVIDIA's Nemotron 3.5 ASR streaming model
(`nvidia/nemotron-3.5-asr-streaming-0.6b`) as a native sidecar engine, and it
supersedes the Parakeet Unified direction (PR #258, issue #242). Nemotron 3.5
is the successor to the same model line (parakeet-unified →
nemotron-speech-streaming-en → nemotron-3.5), and it resolves the two problems
that kept Parakeet Unified experimental:

- **Compute:** cache-aware streaming reuses encoder self-attention and
  convolution cache states across chunks instead of recomputing a 5.6-second
  left context per 560 ms window.
- **Languages:** one 600M-parameter model streams 40 language-locales with
  language-ID prompt conditioning and an automatic-detection mode, making it
  the engine that removes the "multilingual costs us live transcription"
  trade-off (see `docs/specs/multilingual-support.md`).

Delivery is staged: Stage A ships Nemotron as an English engine inside the
current English-only product boundary. Stage B enables multilingual live
transcription once the multilingual-support spec's stages 1–3 (per-model
eligibility, persisted language, protocol threading) are in place. Stage A must
not block on Stage B, and Stage B must not require reworking Stage A.

## Model facts

- **Checkpoint:** `nvidia/nemotron-3.5-asr-streaming-0.6b`, released
  2026-06-04. 600M parameters. Cache-aware FastConformer-RNNT with prompt
  conditioning: 24-layer FastConformer encoder with explicit cache tensors,
  RNNT decoder, greedy streaming decode. Native punctuation and
  capitalization.
- **License:** OpenMDW-1.1, approved for commercial use. This is more
  permissive than Parakeet's NVIDIA Open Model License; there is no
  per-installed-copy agreement/notice gate. The full license text still ships
  in `THIRD_PARTY_NOTICES.md` with provenance links, matching existing
  practice.
- **Latency:** configurable chunk size via attention context — 80 ms, 160 ms,
  320 ms, 560 ms, 1120 ms. The export is optimized per chunk size; the pinned
  artifact fixes one configuration.
- **Language conditioning:** the multilingual encoder takes a sixth ONNX input
  `prompt_index` (int64, shape `[batch]`). A locale index selects the
  language; index 101 enables automatic language detection (auto mode emits
  `<xx-XX>` tags that must be stripped from user-visible text).
- **Language tiers (40 locales):**
  - *Transcription-ready (19):* en-US, en-GB, es-US, es-ES, fr-FR, fr-CA,
    it-IT, pt-BR, pt-PT, nl-NL, de-DE, tr-TR, ru-RU, ar-AR, hi-IN, ja-JP,
    ko-KR, vi-VN, uk-UA.
  - *Broad-coverage (13):* pl-PL, sv-SE, cs-CZ, nb-NO, da-DK, bg-BG, fi-FI,
    hr-HR, sk-SK, zh-CN, hu-HU, ro-RO, et-EE.
  - *Adaptation-ready (8):* requires fine-tuning; not eligible for this
    product.

Per the multilingual-support spec, tier membership is upstream marketing until
verified: only languages with passing pinned fixtures become `languageTags`
entries.

## Artifact selection (gate A0)

The engine consumes a sherpa-onnx-style transducer export: `encoder`,
`decoder`, `joiner` ONNX graphs plus `tokens.txt`. sherpa-onnx upstream has
added multilingual Nemotron 3.5 support, so verified export recipes and
published artifacts exist or are imminent. Before any catalog entry:

1. Pin one quantized export (int8 preferred; evaluate the onnx-community int4
   export against it for quality) at an exact revision with SHA-256 for every
   artifact, exactly as the catalog does today.
2. Record the export tool and revision. If the published recipe is not
   bit-reproducible, document the narrower pinned-bytes guarantee, as PR #258
   did for Parakeet.
3. Verify the tokenizer and graph topology at load: input/output names, cache
   tensor shapes, `prompt_index` presence (multilingual export) or absence
   (English-only export, if pinned instead for Stage A), vocabulary size.
4. Golden parity: committed fixtures comparing frontend features and token
   output against the NeMo reference implementation
   (`speech_to_text_cache_aware_streaming_infer.py`) for the pinned chunk
   size.

Default chunk size: 560 ms, matching the validated Parakeet configuration and
the existing worker cadence. Lower-latency configs are a follow-up experiment,
not part of this integration.

## Stage A — English engine in the current product

Adds a `nemotron_asr` family on the existing `onnx_runtime` runtime. No
protocol, settings, or UI language changes; `language` remains `'en'`
end-to-end and the catalog entry ships `languageTags: ["en"]`.

Reusable from the Parakeet Unified adapter work (PR #258): the NeMo-compatible
128-bin frontend (verify parity for this checkpoint — gate A0.4), RNNT greedy
decoding, partial/final revision semantics, lifecycle reset on final and on
error. New work:

- Cache-aware encoder session: hold encoder cache tensors (self-attention and
  convolution state) as adapter state, feed them as inputs and persist the
  returned states each step. Reset them with the RNNT predictor state after
  every final, including error paths.
- Fixed language conditioning: if the pinned export is multilingual, send the
  en-US `prompt_index` constant. Auto mode is out of scope for Stage A.
- Capability registration: `LanguageSupport::EnglishOnly`, streaming, no
  language selection — truthful for what Stage A exposes, not for what the
  weights can do.

Acceptance (mirrors the Parakeet verification bar):

- Full VAD/worker/revision-protocol path passes with the pinned artifacts.
- Streamed partials preserve their committed prefix; streamed final equals
  one-shot final; post-final reuse is identical; silence produces no
  transcript.
- LibriSpeech fixture WER comparable to the Parakeet Unified measurement, with
  wall-time and peak-RSS numbers recorded. Cache-aware streaming should beat
  the buffered 560 ms design on CPU time; if it does not, that is a finding to
  publish in the PR, not to hide.
- `npm run check` green, including clippy with all speech features.

## Stage B — multilingual live transcription

Blocked on multilingual-support spec stages 1–2 (model-level eligibility,
persisted `dictationLanguage` + protocol widening). Nemotron-specific work:

- Map normalized BCP 47 tags to `prompt_index` values; reject tags outside the
  verified set at session start with a model-specific message.
- Regional policy: the model distinguishes locales (en-US vs en-GB, pt-BR vs
  pt-PT). The persisted language tag maps to exactly one locale index;
  unqualified tags (`pt`) resolve by an explicit table, never silently.
- Auto-detect (`prompt_index = 101`) is exposed only as the explicit `auto`
  state from the multilingual spec, and the emitted `<xx-XX>` tags are
  consumed as metadata, never inserted into the transcript.
- Enable languages in verified waves with pinned per-language fixtures for
  accuracy and no-translation behavior:
  - *Wave 1:* es, de, fr, pt, it, nl (Latin script; existing text pipeline
    works unchanged).
  - *Wave 2:* ja, ko, zh — requires the hallucination-filter CJK word
    segmentation fix (`words()` is whitespace-based) and non-Latin punctuation
    checks; zh-CN is broad-coverage tier, so it needs stronger fixture
    evidence.
  - *Wave 3 candidates:* ru, uk, tr, hi, ar, vi — transcription-ready tier;
    RTL (ar) and Devanagari (hi) need editor-surface verification first.
- Hallucination filter: keep the signal-based core (no-speech probability,
  logprob, VAD corroboration, repetition detection) active for all languages;
  gate the English phrase lists (`is_soft_artifact`, `is_caption_attribution`,
  `is_hard_nonspeech_tag`, `STRUCTURAL_LABEL_KEEP_LIST`) to English until
  per-language evidence exists.

## Product positioning

- Moonshine remains the low-resource English streaming default. Nemotron is
  the accuracy/multilingual streaming engine; its catalog copy states download
  size and CPU cost honestly.
- Whisper multilingual remains the batch multilingual path; Cohere and
  Moonshine stay explicitly English-only in their family copy, per the
  truthful-readiness rules already shipped in PR #255.
- The Parakeet Unified engine is not added. Its adapter techniques carry into
  this integration; its model does not.

## Non-goals

- Translation (speech or text). Transcripts preserve the spoken language.
- Speech-LLM features of the broader Nemotron family.
- UI localization (i18next). Sequenced after multilingual dictation works;
  tracked separately.
- Chunk sizes other than the pinned configuration.
- Fine-tuning adaptation-ready locales.
