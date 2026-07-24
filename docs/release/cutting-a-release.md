# Cutting a Release

Operational runbook for shipping a new plugin release.

## Versioning: `YYYY.M.MICRO`

Releases use CalVer `YYYY.M.MICRO` — e.g. `2026.6.11`. `MICRO` is a per-month
counter (the 11th release cut in June 2026), **not** the day of the month.

Format rules enforced by `scripts/read-release-version.mjs`:

- **Month** is `1`–`12` with **no leading zero** → `2026.6.11`, never `2026.06.11`.
- **MICRO** is any positive integer with no leading zero. It is not capped at
  31 because it counts releases, not calendar days.
- The git tag is **bare, no `v` prefix**, and must equal `manifest.json` exactly.

## Plugin and sidecar versions

Plugin and sidecar versions advance independently. `manifest.json` is the source
of truth for the plugin release; its mirrors must agree on every release:

| File | What to change |
| --- | --- |
| `manifest.json` | `version`. Bump `minAppVersion` **only** if the runtime floor actually changed. |
| `package.json` | `version`. |
| `package-lock.json` | top-level `version` and the root package version under `packages[""]`. |
| `versions.json` | add `"<version>": "<minAppVersion>"` for Obsidian's minimum-app map. |
| `docs/release/notes/<version>.md` | new, non-empty, curated release notes. |

`sidecar-version.json` is the source of truth for the sidecar release required
by the plugin bundle. `native/Cargo.toml` and the `local-dictation-sidecar`
entry in `native/Cargo.lock` must match it. The value is the GitHub release tag
that contains the compatible sidecar archives, so it may be older than the
plugin version but never newer.

Do not update historical version examples in specifications, tests, or media
capture records just because they mention the previous release.

`minAppVersion` and the `obsidian` devDependency are independent on purpose: the
floor can sit one patch above the typings (e.g. floor `1.11.5` for encryption at
rest while typings pin `1.11.4`, since `1.11.5` has no npm package).

## Prepare the release PR

Release tooling changes must land in their own PR before the release metadata
PR. That keeps the release PR mechanical and ensures it uses the exact checks
that will validate it.

Start from a clean branch and supply the plugin version explicitly. The default
is a plugin-only release: it preserves `sidecar-version.json`, publishes no
native archives, and lets both existing and new installations reuse the last
compatible sidecar:

```bash
git switch -c chore/release-<version>
npm run release:prepare -- --version <version>
```

Only when the release must ship changed native code, add `--sidecar`:

```bash
npm run release:prepare -- --version <version> --sidecar
```

That flag advances `sidecar-version.json` and both Cargo mirrors to the new
plugin tag. The release workflow then builds and attaches the complete sidecar
set. The command validates the current release state before changing anything
and creates a comments-only notes scaffold. It refuses to overwrite existing
notes. To change the Obsidian floor, also pass `--min-app-version <version>`;
otherwise the current floor is preserved.

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
node scripts/read-sidecar-version.mjs
npm run check
```

`check:release` verifies every metadata mirror, the current `versions.json`
mapping, the sidecar-to-plugin ordering, and curated notes. Normal PR CI and the
tag workflow run the same gate. The explicit tag check must print `<version>`
with no error. Record the sidecar version printed by the third command; when it
equals `<version>`, this is a sidecar release. Otherwise it is plugin-only.

## Cut it

```bash
# 1. Land all the bumps on main via a PR — main is protected, so direct
#    pushes are rejected by branch-protection rules.
# 2. Resolve whether this tag publishes a sidecar:
git fetch origin
main_sha=$(git rev-parse origin/main)
plugin_version=$(node scripts/read-release-version.mjs)
sidecar_version=$(node scripts/read-sidecar-version.mjs)

# 3-4. SIDECAR RELEASES ONLY: wait for the exact-commit Windows CUDA warm and
#      inspect the cache families. Plugin-only releases bypass this block.
if [[ "$plugin_version" == "$sidecar_version" ]]; then
  gh run list --workflow windows-cuda-cache.yml --commit "$main_sha" --limit 1
  # If no run exists, or the matching run needs a clean retry:
  gh workflow run windows-cuda-cache.yml --ref main
  run_id=$(gh run list --workflow windows-cuda-cache.yml --commit "$main_sha" --limit 1 --json databaseId --jq '.[0].databaseId')
  test -n "$run_id"
  gh run watch "$run_id" --exit-status

  gh cache list --ref refs/heads/main --limit 100 --json key,ref,createdAt,lastAccessedAt --jq \
    '.[] | select(.key | startswith("cuda-Windows-") or contains("sidecar-windows-x86_64-cuda"))'
fi

# 5. Tag main HEAD with the bare version and push:
npm run check:release
node scripts/read-release-version.mjs --tag <version>   # final check against the merged main content
git tag <version> origin/main
git push origin <version>                               # fires .github/workflows/release.yml
```

The workflow always validates metadata and builds the production plugin. When
the plugin and sidecar versions match, it also builds the native matrix (macOS
arm64, Linux x86_64 cpu+cuda, Windows cpu+cuda), packages the archives, and
generates checksums. When they differ, every native release job is skipped.
Both paths attest the plugin assets, create a **draft** release with the notes
file as the body, publish it, and produce the timing report.
Unit, lint, and static-analysis gates run on pull requests and `main` in
`ci.yml`; real-model certification runs in the scheduled or manually
dispatchable E2E workflows and does not delay publication.

## Watch and verify

```bash
gh run watch <run-id> --exit-status   # do NOT pipe through `tail`/`head` — that masks the run's exit code
gh release view <version>             # confirm the expected asset set was published
```

## What ships, and where it lands

Every GitHub Release carries the plugin files Obsidian installs:

- `main.js`, `manifest.json`, `styles.css` — what Obsidian's updater fetches.

A sidecar release additionally carries:

- `sidecar-macos-arm64.tar.gz` — Whisper Metal + Cohere CPU.
- `sidecar-linux-x86_64-cpu.tar.gz`, `sidecar-linux-x86_64-cuda.tar.gz`.
- `sidecar-windows-x86_64-cpu.tar.gz`, `sidecar-windows-x86_64-cuda.tar.gz`.
- `checksums.txt` — SHA-256 of every sidecar archive, exactly five lines, sorted.

CUDA archives also bundle the ONNX Runtime provider libraries and the reviewed
CUDA runtime libraries declared in `native/cuda-artifacts.json`. The macOS sidecar
is ad-hoc signed before packaging.

Cross-platform release-build invariants live in
`.github/release-build-config.json`; the metadata job resolves that file once
and feeds every native release leg. Its CUDA architecture targets one
forward-compatible Turing PTX variant, and its `GGML_NATIVE` setting prevents
sidecars from inheriting runner-only CPU SIMD. On licensing: the ONNX Runtime
provider libraries are MIT and safe to bundle; the bundled CUDA runtime
libraries ship after CUDA EULA review; cuDNN is NVIDIA-licensed and is **not**
bundled, so Cohere CUDA users supply it themselves.

Obsidian's updater only replaces `main.js`/`manifest.json`/`styles.css`, so the
plugin installs the sidecar itself. It downloads the archive from the release
tag compiled from `sidecar-version.json`, verifies it against that release's
`checksums.txt`, and unpacks into
`<vault>/.obsidian/plugins/local-dictation/bin/cpu/` or `bin/cuda/`.
`resolveSidecarExecutablePath()` then picks the binary in order — `sidecarPathOverride`,
then plugin-local `bin/cpu`/`bin/cuda` (by acceleration preference and host
support), then a dev build under `native/target[-cuda]/debug`. Because the updater
never touches the installed sidecar, the plugin compares its recorded version
(`bin/<variant>/install.json`) against the required sidecar version on startup.
A plugin-only update therefore produces no sidecar prompt; advancing the
sidecar version offers a one-click update.

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

- **Do not hand-edit a subset of version files.** Run `release:prepare`; add
  `--sidecar` only when native binaries must ship. The metadata gate checks the
  plugin mirrors, sidecar metadata, Cargo mirrors, and `versions.json`.
- **Do not delete a referenced sidecar release.** New installations of a newer
  plugin-only release still download its compatible binaries and checksums from
  that historical tag.
- **Never pipe `gh run watch` through `tail`/`head`.** A pipeline's exit status
  is the last command's, so a failed run looks like success.
- **For sidecar releases, wait for `windows-cuda-cache` before tagging.** GitHub
  lets a release tag restore caches created on the default branch, but it cannot
  restore a cache created by a different release tag. The warmer must finish at
  the exact `origin/main` commit being tagged. Plugin-only releases skip it.
- **CUDA build legs are warm-cache fast** (~3 min) but cold runs are ~20+ min;
  don't assume a hang.
