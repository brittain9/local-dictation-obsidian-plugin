# Cutting a Release

Operational runbook for shipping a new plugin release. For the higher-level
distribution contract and readiness state, see [release-planning.md](release-planning.md).

## Versioning: `YYYY.M.MICRO`

Releases use CalVer `YYYY.M.MICRO` — e.g. `2026.6.11`. `MICRO` is a per-month
counter (the 11th release cut in June 2026), **not** the day of the month.

Format rules enforced by `scripts/read-release-version.mjs`:

- **Month** is `1`–`12` with **no leading zero** → `2026.6.11`, never `2026.06.11`.
- **MICRO** is currently constrained to `1`–`31` (a holdover from the old
  day-based scheme). If a month ever needs a 32nd release, relax
  `DATE_VERSION_PATTERN` in that script. Its error text also still reads
  "YYYY.M.D" — cosmetic.
- The git tag is **bare, no `v` prefix**, and must equal `manifest.json` exactly.

## Files that carry the version

`manifest.json` is the source of truth. All of these must agree, or the release
fails at the CI metadata gate:

| File | What to change |
| --- | --- |
| `manifest.json` | `version`. Bump `minAppVersion` **only** if the runtime floor actually changed. |
| `package.json` | `version`. |
| `native/Cargo.toml` | `version` of the `local-dictation-sidecar` crate. **Easiest one to forget — it's the Rust sidecar.** |
| `native/Cargo.lock` | the `version` under `[[package]] name = "local-dictation-sidecar"`. Keep in lock-step or the `--locked` build legs fail. |
| `versions.json` | add `"<version>": "<minAppVersion>"`. (Obsidian's min-app map; not checked by the version validator, but required by the store.) |
| `docs/release-notes/<version>.md` | new, non-empty, curated. Sections in order, omit empty: `## Highlights`, `## Fixes`, `## Performance`, `## Internal`. User-facing, plain language, one bold lead per bullet. |

`minAppVersion` and the `obsidian` devDependency are independent on purpose: the
floor can sit one patch above the typings (e.g. floor `1.11.5` for encryption at
rest while typings pin `1.11.4`, since `1.11.5` has no npm package).

## Pre-flight (run locally — mirrors the CI gate exactly)

From the repo root, after bumping all files:

```bash
node scripts/read-release-version.mjs --tag <version>      # manifest == package == native/Cargo.toml, and tag == version
node scripts/validate-release-notes.mjs --version <version> # notes file exists and is non-empty
npm run check                                               # typecheck, biome, eslint, vitest, frontend build, + cargo (rust)
```

If the first two print `<version>` with no error, the `metadata` job will pass.
Running these **before tagging** is the whole point of this doc — the gate that
just bit us (a stale `native/Cargo.toml`) is caught here in seconds.

## Cut it

```bash
# 1. Land all the bumps on main (PR, or direct — main is unprotected).
# 2. Tag main HEAD with the bare version and push:
git fetch origin
node scripts/read-release-version.mjs --tag <version>   # final check against the merged main content
git tag <version> origin/main
git push origin <version>                               # fires .github/workflows/release.yml
```

The workflow runs: `metadata` gate → `plugin-bundle` (`check:frontend`) + native
sidecar builds (macOS arm64, Linux x86_64 cpu+cuda, Windows cpu+cuda) →
`native-quality` → `publish` (creates a **draft** release with the notes file as
the body, then un-drafts it) → `release-report` (timing summary).

## Watch and verify

```bash
gh run watch <run-id> --exit-status   # do NOT pipe through `tail`/`head` — that masks the run's exit code
gh release view <version>             # confirm it published with sidecar assets attached
```

## Recovery

**Failed before publish** (metadata gate, build leg) — fix on main, then move the
tag onto the corrected commit:

```bash
git push origin :refs/tags/<version>   # delete the remote tag
git tag -d <version>                    # delete the local tag
git tag <version> origin/main           # re-tag the fixed HEAD
git push origin <version>               # re-fires the release
```

**Already published but wrong** — `gh release delete <version> --cleanup-tag`,
fix, re-tag. When replacing a live release, delete the old one only **after** the
new one publishes so "Latest" is never broken.

## Gotchas (learned the hard way)

- **`native/Cargo.toml` + `native/Cargo.lock` are the easy miss.** They live on
  the Rust side and aren't obvious from the JS bump. CI's metadata gate catches
  the `Cargo.toml`; the lock must match it or `cargo --locked` fails in the build
  legs. Always run the pre-flight.
- **Never pipe `gh run watch` through `tail`/`head`.** A pipeline's exit status
  is the last command's, so a failed run looks like success.
- **CUDA build legs are warm-cache fast** (~3 min) but cold runs are ~20+ min;
  don't assume a hang.
