# Spec: Download & Usage Stats

Status: approved for implementation
Related: none (no issue — small enough to spec-and-build directly)

## Product goal

This plugin does not and will not ship telemetry — it is a local, privacy-first
tool. But GitHub and the Obsidian community registry already record usage
signals server-side as a byproduct of hosting releases, and that data is
reachable only through API calls that nobody runs. This gives the maintainer
an on-demand script for "how is this actually being used" without adding a
single line of client-side instrumentation.

## Non-goals

- No telemetry, analytics SDK, or any code shipped in `main.js`. Every data
  source here is something GitHub/Obsidian already collects independently of
  this plugin's code.
- No dashboard, no third-party analytics service, no PII. Aggregate counts
  only.
- No attempt to deduplicate CI/bot downloads or distinguish CDN mirrors —
  GitHub's counters are what they are; the script reports them as-is.

## Data sources

### 1. Release assets (`GET /repos/{repo}/releases`, paginated)

Cumulative per-asset `download_count`, forever, per release. No auth beyond a
normal `gh` token (read-only, public repo). Derivations:

- **Install/update proxy**: `main.js` download count, not `manifest.json`.
  Obsidian and BRAT poll `manifest.json` on every update check regardless of
  whether the user installs, which inflates it relative to actual installs
  (verified 2026.7.2: manifest 85 vs main.js 83 — small but consistent gap).
- **Platform / acceleration split**: sidecar archive filenames encode this
  directly — `sidecar-{linux,windows,macos}-{x86_64,arm64}-{cpu,cuda}.tar.gz`.
  Summing across releases gives an OS and CPU-vs-CUDA breakdown.
- **Limitation**: counts are cumulative snapshots at fetch time, not a time
  series. Two fetches days apart are needed to see a delta — hence snapshotting
  (below).

### 2. Traffic API (`/traffic/views`, `/traffic/clones`, `/traffic/popular/referrers`)

The only source with **unique** visitor/cloner counts, not just totals.
Requires push-level repo access — the default `GITHUB_TOKEN` in Actions
**cannot** read these endpoints (they need `Administration: read` on a
fine-grained PAT, or classic `repo` scope). Rolling **14-day window only**;
GitHub does not retain anything older. If a snapshot is skipped for more than
14 days, that window's data is gone permanently — this is the entire reason a
weekly cron exists (see below).

### 3. Obsidian community registry stats

`https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json`,
keyed by plugin id (`local-dictation`). Gives a `downloads` total plus a
per-version breakdown, independent of GitHub release assets — this is the
closest signal to "installed via Obsidian's in-app browser" as opposed to
manual/BRAT installs. Public, unauthenticated, no rate-limit concerns for
occasional use.

### 4. Repo metadata (`GET /repos/{repo}`)

Stars, forks, watchers. Cheap, always available, included as background
context only.

## Report shape (`node scripts/download-stats.mjs`)

Markdown to stdout:

1. Header: total `main.js` downloads (all-time install proxy), stars/forks.
2. Per-release asset table (release tag, published date, `main.js` count,
   sidecar counts).
3. Platform / acceleration split (aggregate across all releases).
4. Obsidian registry: total + per-version table.
5. Traffic (last 14 days): views/uniques, clones/uniques, top referrers. Any
   endpoint that 403s (no push access / no PAT) is shown as "unavailable" with
   a one-line reason instead of failing the whole report.
6. **Deltas vs. last snapshot**, when the history log has a prior entry:
   main.js downloads gained, registry downloads gained. Locally the history
   file usually doesn't exist, so the script falls back to reading
   `origin/stats-history:stats/history.jsonl` directly — deltas work after a
   plain `git fetch`, no branch checkout needed.

Flags:
- `--snapshot` — after rendering, record one normalized JSON line in the
  history file (created if absent). Real snapshots are CI's job; a local
  `--snapshot` writes to a gitignored `stats/history.jsonl` in the working
  tree.
- `--json` — print the raw collected data as JSON instead of the markdown
  report (for scripting/debugging).

Env:
- `STATS_HISTORY_PATH` — history file location, default `stats/history.jsonl`.
  The weekly workflow points this at its checkout of the `stats-history`
  branch.

## Snapshot history: the `stats-history` branch

Snapshots live in `stats/history.jsonl` on the dedicated orphan branch
`stats-history`, not on `main`: `main`'s protection ruleset (PR + required
checks) rejects direct bot pushes, and a weekly data commit doesn't belong in
`main`'s history anyway. The branch was seeded with one real snapshot so the
delta path is exercised from the first CI run, and carries a README stating
its purpose.

**Never delete this branch.** It is intentionally unmerged and will look stale
in branch listings forever — that is by design. The traffic API retains only a
rolling 14-day window, so this branch is the *only* long-term record of
unique-visitor data; deleting it destroys that history permanently.

## Snapshot schema (`stats/history.jsonl` on `stats-history`)

One JSON object per line, newest appended at the bottom:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-07-09T18:32:00.000Z",
  "repo": { "stars": 12, "forks": 2, "watchers": 12 },
  "releaseAssets": { "mainJsTotal": 512, "byRelease": [ { "tag": "2026.7.3", "publishedAt": "...", "assets": { "main.js": 20, "...": 0 } } ] },
  "platformSplit": { "linux-cpu": 46, "linux-cuda": 19, "windows-cpu": 210, "windows-cuda": 34, "macos-arm64": 15 },
  "obsidianRegistry": { "total": 488, "byVersion": { "2026.7.2": 55 } },
  "traffic": { "views": { "count": 110, "uniques": 44 }, "clones": { "count": 1321, "uniques": 258 } }
}
```

`traffic` is `null` when the credential in use lacks push access (documented
below), so a snapshot still lands with everything else intact.

## CI: weekly snapshot workflow

`.github/workflows/stats-snapshot.yml` — cron `Mon 06:00 UTC` +
`workflow_dispatch`, mirroring the cadence/style of the existing
`cache-cleanup.yml` weekly sweep. Checks out `main` (for the script) plus the
`stats-history` branch into a `stats-history/` subdirectory, runs `node
scripts/download-stats.mjs --snapshot` with `STATS_HISTORY_PATH` pointing into
that subdirectory, writes the rendered report to `GITHUB_STEP_SUMMARY` (so
each run doubles as a readable weekly digest, same pattern as
`release-timing-report.mjs`), and commits + pushes `stats/history.jsonl` on
`stats-history` if it changed.

**Known gap requiring manual setup**: the default `GITHUB_TOKEN` cannot read
traffic endpoints under any permissions grant — GitHub does not expose that
scope to the built-in token. The workflow uses a repo secret
`STATS_TRAFFIC_TOKEN` when present (falls back to `GITHUB_TOKEN`, which still
captures release/registry/repo data — just not traffic). **Follow-up for the
maintainer**: create a fine-grained PAT scoped to this repo only with
`Administration: read`, add it as the `STATS_TRAFFIC_TOKEN` secret. Until
then, weekly snapshots silently lose the only unique-visitor data every time
the 14-day window rolls over.

## Files

- `docs/specs/download-stats.md` — this file.
- `scripts/download-stats.mjs` — CLI entry point.
- `scripts/lib/download-stats-data.mjs` — pure helpers (asset classification,
  snapshot normalization, delta math), unit-tested.
- `test/download-stats.test.ts` — tests for the pure helpers plus arg parsing
  and report rendering.
- `.github/workflows/stats-snapshot.yml` — weekly cron.
- `stats-history` branch — append-only snapshot log
  (`stats/history.jsonl`, seeded with one real entry) plus a README. Never
  delete (see above).
- `package.json` — `stats:downloads` script.
