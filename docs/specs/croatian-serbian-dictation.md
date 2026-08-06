# Croatian and Serbian dictation

Delivery spec for [#359](https://github.com/brittain9/speech-kit-obsidian-plugin/issues/359), which asks for Croatian and
Serbian dictation through Whisper. This is also the first language request
handled under [adding-a-product-language.md](adding-a-product-language.md), so it
carries the one-time refactor that makes later requests cheap.

## Decision

Croatian (`hr`) and Serbian (`sr`) ship at the **Dictation** tier. They are
separate product choices; neither is a proxy for the other, nor for Bosnian or
Montenegrin.

| | Batch (Whisper LV3T) | Live (Nemotron) | Read aloud (Supertonic) | Translation | UI |
| --- | --- | --- | --- | --- | --- |
| **Hrvatski** `hr` | ✅ | ✅ prompt index 29 | verify, then ✅ or ❌ | ❌ | ❌ |
| **Српски** `sr` | ✅ | ❌ | ❌ | ❌ | ❌ |

Verified during planning, not inferred:

- Nemotron's pinned `processor_config.json` (`f3d3333`) `prompt_dictionary`
  contains `hr` and `hr-HR` at index **29**. It contains **no** `sr`, `sr-RS`,
  or `bs` — Serbian live dictation is not available and must be rejected, not
  approximated. (It does carry `sl`, `sk`, `bg`, and other Slavic tags, which is
  why "Nemotron supports Slavic languages" is not a usable claim.)
- Whisper's language map carries both `hr` and `sr` on the multilingual
  artifacts. `.en` artifacts are unaffected.
- Supertonic and Firefox Translations still need their Step 1 checks; the
  catalog entries currently list exactly the eight Full-tier tags.

Serbian therefore gets batch dictation and nothing else. That is the honest
answer to the issue, which asked for Whisper.

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
- **2e** Supertonic gains `hr` only if Step 1 confirms a real voice path. It
  must reject `sr` rather than fall through to the `na` branch in
  `preprocess_text`.
- **2f, 2g** Not in scope. No translation pairs, no UI catalogs.
- **3** FLEURS fixtures for `hr_hr` and `sr_rs` at sentence 1577.
- **4** README claims split into interface / translation / dictation counts.

Preflight is the part worth reviewing carefully. With `sr` selected, the model
picker must show Whisper as the only eligible engine, and choosing live
dictation or read aloud must explain the gap *before* capture or playback
starts. Silent English fallback is the failure mode this whole design exists to
prevent.

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
- [ ] Supertonic accepts `hr` only if verified, and rejects `sr` explicitly.
- [ ] Translation UI never offers an `hr` or `sr` pair.
- [ ] The eight existing languages are unchanged.
- [ ] README states three separate capability counts, not one.
- [ ] `npm run check` green; `multilingual-quality` dispatched and linked;
      native review recorded in `docs/quality/`.
- [ ] Support matrix in the playbook updated.

## Non-goals

- Any new ASR, TTS, or translation runtime.
- Serbian live dictation or read aloud — no shipped model serves them, and one
  request is not a business case for finding one.
- Croatian or Serbian translation directions or UI catalogs.
- Bosnian, Montenegrin, or any language nobody asked for.
- A blanket "all Whisper languages" setting. The point of the tier system is
  that each language carries verified evidence.
