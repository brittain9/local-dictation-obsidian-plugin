# Spec: UI localization

Status: implemented. Follow-up to [multilingual-support.md](multilingual-support.md), which delivered multilingual dictation (Whisper Large V3 Turbo, Nemotron 3.5 ASR) and explicitly left plugin UI localization out of scope.

## Product goal

When Obsidian's UI language is one of the languages this plugin can transcribe, every string the plugin renders — commands, settings, wizard, sidebar, notices, errors — appears in that language. The plugin should feel Obsidian-native for a Spanish or Japanese user the same way it does for an English user today. English stays the source of truth and the universal fallback: an unsupported locale or a missing key always degrades to correct English, never to a blank or a key name.

## Out of scope

- Localizing the Rust sidecar. All translation lives in the TypeScript plugin (see D4).
- `manifest.json` name/description — Obsidian does not localize plugin manifests.
- Log output (`plugin-logger`, sidecar logs) and error `code` values — these stay English/machine-readable for supportability.
- README and docs translation.
- Right-to-left layout. No RTL language is in the target set.
- Translating transcribed text (that is dictation, not UI).

## Locale policy

- Shipped locales are exactly the verified dictation languages: `en`, `es`, `de`, `fr`, `pt`, `it`, `nl`, `ja` — mirroring `VERIFIED_MULTILINGUAL_LANGUAGE_TAGS` in `native/src/transcription.rs`. All eight are also Obsidian UI languages, so users in the target audience really do run Obsidian in these locales.
- The coupling is policy, not code: locale resolution supports whatever catalogs are registered under `src/locales/`, with no reference to the dictation-language constant. A community-contributed catalog for any other Obsidian locale (e.g. `zh`) only needs its catalog module and an entry in `src/locales/index.ts`; dictation code remains untouched.
- Locale is resolved once at plugin load via `getLanguage()` from `'obsidian'` (API ≥ 1.8.7; our `minAppVersion` is 1.11.5). Obsidian relaunches when the user changes language, so no live re-render path is needed.
- Regional tags match on the base subtag: `pt-BR` → `pt`, `de-AT` → `de`. Anything else (`ru`, `zh`, …) → `en`.

## Design decisions

### D1 — Typed in-house `t()`, no i18n library

`src/shared/i18n.ts` exports `t(key, params?)`. The English catalog (`src/locales/en.ts`) is the source of truth; `type TranslationKey = keyof typeof en` gives compile-time key safety at every call site. Other locales are `Partial<Record<TranslationKey, string>>`; lookup falls back to `en` per key. Interpolation is `{placeholder}` substitution with `Record<string, string | number>` params.

i18next is rejected: it adds a dependency and runtime machinery (namespaces, lazy loading, plural chains) that a single-bundle Obsidian plugin does not need. esbuild inlines the catalog modules with zero config changes. The few pluralized strings (e.g. `getSidecarUpdateCopy`) use explicit `_one`/`_other` key variants selected via `Intl.PluralRules` — no plural DSL.

### D2 — Key structure

Flat dot-namespaced keys grouped by surface: `commands.toggleDictation`, `settings.dictationLanguage.name`, `settings.dictationLanguage.desc`, `notice.microphoneDisconnected`, `setup.welcome.title`, `models.progress.downloading`. One module per locale under `src/locales/`. English literals migrate verbatim (Obsidian sentence-case conventions apply per locale). The two existing key/value-shaped copy modules — `FEEDBACK_FAILURES` in `src/dictation/dictation-session-controller.ts` and `InstallCopy` in `src/setup/sidecar-install-copy.ts` — convert first; they already have the right shape.

### D3 — Every user-visible string goes through `t()`

In scope: the 11 command names in `src/commands/register-commands.ts`, ribbon tooltips, the settings tab and all settings sections/modals, the sidebar view, preset manager, setup wizard, sidecar install copy, model management and install-progress labels, every `feedback.show({ message })` call site (~58 messages funneled through `obsidian-feedback-presenter.ts`), validation and confirm-modal text.

Excluded: developer-mode diagnostics. Its audience is developers and the copy churns; it stays English.

### D4 — Sidecar boundary: translate by `code`, never by `message`

Today the plugin renders sidecar `ErrorEvent`/`WarningEvent.message` strings verbatim (`sidecar-connection.ts`, `dictation-session-controller.ts#handleErrorEvent`), so Rust literals leak into the UI in English. Every event already carries a machine `code`. The plugin gains a `sidecarError.<code>` key per known code; the Rust `message`/`details` demote to log detail and to the fallback shown for unknown codes. Rust ships zero translations, and sidecar releases stay decoupled from translation updates. Stage 3 includes an inventory of emitted codes and a test asserting every inventoried code has a key.

### D5 — Model catalog strings

`displayName` values ("Whisper Large V3 Turbo", "whisper.cpp") are product names and are never translated. Catalog `summary` texts are delivered over the wire from `native/catalog.json`; they localize in this PR via a plugin-side `catalog.<modelId>.summary` lookup keyed by model ID. The wire `summary` remains the fallback for model IDs the shipped catalogs don't know (models added server-side after release show English until the next plugin update).

### D6 — Dictation-language dropdown shows endonyms

`DICTATION_LANGUAGE_OPTIONS` labels change from English exonyms to endonyms — `Español`, `Deutsch`, `Français`, `日本語` — matching Obsidian's own language picker, so the dropdown is readable regardless of UI locale. `Auto detect` and the `(unsupported)` suffix localize through `t()`.

### D7 — Translation sourcing

`en` is the source catalog. The seven other catalogs are LLM-drafted, then independently reviewed against English for semantic accuracy, natural UI language, technical terminology, and behavior-preserving prompt instructions. Corrections continue through normal PRs using the workflow in `CONTRIBUTING.md`. A missing key is legal and falls back to English, so adding an English string never blocks on seven translations; coverage is visible via the parity test's report.

### D8 — Enforcement

A vitest parity test (runs in `npm run check` from Stage 0) fails on orphan keys (present in a locale but not in `en`) and on interpolation-placeholder mismatches between a translation and its English source; missing translations only warn with a coverage summary. No lint rule banning raw literals in v1 — too noisy; code review carries that line, revisit if regressions appear.

## Staged delivery

The whole feature ships in this PR. Stages are ordered checkpoints — each lands as one or more commits with `npm run check` green, so the branch is reviewable stage by stage and bisectable. Stages 0–3 are English-only refactors with no visible behavior change.

0. Infrastructure: `i18n.ts`, `en` catalog seeded from `FEEDBACK_FAILURES` + `sidecar-install-copy.ts`, locale resolution via `getLanguage()`, parity test.
1. High-traffic surfaces: commands, ribbon, settings tab + sections/modals, all `feedback.show` messages.
2. Setup wizard, sidecar install modals, model management and progress labels.
3. Sidecar `code` → key mapping (D4), including the code inventory and its parity test.
4. Ship the seven non-English catalogs including catalog summaries (D5), endonym dropdown (D6), translation contribution docs, release-notes entry.

## Verification

- `npm run check` green at every stage; parity test active from Stage 0.
- Tests stay English: the central `test/__mocks__/obsidian.ts` mock stubs `getLanguage()` to `'en'`, so `t()` resolves to the verbatim-migrated English literals and existing string assertions pass unchanged. Tests never assert on keys or non-English catalogs.
- Manual pass at Stage 4 in `es` and `ja` (Latin + CJK): setup wizard end-to-end, settings tab, a dictation session, model install, and an error path (kill the sidecar; the notice must be localized).
- Overflow spot-check in `de` (longest strings) across settings and modals.
- Fallback check: Obsidian set to an out-of-set locale (e.g. `ru`) renders a fully English UI with no key names visible.

## Risks

- Translations can still contain locale-specific phrasing defects despite independent review. Per-key English fallback and small correction PRs keep fixes low-cost.
- Copy churn on evolving surfaces (wizard, settings) produces temporarily mixed-language UI in non-English locales. Accepted trade-off of the soft-fallback policy.
- Bundle growth: eight inline catalogs including catalog summaries, estimated low tens of KB in `main.js` — negligible.

Resolved decisions (2026-07-18): all text ships fully localized in this PR, including catalog summaries (D5) — nothing deferred; translations are LLM-drafted, independently reviewed, and shipped without a beta framing (D7); translation coverage never hard-fails CI — fallback + coverage report is permanent (D8); shipped locales stay the eight dictation languages but the code accepts any registered contributed catalog (Locale policy); dropdown labels are endonym-only (D6).
