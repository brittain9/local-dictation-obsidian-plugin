# Adding a product language

## Purpose

This is the lightweight, request-driven process for adding a language to Speech
Kit. It deliberately does **not** turn every upstream model language into a
product promise. We add languages when a user need is clear, then ship the
smallest truthful capability set that is useful and can be maintained.

Use this document with the active request-specific specification. The current
multilingual architecture and its invariants remain in
[multilingual-support.md](multilingual-support.md).

## Product rule

A product language is a distinct user choice identified by a normalized BCP 47
base tag, its endonym, and (where relevant) its script policy. It is not a
synonym for a model family or a neighboring language.

Every promised capability is attached to an exact, pinned model artifact:

| Capability | Product claim |
| --- | --- |
| Batch dictation | The selected batch STT model accepts the language and passes its quality gate. |
| Live dictation | The selected streaming model accepts the language and passes its quality gate. |
| Read aloud | The selected TTS model has a verified voice/language path and passes its quality gate. |
| Translation | A released, installed direction exists for the exact source and target pair. |
| UI localization | A reviewed plugin catalog exists for the Obsidian locale. |

An empty cell is an intentional product gap, not a reason to claim a vague
`multilingual` feature. The UI must prevent the combination or explain the
gap before a session starts; it must never silently substitute English or a
nearby language.

## Decision principles

1. Treat related languages as separate product choices unless a user-facing
   policy explicitly says otherwise. Do not map one tag to another merely
   because they are mutually intelligible in some contexts.
2. Keep model eligibility authoritative in the exact catalog entry and adapter.
   A family page, a tokenizer list, or an automatic-detection capability is not
   enough to enable a particular shipped artifact.
3. Ship the smallest useful matrix first. Batch dictation alone can be a good
   first release if it solves the request; full live, TTS, translation, and UI
   parity are separate investments.
4. Do not add a runtime or model simply because it supports more languages.
   Add one only when an observed user workflow has a material gap that existing
   shipped models cannot meet, and the candidate clears licensing, provenance,
   packaging, performance, and native-language quality review.
5. Keep plugin UI locale independent from dictation language. A language can
   have dictation support without a UI catalog, and a contributed UI catalog
   must not widen model eligibility.
6. Make script behavior explicit. If a language commonly uses more than one
   script, record which scripts are tested and whether the product provides
   separate locale choices.

## Workflow

### 1. Record the request and language identity

Create a short spec for the request. Record:

- requested names, normalized BCP 47 base tag, endonym, and common regional
  tags;
- whether the language is distinct from any adjacent request;
- script and orthography policy, including what automatic detection means;
- the customer workflow that would make the request successful.

Use authoritative language-tag references such as the [IANA Language Subtag
Registry](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry).

### 2. Build the exact capability matrix

For every current product workflow, inspect the exact pinned artifact,
adapter, and catalog—not only upstream marketing material. Record supported,
unsupported, and unverified states separately.

At minimum inspect:

- batch and live STT;
- automatic detection and manual language selection;
- TTS / Read aloud;
- local translation directions, including their release status;
- Obsidian locale availability and the plugin catalog;
- license, download size, runtime requirements, and existing model-management
  behavior.

The request spec should name the primary upstream source for each positive
claim and describe the current product behavior for each negative claim.

### 3. Choose a scope

Choose one of these deliberately; do not blend them in product copy:

| Scope | Appropriate when | Includes |
| --- | --- | --- |
| Lean capability | Existing shipped models cover the requested core workflow. | The verified paths only, clear unsupported states, and focused quality evidence. |
| Full parity | The request and evidence justify a complete language experience. | Lean scope plus live STT, TTS, translation directions, and reviewed UI localization where viable. |
| Research first | No existing path is reliable enough to promise. | A recorded gap, evaluation plan, and no customer-facing enablement. |

The default is **lean capability**. A new-model evaluation is a follow-up only
when it is necessary to close a customer-important gap, rather than a
requirement for accepting the original request.

### 4. Implement capability boundaries

Keep validation model-specific all the way through settings, catalog,
TypeScript protocol, and Rust adapters. In particular, do not enlarge a shared
`verified languages` list when the new language is supported by only one
model family.

The implementation normally touches only the applicable seams:

- `src/language/dictation-language.ts` for the persisted, endonym-labelled
  selection;
- `native/catalog.json` for exact model language metadata;
- the relevant native adapter's mapping and rejection behavior;
- model eligibility and preflight UI so incompatible choices are clear before
  recording or speech starts;
- `src/translation/languages.ts` only when released translation directions are
  actually added;
- `src/locales/` only when a reviewed UI locale catalog is ready.

Keep existing model choices intact for other languages. A new language must not
make an installed model appear eligible when its artifact cannot serve it.

### 5. Verify quality and UX

Before enabling a capability, add and run focused evidence:

- a pinned human-speech fixture and expected-language assertion for each STT
  path;
- manual and automatic selection checks where automatic detection is exposed;
- native-speaker review of representative output, punctuation, names, and each
  supported script;
- TTS listening review for each promised voice/language path;
- translation checks for every promised ordered direction;
- settings migration, model eligibility, adapter rejection, and incompatible
  model UX tests;
- an Obsidian smoke test covering selection, first-run/model state, and an
  unsupported-combination explanation.

The fixture is a repeatable regression floor, not a substitute for native
review. Preserve the results and the exact model revision in the request spec
or under `docs/quality/` when they become durable evidence.

### 6. Localize the UI only when it is ready

The plugin's locale mechanism can register a language independently from
dictation support. A new catalog must follow the existing `src/locales/`
pattern: English remains the typed source, placeholder and orphan-key parity
checks pass, and a native reviewer validates the actual Obsidian surfaces.

Partial catalogs are technically safe because English falls back per key, but
the product should describe them honestly. A reviewed full catalog is the bar
for claiming a localized UI.

### 7. Document the result

Update the request spec with the final matrix, quality evidence, decisions, and
non-goals. Update maintained architecture, catalog documentation, or release
notes only when the implementation ships. Do not create a speculative backlog
of all possible languages; the next request starts this same small process.

## Completion checklist

- [ ] Language identity, script policy, and user need are recorded.
- [ ] Exact-model capability matrix has no inferred cells.
- [ ] Lean/full/research scope and explicit non-goals are approved.
- [ ] Catalog and adapter validation are model-specific.
- [ ] Unsupported paths are blocked or explained before work starts.
- [ ] Focused automated evidence and native-language review are recorded.
- [ ] UI localization, if claimed, has a reviewed catalog and parity checks.
- [ ] Docs and release copy match the final, bounded capability promise.
