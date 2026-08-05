# Rebrand: Local Dictation → Speech Kit

Status: ready for implementation
Base: `origin/main` at or after the translation merge (#332, release 2026.7.12)

## Context

The plugin has grown from local dictation into a speech and language toolkit: live/batch dictation, meeting transcription with diarization and timestamps, local translation (Bergamot), and local read aloud (Pocket TTS, Supertonic). The product is being renamed **Speech Kit**. Positioning source of truth: `docs/marketing/README.md` (already updated). The root `README.md` is already rewritten for Speech Kit — do not regenerate it; treat it as final copy.

This is a **surface rebrand**. User-visible brand strings change; persisted and protocol-level identifiers do not.

## Invariants — MUST NOT change

These break users if touched. Any occurrence of `local-dictation` below stays exactly as is:

| Identifier | Where | Why it must stay |
| --- | --- | --- |
| Plugin ID `local-dictation` | `manifest.json` `id`, `package.json` `name` | Obsidian plugin IDs are immutable. Changing the ID makes it a new plugin: settings, hotkeys, download count (~1k), and the listing URL are all keyed to it. |
| Command IDs (`toggle-dictation`, `translate-note`, …) | `src/commands/register-commands.ts` | User hotkeys are persisted as `local-dictation:<command-id>`. Only display names (locale strings) may change. |
| View type `local-dictation-sidebar` | `src/ui/local-dictation-view.ts` | Persisted in workspace layout. |
| Settings keys / `data.json` shape | `src/settings/plugin-settings.ts` | Existing user settings must load unchanged. No migration code for a rename. |
| Secret ID `local-dictation-openrouter-api-key` | `src/settings/openrouter-secret-storage.ts` | Stored in Obsidian secret storage; renaming loses user keys. |
| Sidecar binary name `local-dictation-sidecar` + release asset names | `native/Cargo.toml`, `.github/workflows/release.yml`, `src/sidecar/sidecar-executable.ts` | Installer matching, attestation subjects, e2e harnesses, existing installs. Renaming is deferred (see Deferred section). |
| CSS class prefixes `local-dictation-*` | `styles.css`, `src/ui/*` | Internal; renaming is churn with zero user value. May collide with user CSS snippets if changed. |
| Model/cache directory names, temp-dir prefixes | `native/src/*` | Existing installed models and caches must be found. |
| Sidecar protocol strings and HTTP user-agent | `src/sidecar/*`, `native/src/*` | Internal contract; not worth a compatibility dance. |
| Historical docs | `docs/release/notes/*`, `docs/quality/**`, existing `docs/specs/*`, `docs/marketing/readme-variants/*` | They are records of the past. Never mass-sed them. |

Corollary: **do not run a repo-wide sed**. Every replacement must be in the explicit scope below.

## Stage 1 — In-repo rename (one PR)

Replace the user-visible brand string `Local Dictation` → `Speech Kit` in:

1. **`manifest.json`** — `name: "Speech Kit"`, and description (mirror to `package.json.description`):
   `Local speech and language toolkit for notes. Dictate, transcribe meetings, translate text, and read notes aloud with on-device models.`
   Keep `id`, bump nothing here (version bump happens in the release PR per `docs/release/cutting-a-release.md`). Update `helpUrl` after the repo rename (Stage 2) to the new repo URL.
2. **Locale files `src/locales/{en,es,de,fr,it,ja,nl,pt}.ts`** — every literal `Local Dictation` (~26–29 per file) becomes `Speech Kit` untranslated in all eight locales (brand names are not translated; ja keeps the Latin-script name). Read each file after replacement to confirm no sentence grammar breaks (e.g., articles like "el/le/die Local Dictation" constructions).
3. **`src/` user-visible strings not yet routed through i18n** — audit these files, which contain the literal today: `src/main.ts`, `src/settings/plugin-settings.ts`, `src/setup/setup-wizard-modal.ts`, `src/shared/user-feedback.ts`, `src/shared/plugin-logger.ts` (log prefix `[Local Dictation]` → `[Speech Kit]` is fine — logs are user-visible in the dev console). Change display strings only, never identifiers.
4. **`native/catalog.json` and `native/src/app.rs`** — update copy that reaches the UI (model catalog descriptions/guidance). Leave identifiers, paths, and protocol values alone.
5. **`native/src/system_audio/linux.rs`** — the PulseAudio/PipeWire application name `c"local-dictation"` → `c"Speech Kit"`. This is what users see in their volume mixer. Trade-off: per-app volume memory keyed on the old name resets once; acceptable.
6. **Current docs** — `CONTRIBUTING.md`, `docs/system-architecture.md`, `docs/guides/*.md`, `docs/media/README.md`, `THIRD_PARTY_NOTICES.md` header, `.github/ISSUE_TEMPLATE/bug-report.yml`. Brand references only; repo URLs are handled in Stage 2. Where a doc explains history ("Local Dictation started as…"), keep the old name in the historical sentence.
7. **Tests** — update assertions that pin the brand string: `test/i18n.test.ts`, `test/dictation-ribbon.test.ts`, `test/dictation-session-controller.test.ts`, and any others `rg -l "Local Dictation" test/` finds.
8. **Release note** for the rebrand release (`docs/release/notes/<next-version>.md`): lead with "Local Dictation is now Speech Kit", explain nothing changes for existing users (settings, hotkeys, models, listing URL all carry over), then the release's functional changes.

Optional in the same PR (cheap, internal, safe): rename TypeScript class `LocalDictationView` and similar class/type names. Do NOT rename files or exported constants whose string values are invariants (`LOCAL_DICTATION_VIEW_TYPE`'s *value* stays; the constant name may stay too to avoid noise).

### Acceptance for Stage 1

- `rg -i "local dictation" src/ native/src/ native/catalog.json manifest.json styles.css` returns only invariant identifiers (kebab-case `local-dictation-*`), no display-text hits.
- `npm run check` passes (this also gates lint + tests; note it forces all engine features).
- `cargo test` in `native/` passes without feature flags (see the default-features gating gotcha).
- Manual: build into a scratch vault over an existing Local Dictation install — settings, hotkeys, installed models, and sidebar view all survive; command palette shows "Speech Kit: …"; ribbon tooltip and settings tab show the new name; each of the 8 UI languages spot-checked for the brand string.

## Stage 2 — GitHub repo rename

1. Rename `brittain9/local-dictation-obsidian-plugin` → `brittain9/speech-kit-obsidian-plugin` (GitHub Settings → General). GitHub redirects old web, git, API, and release-asset URLs, so nothing breaks immediately — but redirects die if the old name is ever reused, so treat them as transitional only.
2. Follow-up PR (or same PR as Stage 1, merged after the rename) updating every in-repo occurrence of `brittain9/local-dictation-obsidian-plugin`: `manifest.json` (`helpUrl`), `README.md` (already written against the new URL), `CONTRIBUTING.md`, docs, `.github/` templates and workflows, `scripts/*` (`rg -l "local-dictation-obsidian-plugin"` for the full list). Workflows using `${{ github.repository }}` need no change.
3. **stats-history branch**: check its workflow/scripts for a hardcoded repo slug and update on that branch (do not delete or rebase it — it is the only long-term traffic record). Download-count tracking keys on the plugin ID, which is unchanged.
4. Update local remotes: `git remote set-url origin git@github.com:brittain9/speech-kit-obsidian-plugin.git`.
5. Update GitHub About description, website, and topics per `docs/marketing/README.md`.

## Stage 3 — Obsidian directory rename

1. PR to `obsidianmd/obsidian-releases` editing the existing `community-plugins.json` entry for id `local-dictation`: `"name": "Speech Kit"`, `"repo": "brittain9/speech-kit-obsidian-plugin"`. Keep `"id"` untouched. Reference the repo rename in the PR description; renames of existing plugins are routine but reviewed by the Obsidian team, so expect days–weeks of latency.
2. The listing URL `https://obsidian.md/plugins?id=local-dictation` and `community.obsidian.md/plugins/local-dictation` remain valid forever (ID-keyed) — all install links keep working.
3. After the PR merges, manually update the Obsidian listing short and long descriptions per `docs/marketing/README.md`.

Registry check (done 2026-07-28): no existing community plugin is named "Speech Kit" or anything close; nearest neighbors are single-capability plugins ("Text to Speech", "Speech to Text", "Whisper", "Translate").

## Stage 4 — Release and announcement

1. Cut the rebrand release per `docs/release/cutting-a-release.md` — all five version files (`manifest.json`, `package.json`, `native/Cargo.toml`, `native/Cargo.lock`, `versions.json`) plus the release-notes file; pre-flight with `scripts/read-release-version.mjs`; push the bare calver tag.
2. Prefer landing the rebrand in a release **after** the obsidian-releases PR is merged, so the in-app name and the directory name flip close together. If review drags, shipping first is acceptable — the mismatch window ("Speech Kit" in-app, "Local Dictation" in the directory) is cosmetic.
3. Discord/announcement post: reuse the release-note narrative. Keep "formerly Local Dictation" in outbound copy for ~3 releases (per marketing doc).

## Deferred (explicitly out of scope)

- Renaming the sidecar binary and release assets (`local-dictation-sidecar` → e.g. `speech-kit-sidecar`). Doable atomically in a later release (installer fetches assets from its own version's release), but it touches attestation, e2e drivers, and orphan-cleanup of old binaries. Not worth coupling to the brand flip.
- CSS class prefix rename, npm `package.json` `name` field, view-type string — internal, likely never worth changing.
- New logo/icon and screenshot pass — separate marketing effort (`docs/marketing/README.md`, Deferred visual work).

## Risks

- **Search continuity**: "obsidian local dictation" has accumulated SEO. Mitigated by GitHub redirects, the unchanged listing URL, and "formerly Local Dictation" in README/listing/announcements.
- **Name adjacency**: "SpeechKit" (one word) is used by Yandex's cloud speech API and was Nuance's old SDK. The two-word "Speech Kit", scoped to an Obsidian plugin, is distinct in category and registry, and — being local-first — is the opposite of those cloud products. Low practical risk; do not use the one-word form anywhere.
- **Locale grammar**: mechanical replacement inside eight languages can produce awkward sentences. The per-locale read-through in Stage 1.2 is mandatory, not optional.
