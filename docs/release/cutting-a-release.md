# Cutting a Release

Operational runbook for shipping a new plugin release.

## Versioning: `YYYY.M.MICRO`

Releases use CalVer `YYYY.M.MICRO` — e.g. `2026.6.11`. `MICRO` is a per-month
counter (the 11th release cut in June 2026), **not** the day of the month.

Format rules enforced by `scripts/read-release-version.mjs`:

- **Month** is `1`–`12` with **no leading zero** → `2026.6.11`, never `2026.06.11`.
- **MICRO** is any non-negative integer with no leading zero. Start each month
  at `0`, then increment it for additional releases that month. It is not capped
  at 31 because it counts releases, not calendar days.
- The git tag is **bare, no `v` prefix**, and must equal `manifest.json` exactly.

## Files that carry the version

`manifest.json` is the source of truth. All of these must agree, or the release
fails at the CI metadata gate:

| File | What to change |
| --- | --- |
| `manifest.json` | `version`. Bump `minAppVersion` **only** if the runtime floor actually changed. |
| `package.json` | `version`. |
| `package-lock.json` | top-level `version` and the root package version under `packages[""]`. |
| `native/Cargo.toml` | `version` of the `local-dictation-sidecar` crate. |
| `native/Cargo.lock` | the `version` under `[[package]] name = "local-dictation-sidecar"`. |
| `versions.json` | add `"<version>": "<minAppVersion>"` for Obsidian's minimum-app map. |
| `docs/release/notes/<version>.md` | new, non-empty, curated release notes. |

Do not update historical version examples in specifications, tests, or media
capture records just because they mention the previous release.

`minAppVersion` and the `obsidian` devDependency are independent on purpose: the
floor can sit one patch above the typings (e.g. floor `1.11.5` for encryption at
rest while typings pin `1.11.4`, since `1.11.5` has no npm package).

## Prepare the release PR

Release tooling changes must land in their own PR before the release metadata
PR. That keeps the release PR mechanical and ensures it uses the exact checks
that will validate it.

Start from a clean branch and supply the version explicitly:

```bash
git switch -c chore/release-<version>
npm run release:prepare -- --version <version>
```

The command validates the current release state before changing anything,
updates every version-bearing file above, and creates a comments-only notes
scaffold. It refuses to overwrite existing notes. To change the Obsidian floor
for a release, pass `--min-app-version <version>`; otherwise the current floor
is preserved.

### Curate release notes

Review the merged changes since the previous tag using their PR descriptions,
tests, code, and user documentation. Do not turn commit subjects into a raw
changelog. Write for plugin users and describe outcomes rather than internal
types or implementation mechanics.

Use these sections in order and omit empty ones: `## Highlights`,
`## Improvements`, `## Fixes`, `## Performance`, `## Compatibility`,
`## Known Limitations`, `## Internal`.

- Put the most important features first.
- Aim for 3–8 user-visible bullets total, with one bold lead per bullet.
- Keep each bullet to one concise paragraph.
- Allow at most one `Internal` bullet, reserved for engineering work that
  materially improves release confidence or maintainability.
- Exclude routine tests, refactors, dependency bumps, statistics, and
  documentation-only changes unless users must act on them.

The notes validator intentionally enforces only curated, non-comment content;
review owns prose quality rather than a brittle style linter.

### Reconcile documentation

Before opening the release PR, compare the release range and make an explicit
documentation decision for every user-visible or architectural change:

```bash
previous_tag=$(git describe --tags --abbrev=0)
git log --oneline "$previous_tag"..HEAD
git diff --name-only "$previous_tag"..HEAD
```

- Update the README or guides when onboarding, requirements, settings, or
  user workflows changed.
- Update `docs/system-architecture.md` when ownership boundaries, lifecycle,
  data flow, or failure containment changed.
- Use the release notes for behavior worth announcing that does not need
  durable standalone documentation.
- Record "no documentation change needed" in the PR when the audit finds no
  durable gap.

## Pre-flight (run locally — mirrors the CI gate exactly)

From the repo root, after bumping all files:

```bash
npm run check:release
node scripts/read-release-version.mjs --tag <version>
npm run check
```

`check:release` verifies every metadata mirror, the current `versions.json`
mapping, and curated notes. Normal PR CI and the tag workflow run the same gate.
The explicit tag check must print `<version>` with no error.

When a release changes settings behavior or its Obsidian API usage, also
complete the [Obsidian settings compatibility matrix](../guides/obsidian-settings-compatibility-testing.md).
Its exact 1.11.5 runtime row remains required while `manifest.json` declares
1.11.5, even when the supported-floor typecheck passes.

## Cut it

### Time budget

The primary metric is **release intent to published assets**. Feature completion
and the duration shown on `release.yml` are not substitutes for that end-to-end
lead time. When benchmarking a release, record when the release was requested
alongside the published timestamp.

The operating target is 30 minutes end to end when release notes are ready for
review. Its machine-measurable service target is publication within 25 minutes
of the tag-triggered workflow starting. Release preparation, PR checks, review,
and the merge-to-tag interval still count toward the primary metric; do not hide
them by reporting only the tagged workflow.

The tagged workflow is the only production build. Default-branch Rust and CUDA
toolkit caches may accelerate it, but release publication never waits for a separate
full-build warmer.

This architecture is based on measured end-to-end evidence from issue #306. For
`2026.7.11`, the mandatory warmer consumed 23m20s and did not accelerate the
already-running tagged build; merge-to-publication took 36m48s while the tagged
workflow itself took 17m. For `2026.8.0`, the same two-stage path spent 18m35s
warming before a 16m45s tagged release. Removing the gate eliminates that duplicate
critical-path work while leaving the authoritative tagged build, five native assets,
checksums, and provenance unchanged.

```bash
# 1. Land all the bumps on main via a PR — main is protected, so direct
#    pushes are rejected by branch-protection rules.
# 2. Resolve and validate the exact main commit to release:
git fetch origin
main_sha=$(git rev-parse origin/main)
npm run check:release
node scripts/read-release-version.mjs --tag <version>   # final check against the merged main content
test "$(git rev-parse origin/main)" = "$main_sha"         # main did not move during validation

# 3. Tag that validated commit with the bare version and push immediately:
git tag <version> "$main_sha"
git push origin <version>                               # fires .github/workflows/release.yml
```

The workflow runs: `metadata` validation → production plugin + native sidecar
builds (macOS arm64, Linux x86_64 cpu+cuda, Windows cpu+cuda) → package and
attest the final assets → `publish` (creates a **draft** release with the notes
file as the body, then un-drafts it) → `release-report` (timing summary).
Unit, lint, and static-analysis gates run on pull requests and `main` in
`ci.yml`; real-model certification runs in the scheduled or manually
dispatchable E2E workflows and does not delay publication.

## Watch and verify

```bash
gh run watch <run-id> --exit-status   # do NOT pipe through `tail`/`head` — that masks the run's exit code
gh release view <version>             # confirm it published with sidecar assets attached
```

## What ships, and where it lands

A release is one GitHub Release tagged `<version>`, carrying the plugin files and
the sidecar archives:

- `main.js`, `manifest.json`, `styles.css` — what Obsidian's updater fetches.
- `sidecar-macos-arm64.tar.gz` — Whisper Metal + ONNX model families on CPU.
- `sidecar-linux-x86_64-cpu.tar.gz`, `sidecar-linux-x86_64-cuda.tar.gz`.
- `sidecar-windows-x86_64-cpu.tar.gz`, `sidecar-windows-x86_64-cuda.tar.gz`.
- `checksums.txt` — SHA-256 of every sidecar archive, exactly five lines, sorted.

CUDA archives bundle the reviewed whisper.cpp CUDA runtime libraries declared in
`native/cuda-artifacts.json`. Current ONNX model families run on CPU in every
archive. The macOS sidecar is ad-hoc signed before packaging.

Cross-platform release-build invariants live in
`.github/release-build-config.json`; the metadata job resolves that file once
and feeds every native release leg. Its CUDA architecture targets one
forward-compatible Turing PTX variant, and its `GGML_NATIVE` setting prevents
sidecars from inheriting runner-only CPU SIMD. The bundled CUDA runtime
libraries ship after CUDA EULA review.

Obsidian's updater only replaces `main.js`/`manifest.json`/`styles.css`, so the
plugin installs the sidecar itself: it downloads the archive matching
`manifest.version`, verifies it against `checksums.txt`, and unpacks into
`<vault>/.obsidian/plugins/local-dictation/bin/cpu/` or `bin/cuda/`.
`resolveSidecarExecutablePath()` then picks the binary in order — `sidecarPathOverride`,
then plugin-local `bin/cpu`/`bin/cuda` (by acceleration preference and host
support), then a dev build under `native/target[-cuda]/debug`. Because the updater
never touches the installed sidecar, the plugin compares its recorded version
(`bin/<variant>/install.json`) against `manifest.version` on startup and offers a
one-click reinstall when they drift.

## Recovery

**Failed before publish** (metadata gate, build leg) — land the fix on main (via
PR), then move the tag onto the corrected commit:

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

- **Do not hand-edit a subset of version files.** Run `release:prepare`; the
  metadata gate checks JavaScript, Rust, both lockfiles, and `versions.json`.
- **Never pipe `gh run watch` through `tail`/`head`.** A pipeline's exit status
  is the last command's, so a failed run looks like success.
- **Do not add a full-build pre-release warmer.** The release workflow builds and
  attests the authoritative tagged artifacts once. Default-branch caches are an
  opportunistic optimization, never a gate.
- **CUDA build legs are warm-cache fast** (~3 min) but cold runs can take 20+
  minutes; don't assume a hang while the 25-minute workflow budget remains intact.
