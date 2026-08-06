# Adding a product language

This is the repeatable process for answering "can you add language X?". It is
written to be executable: an agent handed a language request should be able to
follow it end to end and open a reviewable PR.

Architecture and invariants live in
[multilingual-support.md](multilingual-support.md). This document is the
operational layer on top of it.

## The problem this solves

Speech Kit currently ships eight languages, and today that is one coupled set:
the same eight tags appear in dictation, read aloud, translation, and the UI
catalog. That coupling is a coincidence of how the first multilingual release
was scoped, not a design.

The moment a user asks for a ninth language, the coincidence breaks. Whisper can
transcribe Croatian; Supertonic may not speak it; there is no Croatian UI
catalog and nobody has reviewed one. If we keep treating "supported language" as
a single boolean, the only options are to overclaim or to refuse.

So: **capability is per exact model, and the product describes the union
honestly.** A language is not "supported" or "unsupported" — it has a matrix.

## Support tiers

Tiers are names for the common shapes that matrix takes. They exist so a request
can be answered in minutes instead of re-litigating scope every time. A tier is a
*description* of the derived matrix, never a switch in code — nothing reads a
tier at runtime.

| Tier | Batch dictation | Live dictation | Read aloud | Translation | UI |
| --- | --- | --- | --- | --- | --- |
| **Full** | ✅ | ✅ | ✅ | ✅ to/from English | ✅ localized |
| **Dictation** | ✅ | where the streaming model supports it | where the TTS model supports it | ❌ | English |
| **Deferred** | — | — | — | — | — |

- **Full** is the current eight: `en`, `es`, `de`, `fr`, `pt`, `it`, `nl`, `ja`.
  Promotion into this tier is expensive — it needs a translation direction in the
  model pack, a TTS voice path, and a native-reviewed UI catalog. It is not the
  default answer to a request.
- **Dictation** is the default answer. It solves the request that people
  actually file ("I want to dictate in my language") using models we already
  ship, and it costs one fixture plus a handful of list entries.
- **Deferred** is a real answer, recorded with its reason. A request we cannot
  serve is data, not a failure — see [When to add a new
  model](#when-to-add-a-new-model).

Live dictation and read aloud are deliberately *conditional* inside the
Dictation tier rather than promoted to their own tiers. Whether Nemotron or
Supertonic happens to cover a given language is a property of those artifacts,
not a product decision worth a name.

## Current support matrix

Update this table in the same PR that adds a language. It is the living record;
routine additions do not need their own spec document.

| Language | Tag | Tier | Whisper LV3T | Nemotron live | Supertonic | Translation | UI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| English | `en` | Full | ✅ | ✅ | ✅ | ✅ | ✅ |
| Español | `es` | Full | ✅ | ✅ | ✅ | ✅ | ✅ |
| Deutsch | `de` | Full | ✅ | ✅ | ✅ | ✅ | ✅ |
| Français | `fr` | Full | ✅ | ✅ | ✅ | ✅ | ✅ |
| Português | `pt` | Full | ✅ | ✅ | ✅ | ✅ | ✅ |
| Italiano | `it` | Full | ✅ | ✅ | ✅ | ✅ | ✅ |
| Nederlands | `nl` | Full | ✅ | ✅ | ✅ | ✅ | ✅ |
| 日本語 | `ja` | Full | ✅ | ✅ | ✅ | ✅ | ✅ |

Pending, from [croatian-serbian-dictation.md](croatian-serbian-dictation.md):

| Language | Tag | Tier | Whisper LV3T | Nemotron live | Supertonic | Translation | UI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hrvatski | `hr` | Dictation | ✅ | ✅ (prompt 29) | verify | ❌ | ❌ |
| Српски | `sr` | Dictation | ✅ | ❌ (absent upstream) | ❌ | ❌ | ❌ |

## The recipe

### Step 0 — Identify the language

Normalize to a BCP 47 base tag and pick the endonym users will recognize. Check
the [IANA subtag
registry](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry)
when the tag is not obvious.

Two traps:

- **Do not merge mutually intelligible languages.** Croatian and Serbian are
  separate product choices even where the speech models treat them similarly.
  Serving `sr` from an `hr` selection is the kind of substitution that makes
  people close the plugin.
- **Decide the script policy explicitly** when a language has more than one
  orthography. Default: ship one base-tag option, pass the model's output
  through unmodified, and record which script it actually produced. Add a
  script-qualified tag (`sr-Latn`) only on demonstrated demand.

Regional tags stay out — `pt-BR` and `pt-PT` are one `pt` option, per the
existing policy in [multilingual-support.md](multilingual-support.md).

### Step 1 — Check each model, one at a time

Never infer from a family page or a language count. Check the exact pinned
artifact. These are the four checks, with the authoritative source for each:

| Model | Where to check | What counts as a yes |
| --- | --- | --- |
| Whisper Large V3 Turbo | [whisper.cpp language map](https://github.com/ggml-org/whisper.cpp/blob/master/src/whisper.cpp#L2707-L2753) | tag present in the map, artifact is not `.en` |
| Nemotron 3.5 ASR Streaming | `prompt_dictionary` in the pinned [`processor_config.json`](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/blob/f3d333391852ba876df169dcc9ba902d25b6ab0b/processor_config.json) | tag present; record its integer index |
| Supertonic 3 | [model card supported languages](https://huggingface.co/Supertone/supertonic-3#supported-languages) | an explicit language path, not the `na` fallback |
| Firefox Translations | [Mozilla model registry](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json) | a *released* direction, both ways, to/from English |

Cohere Transcribe, Moonshine, and Pocket TTS are English-only by artifact. They
are not part of this check and should not be touched by a language PR.

Record every answer including the noes — the noes are what the UI has to explain
and what feeds the new-model decision later.

### Step 2 — Write the code

Ordered, with exact seams. Steps 2a and 2b always apply; the rest are gated on
Step 1 answers.

**2a. Product vocabulary** — `native/src/transcription.rs`

Add the tag to `PRODUCT_LANGUAGE_TAGS`. This list is the set of tags the product
can persist and that catalog entries are allowed to name. It grants no
capability; it is a spelling check.

> Until the refactor in
> [croatian-serbian-dictation.md](croatian-serbian-dictation.md) lands, this
> constant is `VERIFIED_MULTILINGUAL_LANGUAGE_TAGS` and is also wired directly
> into Whisper's and Nemotron's advertised support. Adding a tag to it in that
> state silently claims both engines support the language. Do the refactor
> first.

**2b. User-facing option** — `src/language/dictation-language.ts`

Add `{ label: '<endonym>', value: '<tag>' }` to `DICTATION_LANGUAGE_OPTIONS`.
Use the endonym, matching the existing entries; the `Intl.DisplayNames` fallback
in `formatCatalogLanguageLabel` is only for catalog tags with no option.

**2c. Whisper** (if yes) — add the tag to Whisper's own supported-language list
in `native/src/adapters/whisper.rs`, and to `languageTags` on
`whisper_large_v3_turbo_q8_0` in `native/catalog.json`. The `.en` artifacts stay
English-only.

**2d. Nemotron** (if yes) — add a `LanguagePrompt` entry to
`SUPPORTED_LANGUAGE_PROMPTS` in `native/src/adapters/nemotron_asr.rs` with the
`product_tag`, the upstream `metadata_key`, and the `index` recorded in Step 1.
Add the tag to `languageTags` on `nemotron_asr_0_6b_int8_streaming_560ms`.

**2e. Supertonic** (if yes) — add the tag to `SUPPORTED_LANGUAGES` in
`native/src/adapters/supertonic.rs` and to `languageTags` on
`supertonic_3_multilingual_2026_05`.

**2f. Translation** (rarely) — add both directions to `translationPairs` on
`firefox_translations_release_2026_07`. Note the cost: the translation pack is a
single download, so every added pair grows it for every user regardless of the
languages they use. This is a Full-tier promotion, not part of a dictation
request.

**2g. UI locale** (separate track) — a new `src/locales/*.ts` catalog needs a
native reviewer and passes the existing parity checks. It is independent of
dictation support in both directions: a UI catalog must never widen model
eligibility, and dictation support does not imply a catalog is owed. Do not
bundle it into a dictation PR.

The invariant that makes all of this safe: **no shared list may be the reason a
model appears eligible.** If adding one tag in one place changes what two
different engines claim, that is the bug — fix the coupling, not the symptom.

### Step 3 — Add the quality fixture

The multilingual corpus is data-driven and pinned to Google FLEURS validation
sentence 1577, one recording per language.

1. Find the language's FLEURS config (`hr_hr`, `sr_rs`, …) and the row carrying
   sentence 1577.
2. Convert to 16 kHz mono 16-bit PCM WAV, commit as
   `native/tests/fixtures/audio/<tag>-fleurs-1577.wav`.
3. Add the entry to `native/tests/fixtures/multilingual.json`: `language`,
   `config`, `row`, `recordingId`, `audioPath`, `sha256`, `reference`, and two
   `anchors` (content words that must survive).

No code change — the suite picks it up. If FLEURS has no config for the
language, say so in the PR and propose an alternative permissively licensed
read-speech clip with the same provenance fields.

The fixture is a regression floor, not proof of quality. It catches "we broke
Croatian", not "Croatian is good". Native review is the second half.

### Step 4 — Fix the product copy

The README still describes the eight as one set ("eight languages", "seven other
languages"). Any PR that breaks the coupling has to split those claims into
their real, separate counts:

- **Interface languages** — the `src/locales/` catalogs.
- **Translation languages** — released directions in the model pack.
- **Dictation languages** — the union across STT models, which is now larger
  than either of the above and varies by installed model.

Do not replace a specific claim with a vague one. "Dictation in 10 languages
depending on the model you install" is honest; "multilingual" is not.

### Step 5 — Verify

- `npm run check` — the full gate.
- Manually dispatch the `multilingual-quality` workflow. It runs the real
  pinned models against the fixture corpus and is the evidence for the new
  language. It is not a PR gate, so dispatch it deliberately and link the run.
- Native-speaker review of representative output for every capability being
  claimed: transcript quality, punctuation, proper nouns, and — for scripted
  languages — which script came back. Record the result in
  `docs/quality/multilingual-quality-report.md`.
- Obsidian smoke test: one supported path works, one unsupported path explains
  itself before recording or playback starts rather than falling back to
  English.

## When to add a new model

The trigger is **a cluster of requests pointing at the same gap**, not any
single request and never the existence of a model that lists more languages.

Adding a runtime is the most expensive thing this project can do: licensing,
provenance, packaging, per-platform build, download size, and a permanent
maintenance surface. A model that covers forty languages we have never been
asked for is a liability, not a feature.

The practical rule: keep declined and partial languages in the matrix above with
their reason. When several accumulate behind one missing capability — say, four
Slavic-language users all wanting live dictation Nemotron cannot serve — that
cluster is the business case, and it names exactly what the candidate model has
to do. Evaluate one candidate against that specific gap.

Until then, a Dictation-tier answer plus an honest gap is the right response,
and it is a much better user experience than an overclaimed one.

## Checklist

- [ ] Tag normalized, endonym chosen, script policy decided.
- [ ] All four models checked against their pinned artifact; noes recorded.
- [ ] Tier chosen; Full-tier promotion justified separately if claimed.
- [ ] No shared list grants capability to a model that lacks it.
- [ ] Unsupported combinations explain themselves before capture or playback.
- [ ] FLEURS fixture committed with provenance and anchors.
- [ ] README language claims split by capability, not merged.
- [ ] `npm run check` green; `multilingual-quality` dispatched and linked.
- [ ] Native review recorded in `docs/quality/`.
- [ ] Support matrix in this document updated.
