# stats-history

Machine-written download/usage snapshots for this plugin, recorded weekly by
the `stats-snapshot` workflow (`.github/workflows/stats-snapshot.yml` on
`main`). One JSON line per snapshot in `stats/history.jsonl`; the schema and
full rationale live in `docs/specs/download-stats.md` on `main`.

**Do not delete this branch.** GitHub's traffic API retains only a rolling
14-day window, so the snapshots here are the only long-term record of
unique-visitor/cloner data — deleting the branch destroys that history
permanently. It is intentionally never merged anywhere and will always look
stale in branch listings; skip it during any branch cleanup.
