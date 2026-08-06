# Issue #359: Croatian and Serbian product-language support

Status: proposed implementation specification. This document records the
smallest useful response to [issue #359](https://github.com/brittain9/speech-kit-obsidian-plugin/issues/359), which asks for Croatian and Serbian
dictation support through Whisper. It does not itself enable either language.

## Product decision

Croatian (`hr`) and Serbian (`sr`) are distinct product-language choices. We
will not collapse them into one option or use either as a proxy for Bosnian or
Montenegrin.

The recommended first delivery is the **lean capability** option:

- add Croatian and Serbian manual choices for the existing multilingual
  Whisper Large V3 Turbo batch-dictation path;
- add Croatian—but not Serbian—to Nemotron live dictation after the same
  pinned-fixture and native-language quality gates used for current languages;
- add Croatian—but not Serbian—to Supertonic Read aloud after a listening
  review;
- make every unsupported combination clear before recording or speech starts;
- do not add a new runtime or model, expand translation, or claim UI
  localization in this delivery.

This answers the requested Whisper use case without pretending that all speech
or language features have equal coverage.

## Why these are separate

Whisper's language-token mapping contains both `hr` and `sr`, including the
multilingual artifacts used by Whisper Large V3 Turbo. Serbian has both Latin
and Cyrillic orthographies; the first release accepts the normal output of the
selected STT model and quality-tests both scripts where produced. It does not
create a separate `sr-Latn` UI or dictation option without a demonstrated
product need.

- [OpenAI Whisper tokenizer language map](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py)
- [whisper.cpp language map](https://github.com/ggml-org/whisper.cpp/blob/master/src/whisper.cpp#L2707-L2753)

## Capability matrix

This is the promise for the lean delivery. “After validation” is an
implementation gate, not a feature claim before the fixtures and review pass.

| Workflow / exact model | Croatian (`hr`) | Serbian (`sr`) | Lean-delivery decision |
| --- | --- | --- | --- |
| Batch dictation — Whisper Large V3 Turbo | Supported after validation | Supported after validation | Implement both. |
| Live dictation — Nemotron 3.5 ASR Streaming | Supported by upstream prompt mapping; validate first | Not in the upstream supported-language list | Implement Croatian only. |
| Batch dictation — Cohere Transcribe | Not supported by shipped path | Not supported by shipped path | No change; keep English-only behavior. |
| Live dictation — Moonshine | English-only artifact | English-only artifact | No change. |
| Read aloud — Supertonic 3 | Supported upstream; validate first | No verified Serbian path | Implement Croatian only. |
| Read aloud — Pocket TTS | Not supported | Not supported | No change. |
| Local translation — Firefox/Bergamot | No released two-way product direction | No released two-way product direction | No change. |
| Plugin UI | Obsidian lists `hr` as work in progress; no plugin catalog is reviewed | Obsidian supports `sr`; no plugin catalog is reviewed | Defer both; English UI fallback remains correct. |

Primary upstream evidence:

- [Nemotron 3.5 ASR Streaming supported languages](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b#supported-languages)
- [Pinned Nemotron processor language prompts](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/blob/f3d333391852ba876df169dcc9ba902d25b6ab0b/processor_config.json)
- [Supertonic 3 supported languages](https://huggingface.co/Supertone/supertonic-3#supported-languages)
- [Pocket TTS language list](https://github.com/kyutai-labs/pocket-tts/blob/d108410d23eef7e01db282f9442891162dbc3db6/README.md#L18-L31)
- [Current Firefox translation model registry](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json)
- [Obsidian translation locales](https://github.com/obsidianmd/obsidian-translations#existing-languages)

## Implementation scope

### 1. Make language eligibility model-specific

The current shared `VERIFIED_MULTILINGUAL_LANGUAGE_TAGS` is used by Whisper,
Nemotron, catalog validation, and translation. Adding `hr` and `sr` to it
would incorrectly advertise Serbian Nemotron or translation support.

Refactor the shared validation boundary so each resolved exact model declares
and validates its own supported language tags. Preserve a separately scoped
product-level set only where it cannot make a model eligible. In particular:

- Whisper's multilingual adapter permits `hr` and `sr` for the existing
  multilingual artifact, while `.en` artifacts remain English-only.
- Nemotron's adapter gains `hr` / `hr-HR` at its upstream prompt index `29`;
  it rejects `sr` with a specific unsupported-language result.
- Supertonic's adapter adds `hr` only after its voice/path validation; it
  rejects `sr` rather than treating `na` or a neighboring language as Serbian.
- Firefox translation retains its current exact released-direction validation;
  neither tag is added merely because a registry entry exists.

### 2. Surface only supported options

Add Croatian and Serbian as endonym-labelled dictation choices in
`src/language/dictation-language.ts`. The settings and model picker must use
resolved model eligibility to explain which installed model can serve each
language.

For read aloud, do not pass the global dictation language to a TTS engine when
that engine has no matching path. The user receives a local, actionable
explanation such as “Serbian read aloud is not available with the installed
models,” before playback begins. The same preflight rule applies to live
dictation and model downloads.

### 3. Update exact catalog metadata

After validation evidence exists, update only these managed model entries in
`native/catalog.json`:

- Whisper Large V3 Turbo: add `hr` and `sr`.
- Nemotron 3.5 ASR Streaming: add `hr` only.
- Supertonic 3: add `hr` only.

Do not modify Cohere Transcribe, Moonshine, Pocket TTS, or Firefox Translation
metadata for this issue.

### 4. Add focused quality evidence

Add Croatian and Serbian human-speech fixtures (for example, pinned FLEURS
recordings) to the existing multilingual fixture and quality-workflow pattern.
For each new enabled cell, test manual selection, expected output language,
and no implicit translation. Test Whisper automatic detection as a separate
claim only if it meets the same evidence bar.

Native reviewers must assess Croatian Whisper, Croatian Nemotron, Croatian
Supertonic, and Serbian Whisper. Serbian review includes both natural Latin and
Cyrillic examples where available, with the observed model-output script
recorded rather than normalized or rewritten by the plugin. Passing a fixture
is a regression floor; it does not replace this review.

## Acceptance criteria

- [ ] Croatian and Serbian are persisted as distinct base-tag choices and use
  clear endonyms.
- [ ] Whisper Large V3 Turbo completes Croatian and Serbian dictation with
  focused fixtures and native-language review.
- [ ] Nemotron accepts Croatian through the correct prompt mapping and rejects
  Serbian before audio capture.
- [ ] Supertonic accepts Croatian after a listening review and rejects Serbian
  before playback.
- [ ] Existing English-only and eight-language paths remain unchanged unless
  their exact model also supports the selected new tag.
- [ ] Model metadata, settings, Rust adapter validation, and user-visible
  eligibility all agree; no global language list can overstate capability.
- [ ] Translation UI never offers a Croatian or Serbian pair without an exact
  released installed direction.
- [ ] Focused tests, the multilingual quality workflow, and `npm run check`
  pass; an Obsidian smoke test verifies one supported and one unsupported path.

## Explicit non-goals

- A new ASR, TTS, or translation runtime solely to increase language count.
- Serbian live dictation or Serbian read aloud without separate model research
  and native-language evidence.
- Firefox/Bergamot translation support for Croatian or Serbian in this issue.
- A Croatian or Serbian UI catalog in this issue.
- Automatically adding Bosnian, Montenegrin, or other related languages.
- A blanket “all Whisper languages” product setting.

## Later full-parity option

Full parity is a sensible follow-up only if users demonstrate that the lean
matrix is insufficient. It would separately evaluate:

1. a trustworthy Serbian streaming-ASR path;
2. a trustworthy Serbian TTS path;
3. released, installed translation directions that meet the existing
   preview-first translation policy;
4. complete, native-reviewed Croatian and Serbian UI catalogs, with an
   explicit decision about Serbian Cyrillic versus an additional `sr-Latn`
   catalog;
5. supported-model UX and quality evidence for every new cell.

The trigger is customer value plus evidence, not the mere existence of a model
that lists the language. If no existing model closes a demonstrated important
gap, evaluate one candidate through the process in
[adding-a-product-language.md](adding-a-product-language.md) rather than
expanding the plugin's runtime surface preemptively.
