# Croatian and Serbian dictation

Delivery spec for [#359](https://github.com/brittain9/speech-kit-obsidian-plugin/issues/359), which asks for Croatian and
Serbian dictation through Whisper. This is also the first language request
handled under [adding-a-product-language.md](adding-a-product-language.md), so it
carries the one-time refactor that makes later requests cheap.

## Decision

Croatian (`hr`) and Serbian (`sr`) are separate product choices; neither is a
proxy for the other, nor for Bosnian or Montenegrin. Their matrices are very
different, and that difference is the whole reason the tier system exists.

| | Batch (Whisper LV3T) | Live (Nemotron) | Read aloud (Supertonic) | UI | en→ | →en |
| --- | --- | --- | --- | --- | --- | --- |
| **Hrvatski** `hr` | ✅ | ✅ prompt 29 | ✅ | ✅ | deferred | ❌ unreleased |
| **Српски** `sr` | ✅ | ❌ absent | ❌ absent | ❌ by rule | deferred | ❌ unreleased |

**Croatian is a Full-tier language** — every speech capability we ship covers
it, so it also earns a UI catalog. **Serbian is Dictation tier**: batch
transcription, nothing else in speech, English interface.

Every cell was checked against the pinned artifact, not inferred:

- **Nemotron** — the pinned `processor_config.json` (`f3d3333`)
  `prompt_dictionary` has `hr` and `hr-HR` at index **29**, and no `sr`,
  `sr-RS`, or `bs` at all. It *does* carry `sl`, `sk`, and `bg`, which is why
  "Nemotron supports Slavic languages" is not a usable claim.
- **Whisper** — the language map carries both `hr` and `sr` on the multilingual
  artifacts. `.en` artifacts are unaffected.
- **Supertonic 3** — the model card lists 31 languages including `hr`. `sr` is
  absent, as are `bs` and `sr-Latn`; the adapter must reject Serbian rather than
  fall through to its `na` branch.
- **Firefox Translations** — `en-hr` and `en-sr` both have `releaseStatus:
  "Release"` (`base-memory`, ~31.6 MB each). `hr-en` and `sr-en` exist **only**
  as `tiny` builds with no release status, below the bar the catalog documents
  ("the current Firefox release model for each of the 14 directions").
- **Obsidian locales** — `hr` is listed work-in-progress, `sr` complete. Both
  are selectable app languages, so a plugin catalog for either would work; the
  cost is authoring it and finding a native reviewer, not platform support.

### The Serbo-Croatian translation model

The `en-hr`, `en-sr`, and `en-bs` Release models are all exports of the same
`hbs-topk10` training run — `hbs` being the ISO 639-3 code for the
Serbo-Croatian macrolanguage. Mozilla trained one model and published it under
three tags.

This is worth knowing before promising anything: our stated policy is that we do
not serve one language from another's model, and here the upstream vendor has
effectively done that for us. Adding both `en→hr` and `en→sr` means shipping the
same weights twice under two names, and it is unclear without testing whether
the `en-sr` export produces Cyrillic, Latin, or whatever the input suggests.
Ship at most one direction from this family until someone has looked at real
output.

## The refactor this unblocks

`native/src/transcription.rs:9` defines one eight-tag constant,
`VERIFIED_MULTILINGUAL_LANGUAGE_TAGS`, that four unrelated consumers read:

| Consumer | What it uses the list for |
| --- | --- |
| `catalog.rs:229` | validating `languageTags` on every catalog model |
| `catalog.rs:379` | validating `translationPairs` |
| `whisper.rs:42,106` | Whisper's advertised support **and** its runtime rejection |
| `nemotron_asr.rs:134` | Nemotron's advertised support |

So adding `hr` and `sr` to it would simultaneously claim Serbian live dictation
and permit a Serbian translation pair. There is no way to add one language to
one engine.

Split it by responsibility:

1. Rename to `PRODUCT_LANGUAGE_TAGS` and narrow it to what it is actually good
   at — the vocabulary of tags the product can persist and that catalog entries
   may name. Keep both catalog validation call sites. Add `hr` and `sr`.
2. Give Whisper its own list in `whisper.rs`, covering the eight plus `hr` and
   `sr`, used by both `verified_multilingual_language_support()` and the
   rejection path at line 106.
3. Make Nemotron derive its `LanguageSupport` from `SUPPORTED_LANGUAGE_PROMPTS`,
   which is already the authoritative mapping. Delete the test at
   `nemotron_asr.rs:1699` asserting the prompt table equals the global list —
   that assertion *is* the coupling, and it will fail correctly the moment
   Croatian lands.

Supertonic already owns its list (`supertonic.rs:24`) and needs no structural
change.

After this, "which languages does model X serve?" has exactly one answer per
model, and no edit can make an engine claim a language its artifact cannot
serve. That property is what the rest of the playbook depends on.

## Scope

Following the recipe in [adding-a-product-language.md](adding-a-product-language.md):

- **2a** `PRODUCT_LANGUAGE_TAGS` gains `hr`, `sr`.
- **2b** `DICTATION_LANGUAGE_OPTIONS` gains `Hrvatski` / `hr` and `Српски` /
  `sr`.
- **2c** Whisper's list and `whisper_large_v3_turbo_q8_0.languageTags` gain both.
- **2d** Nemotron gains one `LanguagePrompt { product_tag: "hr", metadata_key:
  "hr-HR", index: 29 }`; `nemotron_asr_0_6b_int8_streaming_560ms.languageTags`
  gains `hr` only.
- **2e** Supertonic's `SUPPORTED_LANGUAGES` and
  `supertonic_3_multilingual_2026_05.languageTags` gain `hr` only. `sr` must be
  rejected explicitly rather than falling through to the `na` branch in
  `preprocess_text`.
- **2f** No translation pairs — see [Translation and UI](#translation-and-ui).
- **2g** `src/locales/hr.ts` plus its `catalogs` registration, gated on a native
  reviewer and shipped separately. No `sr.ts`. Neither blocks the speech work.
- **3** FLEURS fixtures for `hr_hr` and `sr_rs` at sentence 1577.
- **4** README claims split into interface / translation / dictation counts.

Preflight is the part worth reviewing carefully. With `sr` selected, the model
picker must show Whisper as the only eligible engine, and choosing live
dictation or read aloud must explain the gap *before* capture or playback
starts. Silent English fallback is the failure mode this whole design exists to
prevent.

## Translation and UI

Neither blocks the speech work above. Together they are what stands between
Croatian and a complete Full-tier claim.

**Translation — decided: skip.** Only the `en→` directions are released, and
Croatian and Serbian translation is deferred until Mozilla releases the reverse.

The reasoning is worth keeping. Shipping one-way would have meant ~32 MB per
direction added to a pack every user downloads regardless of the languages they
translate, a UI that has to explain a missing reverse, and a fix to
`isSupportedTranslationPair` (`src/translation/languages.ts:44`) so the product
layer stops approving English-anchored pairs the installed pack cannot serve.
The alternative — the unreleased `tiny` builds — is a different architecture
from anything currently shipped and would need its own evaluation against
`docs/quality/translation-model-comparison.md` before it could be promised.

Neither cost is worth paying to half-deliver a capability. Every translation
language works both ways today; that invariant is worth more than a partial
Croatian entry, and Croatian is already Full-tier on speech without it.

Revisit when `hr-en` or `sr-en` reaches `Release` in the registry. The
`isSupportedTranslationPair` fix is still worth doing on its own merits, since
the product layer overstating the installed pack is a latent bug either way.

**UI localization — Croatian yes, Serbian no.** This follows [the localization
rule](adding-a-product-language.md#the-localization-rule): full speech coverage
earns a catalog.

Croatian has batch, live, and read aloud, so `src/locales/hr.ts` is in scope.
Serbian has only transcription. Obsidian ships a complete `sr` app locale and a
catalog would be technically selectable, so this is a deliberate product call
rather than a platform limit: localizing the whole interface around a feature
set that mostly reports "not available with your installed models" advertises
capability the product does not have. English is the honest presentation, and
Serbian dictation still works.

The remaining Croatian blocker is a native reviewer. Ship the speech work
without waiting — a Full-tier language with no catalog is a normal state, and
the catalog can land whenever a reviewer appears. Do not machine-translate one
to close the gap.

## Serbian script

Serbian is written in two alphabets in active everyday use — Cyrillic
(ћирилица) and Latin (latinica). Cyrillic is the official script; Latin
dominates online, in business, and in a lot of casual writing. Readers handle
both, but writers usually have a firm personal preference, and receiving the
wrong one is jarring. Croatian is Latin-only, so none of this applies to it.

The awkward part for a dictation product is that Whisper emits *text*, so it
picks a script for us. Its training data contains both, and its choice for `sr`
is not guaranteed or necessarily stable across utterances. A user who writes
their vault in Latin and gets Cyrillic transcripts has a product they cannot
use.

One property makes this tractable: **Serbian digraphia is a 1:1 lossless
mapping.** Each Cyrillic letter has exactly one Latin counterpart, so
transliteration is mechanical and reversible — unlike most script conversions
(simplified/traditional Chinese, for instance), where it is lossy and
context-dependent. Normalizing the output is therefore a safe option here, which
is unusual and worth knowing before ruling it out.

Two unknowns to resolve before deciding, in this order:

1. **What does Whisper actually emit for `sr`?** The FLEURS `sr_rs` fixture is
   Cyrillic, so it will tell us what the model does with Cyrillic-sourced read
   speech, but not whether the choice is stable across speakers and topics.
2. **What do Serbian users write in?** Asked on
   [#359](https://github.com/brittain9/speech-kit-obsidian-plugin/issues/359).

If Whisper turns out to be consistent and matches what people want, pass the
output through unchanged and this stays a footnote.

If it is inconsistent, or consistently the less-wanted script, the fix is **two
rows in the existing language dropdown** — `Српски (ћирилица)` and
`Srpski (latinica)` — persisting `sr-Cyrl` and `sr-Latn`. Both are valid BCP 47,
so the existing tag machinery carries them without change.

Deliberately *not* a conditional "this language has multiple alphabets, pick
one" sub-control. That would add persisted state, a setting most users never
see, and a "script" concept the rest of the product does not have. Two dropdown
rows introduce nothing: the user picks their language the way they already do.

The complexity is a layer down, and that is where review should focus. Whisper
has no script parameter, so both options send `sr` to the model and the
selection becomes an **output transform** applied after transcription. This
would be the first dictation language option that means "model language plus
post-processing" rather than just "model language" — a small precedent, but a
real one. It is only safe because the mapping is lossless; do not generalize the
pattern to script pairs where it is not.

Note this is also the first case where the persisted dictation tag is not the
tag sent to the engine. Keep the mapping explicit at the seam rather than
letting `sr-Cyrl` leak into an adapter that only knows `sr`.

Ship the first release with pass-through and no transliteration. Record the
observed script in the quality report. Do not guess at a normalization policy
before there is evidence for one.

## Acceptance

- [ ] No shared constant can make an engine claim a language it cannot serve;
      the Nemotron equality test is gone and its support derives from the prompt
      table.
- [ ] `hr` and `sr` persist as distinct choices with endonym labels.
- [ ] Whisper transcribes both, with fixtures and native review.
- [ ] Nemotron accepts `hr` at index 29 and rejects `sr` before audio capture.
- [ ] Supertonic reads Croatian aloud and rejects `sr` explicitly.
- [ ] Translation UI offers only directions the installed pack actually has.
- [ ] The eight existing languages are unchanged.
- [ ] Settings shows what the selected language actually covers, so Serbian
      users learn the shape of their support without hitting a failure.
- [ ] README states three separate capability counts, not one.
- [ ] `npm run check` green; `multilingual-quality` dispatched and linked;
      native review recorded in `docs/quality/`.
- [ ] Support matrix in the playbook updated.

## Non-goals

- Any new ASR, TTS, or translation runtime.
- Serbian live dictation or read aloud — no shipped model serves them, and one
  request is not a business case for finding one.
- A Serbian UI catalog, now or later, unless Serbian gains those capabilities.
- Bosnian or Montenegrin, despite `hbs` making them nearly free on the
  translation side. Nobody asked, and free is not a reason.
- A blanket "all Whisper languages" setting. The point of the tier system is
  that each language carries verified evidence.
