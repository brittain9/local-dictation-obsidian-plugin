# Croatian and Serbian dictation

Delivery spec for [#359](https://github.com/brittain9/speech-kit-obsidian-plugin/issues/359), which asks for Croatian and
Serbian dictation through Whisper. This is also the first language request
handled under [adding-a-product-language.md](adding-a-product-language.md), so it
carries the one-time refactor that makes later requests cheap.

## Decision

Croatian (`hr`) and Serbian (`sr`) are separate product choices; neither is a
proxy for the other, nor for Bosnian or Montenegrin. Their matrices are very
different, and that difference is the whole reason the tier system exists.

| | Batch (Whisper LV3T) | Live (Nemotron) | Read aloud (Supertonic) | en→ | →en | UI |
| --- | --- | --- | --- | --- | --- | --- |
| **Hrvatski** `hr` | ✅ | ✅ prompt 29 | ✅ | ✅ Release | ❌ unreleased | possible |
| **Српски** `sr` | ✅ | ❌ absent | ❌ absent | ✅ Release | ❌ unreleased | possible |

**Croatian is a Full-tier language.** Every speech capability we ship covers it.
**Serbian is Dictation tier** — batch transcription, and nothing else in speech.

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
- **2f, 2g** Deferred — see [Open decisions](#open-decisions). Neither blocks
  the speech work above.
- **3** FLEURS fixtures for `hr_hr` and `sr_rs` at sentence 1577.
- **4** README claims split into interface / translation / dictation counts.

Preflight is the part worth reviewing carefully. With `sr` selected, the model
picker must show Whisper as the only eligible engine, and choosing live
dictation or read aloud must explain the gap *before* capture or playback
starts. Silent English fallback is the failure mode this whole design exists to
prevent.

## Open decisions

Both are genuine product calls, and neither blocks shipping the speech
capabilities. They are what stands between Croatian and a complete Full-tier
claim.

**Translation.** Only the `en→` directions are released. Three options:

1. **Skip both.** Keeps the current invariant that every language translates
   both ways, and keeps the pack size flat. Costs a capability Croatian could
   otherwise have.
2. **Ship one-way** `en→hr` (and possibly `en→sr`). Requires fixing
   `isSupportedTranslationPair` (`src/translation/languages.ts:44`) to consult
   installed directions instead of approving any English-anchored pair, plus UI
   that explains why the reverse is missing. Adds ~32 MB per direction to a pack
   every user downloads.
3. **Ship the `tiny` reverse.** Gets bidirectional coverage, but `tiny` is a
   different architecture from everything currently shipped and carries no
   release status. It would need its own quality evaluation against
   `docs/quality/translation-model-comparison.md` before it could be promised.

**UI localization.** Obsidian ships both locales, so `src/locales/hr.ts` and
`src/locales/sr.ts` are viable. The blocker is a native reviewer — an unreviewed
machine-translated catalog is worse than the English fallback, because English
fallback is obviously English while bad Croatian looks like a broken product.
Worth opening as a call for contributors rather than authoring speculatively.

## Serbian script

FLEURS `sr_rs` is Cyrillic; Whisper's `sr` output script is not guaranteed and
depends on the audio. Policy for this delivery: one `sr` option, model output
passed through unmodified, no transliteration in either direction. Record the
script the fixture actually produces in the quality report. If users ask for
Latin output specifically, `sr-Latn` is a later, separate decision with its own
evidence — not something to guess at now.

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
- [ ] README states three separate capability counts, not one.
- [ ] `npm run check` green; `multilingual-quality` dispatched and linked;
      native review recorded in `docs/quality/`.
- [ ] Support matrix in the playbook updated.

## Non-goals

- Any new ASR, TTS, or translation runtime.
- Serbian live dictation or read aloud — no shipped model serves them, and one
  request is not a business case for finding one.
- Bosnian or Montenegrin, despite `hbs` making them nearly free on the
  translation side. Nobody asked, and free is not a reason.
- A blanket "all Whisper languages" setting. The point of the tier system is
  that each language carries verified evidence.
