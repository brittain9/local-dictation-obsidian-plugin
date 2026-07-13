# First-class multilingual dictation

## Status and scope

Local Dictation is English-only today. This document defines the staged path to
first-class multilingual support; it does not authorize a language selector or
new catalog entries before the corresponding model and adapter paths are
verified end to end.

The current constraint exists at every layer:

- Every managed model in `native/catalog.json` has `languageTags: ["en"]`.
- `StartSessionCommand.language` is the literal type `'en'`, and the plugin sends
  that value from `DictationSessionController`.
- `App::resolve_runtime_model_path` rejects any language other than `en` before
  resolving the selected model. Batch adapters repeat the check through
  `validate_language`.
- Whisper, Cohere Transcribe, and Moonshine all advertise
  `LanguageSupport::EnglishOnly` and no language selection.
- Cohere decoding currently inserts the fixed `<|en|>` token. The current
  Moonshine streaming assets are English-only.

An upstream family supporting several languages therefore does not mean the
particular artifact, adapter, protocol, and product path support those languages.
Family marketing copy must not be used as model eligibility.

## Target invariants

Multilingual support is first-class only when all of these are true:

1. A selected language is persisted and restored, with an explicit policy for
   automatic detection and regional BCP 47 tags.
2. The model picker can determine whether each exact catalog model is eligible
   for that language. A family-level capability alone is insufficient: Whisper
   has both English-only and multilingual artifacts.
3. Session startup carries the selected language to the resolved adapter, which
   validates it against the resolved model rather than a global constant.
4. Raw transcription, context prompting, post-processing, and LLM transforms
   preserve the spoken language unless the user explicitly requests translation.
5. Unsupported combinations fail before audio capture with a specific,
   actionable message. They never silently fall back to English.

## Staged delivery

### 0. Truthful English-only UX

- State the current English-only product constraint during setup and model
  choice.
- Display catalog language metadata on model rows.
- Remove upstream language-count claims from product copy when the integration
  does not expose those languages.

### 1. Model-level language eligibility

- Make exact-model language support authoritative. `languageTags` can remain the
  catalog source for managed artifacts, but successful probes need an equivalent
  capability for external files.
- Separate family features (streaming, prompt support) from model-specific
  language support. Do not mark the whole Whisper family multilingual because a
  multilingual artifact exists.
- Define normalized supported tags and, separately, whether an adapter supports
  automatic detection. `all` is too weak when only a tested subset is eligible.
- Add only pinned artifacts whose license, hashes, tokenizer/graph shape,
  language behavior, and quality fixtures have been verified.

### 2. Persisted selection and protocol

- Add a persisted `dictationLanguage` setting with an explicit migration from
  the current implicit English default.
- Design the value as a normalized language tag plus an explicit `auto` state;
  do not overload an empty string.
- Widen the TypeScript start-session contract from `'en'` only after settings
  validation and model eligibility are in place. Preserve the language as a
  structured session value through the Rust protocol and worker metadata.
- In setup and Manage Models, disable or explain ineligible models before the
  user downloads them. Changing language must revalidate the current selection.

### 3. Adapter enablement

- **Whisper:** add verified multilingual artifacts, distinguish them from `.en`
  variants, pass the selected language or automatic-detection mode to
  whisper.cpp, and keep translation disabled by default.
- **Cohere Transcribe:** replace the fixed English prompt token with a tested
  language-token mapping. Enable only tags supported by the shipped tokenizer
  and decoder implementation, not the upstream family claim alone.
- **Moonshine:** keep the current streaming assets explicitly English-only until
  separately licensed multilingual artifacts and their streaming graph contract
  are integrated and quality-tested.
- Move the global native English rejection to resolved-model validation. Adapter
  capability failures must identify both language and model.

### 4. Context and cleanup semantics

- Audit initial prompts and note context with non-Latin text and mixed scripts.
  Byte/character budgets and token estimates must not assume English density.
- Make every built-in LLM transform explicitly preserve the transcript language
  and forbid implicit translation. Verify local and remote providers with the
  same contract.
- Review English phrase lists and ASCII-oriented heuristics in the hallucination
  filter before enabling each language. Language-specific rules should be gated,
  not applied globally.
- Confirm punctuation, capitalization, speaker labels, timestamps, and smart
  paragraphs remain structurally correct for the supported scripts.

### 5. Verification and release gate

- Unit-test tag normalization, model eligibility, persisted-settings migration,
  protocol round trips, and adapter rejection paths.
- Add pinned audio/text fixtures per enabled language for both accuracy and
  "does not translate" behavior. Include at least one non-Latin script before
  claiming general multilingual support.
- Add integration coverage for manual selection, automatic detection, wrong-model
  rejection, context prompting, LLM cleanup, and English regression.
- Document code-switching policy explicitly; do not imply it from monolingual
  fixtures.

The first multilingual release should enable a small, verified language/model
matrix. Breadth follows evidence; it is not a prerequisite for a sound model-level
architecture.
