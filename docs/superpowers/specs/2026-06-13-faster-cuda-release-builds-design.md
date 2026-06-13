# Faster CUDA release builds + release timing analytics (#143)

Date: 2026-06-13
Branch: `feat/faster-cuda-release-builds`
Issue: #143 (follow-up to #139)

## Problem

The Windows CUDA release leg dominates release wall time. Last successful dry run
(`6d2b131`, run 27454925421):

- Windows CUDA job: **23m24s** (toolkit install 3m51s, sidecar build 17m38s, package+upload 53s)
- Linux CUDA job: **46s warm** (mature 299 MB `target-cuda` cache restored)

The native `whisper-rs-sys` CMake/NVCC build is ~91% of cold build time. Linux is fast
because its rust-cache `target-cuda` entry is healthy; Windows restored a **193 MB
partial** cache left behind by an earlier *failed* configure run.

## Root cause (confirmed by research)

1. `setup-sidecar-rust` defaults `cache-on-failure: true`. The release CUDA build jobs
   don't override it, so a **failed** configure run persisted a partial `target-cuda`
   tree (half-written `whisper-rs-sys` OUT_DIR / CMake build dir).
2. GitHub Actions cache keys are **immutable**. A later **successful** run that computes
   the *same* key gets a full-restore match, so Swatinem/rust-cache's save step
   short-circuits ("cache up-to-date") and the poisoned partial is **never** overwritten.
   Windows reuses the broken tree on every run.
3. rust-cache *does* preserve `whisper-rs-sys`'s OUT_DIR (compiled CUDA objects + CMake
   build dir). Cargo fingerprinting then skips the build script when build-affecting env
   is stable — which is exactly why Linux warm = 46s. A healthy Windows cache should
   behave the same.

## Research conclusions (what we are NOT doing, and why)

- **sccache / Ninja for CUDA**: rejected. Two open upstream issues
  ([sccache#1077](https://github.com/mozilla/sccache/issues/1077),
  [sccache#957](https://github.com/mozilla/sccache/issues/957)) show NVCC cache *hits*
  producing link errors on Windows/MSVC; the compiler-launcher path requires the Ninja
  generator (we use the VS generator), and `whisper-rs-sys`'s hashed `OUT_DIR` breaks
  sccache's path-based keys. It is also redundant — rust-cache already caches the same
  build tree. Correctness risk > benefit.
- **CUDA toolkit-install caching** (the 3m51s): rejected. `Jimver/cuda-toolkit`'s
  GitHub-cache save path is hard-disabled on Windows and only ever cached a ~9.6 MB
  installer stub; the time is installer extraction, not download. A custom extraction
  script could help but is a large, fragile change.
- **Larger / self-hosted runner**: out of scope (hosted runners only, per decision).
- **`--split-compile`, `GGML_CUDA_F16`**: rejected. The former needs lowering `-j` to
  avoid oversubscription for marginal benefit; the latter changes inference numeric
  precision and is a correctness decision, not a build-speed lever.

## Changes

All changes are in `.github/` and `scripts/build-cuda.ps1`. No Rust/runtime code changes.

### 1. Stop cache poisoning
Set `cache-on-failure: false` on the sidecar **build** jobs (`build-sidecar-posix`,
`build-sidecar-windows`) via the `setup-sidecar-rust` input. Failed configures no longer
persist partial trees. Quality jobs (`native-quality`, CI) keep the default — they don't
write the CUDA build tree.

### 2. Harden cache identity + escape existing poison
Export `CUDA_TOOLKIT_VERSION` (matching the `Jimver/cuda-toolkit` `cuda:` input, e.g.
`13.2.0`) in the CUDA build environment and add `CUDA` to the rust-cache `env-vars`
prefix list so a toolkit bump forks the cache key (today the toolkit version lives only
in the `uses:` input and is invisible to the cache key — a bump would silently reuse
stale objects). This also mints a fresh key family, escaping any currently-poisoned
entry. Separately, prune the known-bad Windows CUDA cache entries with `gh cache delete`.

### 3. Drop `-t0`
Remove `CMAKE_CUDA_FLAGS: '-t0'` from both build steps. For a single `75-virtual` arch,
`nvcc --threads` has no architecture targets to fan out across, so `-t0` ×
`CMAKE_BUILD_PARALLEL_LEVEL=4` only risks 16-way oversubscription on a 4-core runner.
Rely on CMake TU-parallelism. (Cold-build experiment — validate via the smoke workflow.)

### 4. `compression-level: 0` on sidecar artifact uploads
The sidecar `upload-artifact` steps upload already-gzipped `.tar.gz`; the default level 6
re-deflates high-entropy data for ~zero gain. Set `compression-level: 0` (store).

### 5. Job ordering
`build-sidecar-posix` / `build-sidecar-windows` depend on `metadata` only (drop the
`native-quality` dependency). `publish` continues to require `native-quality` **and** all
build jobs, so the release gate is unchanged — builds just start ~1-3 min sooner.

### 6. Windows/Linux build parity
In `build-cuda.ps1`, set `WHISPER_DONT_GENERATE_BINDINGS=1`, `WHISPER_CCACHE=OFF`,
`GGML_CCACHE=OFF` (and the matching `CMAKE_ARGS`) to match `build-cuda.sh`. Removes a
bindgen/libclang dependency and a no-op ccache probe on Windows.

## Release timing analytics (new requirement)

A `release-report` job that produces a human-readable, at-a-glance timing breakdown after
every release/dry run — so the maintainer can judge "acceptable" vs "too slow" without
opening cargo `--timings` HTML.

- **Mechanism**: GitHub's jobs REST API
  (`gh api /repos/{repo}/actions/runs/{run_id}/jobs --paginate`) already returns every job
  and every step with `started_at` / `completed_at`. No build-script instrumentation or
  JSON-artifact plumbing needed.
- **`release-report` job**: ubuntu-latest, `needs` all build + bundle jobs (peer of
  `publish`; does not gate publish). Runs `scripts/release-timing-report.mjs`, which:
  - reads `GITHUB_RUN_ID` + repo, fetches jobs JSON,
  - renders markdown to `$GITHUB_STEP_SUMMARY`: a per-job table (job, total duration,
    conclusion), a per-step breakdown for the CUDA legs (toolkit install / build /
    package / upload), and a "slowest steps across the run" callout,
  - writes the same markdown to `release-report.md` and uploads it as an artifact.
- **Permissions**: the job needs `actions: read` to call the jobs API.
- **Cost**: one short ubuntu job + one API call. Negligible.
- The cargo `--timings` HTML upload stays for deep dives.

## Iteration vehicle

New `.github/workflows/cuda-smoke.yml`, `workflow_dispatch`-only, builds **only** the
Windows + Linux CUDA legs (no CPU/macOS/plugin-bundle/publish). Runnable from this branch.
It reuses the same `setup-sidecar-rust` + CUDA-install + build steps so cache behavior
matches release. Kept as a permanent dev tool (zero cost unless dispatched). It carries
the same `release-report`-style step summary so smoke runs are also measurable.

Validation loop: dispatch cold (expect ~20m Windows, populates cache) → dispatch warm
(expect ~1-2m build + ~4m toolkit). Record cold/warm timings for each experiment in #143.
Branch-scoped caches created by smoke runs are pruned afterward (`gh cache delete`) to
respect the ~10 GiB repo budget (currently over at 10.76 GB; stale entries also pruned).

## Success criteria

- Windows CUDA **warm** build (native compile step) drops from ~17m38s to ~1-2 min,
  approaching Linux's 46s — i.e., the warm cache reliably skips NVCC.
- No regression to release correctness: same artifacts, same provenance attestations,
  `publish` still gated on quality + all builds.
- A readable timing summary appears on every release run page and as an artifact.
- Repo Actions cache back under 10 GiB.

## Risks

- Dropping `-t0` could in principle slow a multi-arch build, but we build one virtual
  arch — measure on the smoke workflow before trusting it.
- `WHISPER_DONT_GENERATE_BINDINGS=1` on Windows assumes the crate's vendored bindings are
  correct for this target (Linux already relies on this). Verified by a green smoke build.
- Jobs-API step names are referenced by the report script; renaming a step requires
  updating the script. Script degrades gracefully (lists whatever steps exist).
