# CUDA 12.9 → 13.2 Upgrade + Dependency Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Windows + Linux CUDA release legs from CUDA Toolkit 12.9 to 13.2, unpin the Windows runner from `windows-2022` back to `windows-latest` (VS 2026), and land low-risk dependency-hygiene bumps — without changing the supported-GPU floor.

**Architecture:** CUDA only exists in two of the five release legs (`sidecar-linux-x86_64-cuda`, `sidecar-windows-x86_64-cuda`); macOS/Metal and the CPU legs are untouched. The change surface is build config (`release.yml`, `build-cuda.{sh,ps1}`, `setup-sidecar-rust`), one data manifest (`native/cuda-artifacts.json`), one packaging script (`package-sidecar-archive.mjs`), and user-facing docs. No top-level Rust/JS dependency *version* changes are required for CUDA 13 — `whisper-rs 0.16.0` and `ort 2.0.0-rc.12` are already the latest published releases and both are CUDA-13-ready; the cu12→cu13 ONNX Runtime EP switch is a build-time env var (`ORT_CUDA_VERSION`), not a version bump.

**Tech Stack:** GitHub Actions, `Jimver/cuda-toolkit@v0.2.35`, `Swatinem/rust-cache@v2`, Rust (whisper-rs/whisper.cpp 1.8.3, `ort`/ONNX Runtime), Node ESM packaging scripts.

---

## Verified facts driving this plan (do not re-derive; corrections already applied)

Web-verified 2026-06-12 (sources: NVIDIA CUDA 13.2 release notes + `redistrib_13.2.0.json`, pykeio/ort releases, Jimver/cuda-toolkit releases, ggml CMakeLists at whisper.cpp v1.8.3):

- **CUDA 13.2 is the first toolkit to support Visual Studio 2026 (MSVC v18) as a host compiler.** This is what lets us unpin from `windows-2022`. `Jimver/cuda-toolkit@v0.2.35` accepts `cuda: '13.2.0'`.
- **cu12 → cu13 ONNX Runtime EP is selected by the `ORT_CUDA_VERSION` env var** (value `12` or `13`), read by `ort-sys` at build time — NOT a Cargo feature. pyke hosts both cu12 and cu13 prebuilt CUDA EP binaries for the pinned `ort = 2.0.0-rc.12`. ort auto-detects from the local toolkit, so an unpinned value would make the dev machine (CUDA 13 toolkit) and CI silently diverge — **pin it explicitly to `13`.**
- **Runtime library sonames do NOT all share the toolkit major.** Under CUDA 13.2:
  - `cudart`, `cublas`, `cublasLt` → major **13** (`*_13.dll` / `.so.13`)
  - `cufft` → major **12** (`cufft64_12.dll` / `libcufft.so.12`) — it went 11→12, it does **not** track the toolkit major. This is the easiest thing to get wrong.
- **whisper-rs 0.16.0 vendors whisper.cpp 1.8.3**, whose ggml CUDA CMakeLists already branches on `CUDAToolkit_VERSION VERSION_LESS "13"` and omits pre-Turing virtual archs under CUDA 13. Our `CMAKE_CUDA_ARCHITECTURES=75-virtual` stays valid — Turing (CC 7.5) is CUDA 13's new minimum, so **no supported GPUs are dropped.**
- **Driver floor rises ~R525 → R580.** Linux minimum is confirmed **≥ 580.65.06**. The exact Windows number is unverified — docs should say "R580 or newer" without a precise Windows build number.
- **cuDNN for CUDA 13 is cuDNN 9.20+** (not 9.12). Same soname (`cudnn64_9.dll` / `libcudnn.so.9`) as the CUDA-12 build, different internals — so a CUDA-12 cuDNN is found by name but fails at runtime. cuDNN stays host-provided (not bundled), unchanged from today.
- **UNVERIFIED — handle defensively:** the claim that CUDA 13 moved the Windows runtime DLLs from `%CUDA_PATH%\bin` to `%CUDA_PATH%\bin\x64` could not be confirmed in NVIDIA docs. The packaging script will resolve **both** locations rather than betting on one (Task 7).

## Non-goals (explicitly out of scope)

- **Obsidian typings / `minAppVersion` bump (1.8.7 → 1.13.x).** Raises the user-facing minimum Obsidian version; the maintainer is undecided and it has nothing to do with CUDA. Leave pinned.
- **`reqwest` 0.12 → 0.13.** Semver-major with API churn, unrelated to CUDA. Skip.
- **Bundling cuDNN.** Still host-provided pending the licensing review noted in `platform-runtime-dependencies.md`.
- **Bumping the project release version** (`manifest.json` / `package.json` / `Cargo.toml` from `2026.6.10`). That is a release action; the release-notes file (Task 13) is named at tag time.

## Execution order & verification gates

Phase 0 (hygiene) is independent and lands first as its own commit so the CUDA diff stays reviewable. Phases 1–4 are the CUDA 13 core. **The authoritative gate is a `workflow_dispatch` dry-run of `release.yml`** — local CUDA builds cannot fully exercise the ORT CUDA EP (see AGENTS.md). Run the dry-run twice if you want to isolate risk: once with CUDA 13.2 still on `windows-2022` (proves "CUDA 13.2 + whisper.cpp 1.8.3 + packaging" in isolation), then again after the unpin (proves "VS 2026 + `visual_studio_integration`").

---

## Phase 0 — Dependency hygiene (independent, low-risk)

### Task 1: Rust transitive-dependency refresh

**Files:**
- Modify: `native/Cargo.lock` (via `cargo update`; no `Cargo.toml` edits)

- [ ] **Step 1: Refresh the lockfile**

Run from repo root:
```bash
cd native && cargo update && cd ..
```
Expected: ~48 transitive crates bumped (rustls, tokio-util, libc, hyper, regex, etc.). `reqwest` stays at 0.12.x (its 0.13 is a held major). No `Cargo.toml` changes.

- [ ] **Step 2: Verify the workspace still builds + passes Rust gates**

Run: `npm run check:rust`
Expected: PASS (fmt clean, clippy clean, build succeeds). This builds the CPU sidecar (whisper.cpp CPU) locally, which is supported on this machine.

- [ ] **Step 3: Commit**

```bash
git add native/Cargo.lock
git commit -m "chore(deps): cargo update transitive crates"
```

### Task 2: npm low-risk bumps

**Files:**
- Modify: `package.json:38` (`@biomejs/biome`), `:43` (`@types/node`), `:40` (`@codemirror/view`), `:45` (`esbuild`)
- Modify: `package-lock.json`

Bump only dev-tooling with no runtime/`minAppVersion` impact. Leave `obsidian` (1.8.7), `typescript`, `tslib`, `vitest` as-is.

- [ ] **Step 1: Bump the exact-pinned dev tools in `package.json`**

| Line | From | To |
|---|---|---|
| `@biomejs/biome` | `2.4.16` | `2.5.0` |
| `@codemirror/view` | `6.43.1` | `6.43.1` (already; no edit needed — confirm) |
| `@types/node` | `25.9.2` | `25.9.3` |
| `esbuild` | `0.28.0` | `0.28.1` |

(`@codemirror/view` is already `6.43.1` in `package.json`; the lockfile drift resolves in Step 2.)

- [ ] **Step 2: Update the lockfile and in-range `^` deps**

Run:
```bash
npm install
npm update
```
Expected: `eslint` → 10.5.0, `typescript-eslint`/`@typescript-eslint/parser` → 8.61.0, `@codemirror/view` lock → 6.43.1, plus the pinned bumps from Step 1. `obsidian` stays 1.8.7.

- [ ] **Step 3: Verify frontend gates (biome bump may surface new lint rules)**

Run: `npm run check:frontend`
Expected: PASS. If biome 2.5.0 flags pre-existing code with a new rule, do NOT mass-reformat — either `npm run format` only if the diff is trivially whitespace, or pin biome back to `2.4.16` and note it. Keep the diff surgical.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): bump biome, esbuild, types/node, eslint within low-risk ranges"
```

---

## Phase 1 — Deterministic ORT CUDA major selection

### Task 3: Pin `ORT_CUDA_VERSION=13` in both CUDA build scripts

**Why:** ort auto-detects the CUDA major from the local toolkit. With CI moving to CUDA 13.2 and the dev machine already on CUDA 13, both *should* pick cu13 — but auto-detect is fragile (e.g. a second toolkit on PATH). Pin it in the build scripts so local and CI builds are byte-for-byte deterministic, single source of truth.

**Files:**
- Modify: `scripts/build-cuda.sh` (env export block, ~line 94)
- Modify: `scripts/build-cuda.ps1` (env setup, ~line 41)

- [ ] **Step 1: `build-cuda.sh` — add the export alongside the other build env**

After the existing `export CMAKE_ARGS=...` line (currently line 97), add:
```bash
# Pin the ONNX Runtime CUDA execution-provider major so local and CI builds
# resolve the same pyke cu13 binaries instead of auto-detecting from whatever
# CUDA toolkit happens to be on PATH. ort reads this in ort-sys' build script.
export ORT_CUDA_VERSION=${ORT_CUDA_VERSION:-13}
```

- [ ] **Step 2: `build-cuda.ps1` — add the same pin**

After the `$env:CMAKE_BUILD_PARALLEL_LEVEL = "$jobs"` line (currently line 41), add:
```powershell
# Pin the ONNX Runtime CUDA execution-provider major (see build-cuda.sh).
if (-not $env:ORT_CUDA_VERSION) { $env:ORT_CUDA_VERSION = '13' }
```

- [ ] **Step 3: Surface it in the ps1 preflight log (parity with the other env echoes)**

In the `Invoke-TimedStep "CUDA sidecar preflight"` block (currently ~line 60), after the `CUDA_PATH` line add:
```powershell
  Write-Host "ORT_CUDA_VERSION: $env:ORT_CUDA_VERSION"
```

- [ ] **Step 4: Verify scripts still parse**

Run: `bash -n scripts/build-cuda.sh` (expect: no output, exit 0)
Run: `pwsh -NoProfile -Command "& { . { param() }; [System.Management.Automation.Language.Parser]::ParseFile('scripts/build-cuda.ps1', [ref]$null, [ref]$null) | Out-Null }"` (expect: exit 0, no parse errors). If `pwsh` syntax-check is awkward, a successful local `npm run build:sidecar:cuda:windows` later is sufficient proof.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-cuda.sh scripts/build-cuda.ps1
git commit -m "build(cuda): pin ORT_CUDA_VERSION=13 for deterministic ORT CUDA EP"
```

### Task 4: Bust the rust-cache on `ORT_*` env changes

**Why:** `ORT_CUDA_VERSION` selects which prebuilt EP `ort-sys` downloads into `target/`. If the value flips but the cache key doesn't, a cached cu12 EP could be silently restored and re-shipped (the same failure class as the AVX-512 and VS-generator cache poisoning already guarded in this repo). `Swatinem/rust-cache` hashes `env-vars` *prefixes* into the key, so adding `ORT` covers `ORT_CUDA_VERSION`.

**Files:**
- Modify: `.github/actions/setup-sidecar-rust/action.yml:21`

- [ ] **Step 1: Extend the default `cache-env-vars`**

Change line 21 from:
```yaml
    default: 'CARGO CC CFLAGS CXX CMAKE RUST GGML WHISPER'
```
to:
```yaml
    default: 'CARGO CC CFLAGS CXX CMAKE RUST GGML WHISPER ORT'
```

- [ ] **Step 2: Update the input's `description` to mention ORT (line 19)**

Change:
```yaml
    description: Value passed to Swatinem/rust-cache 'env-vars' input. Default extends defaults with GGML and WHISPER so build-affecting flips bust the cache.
```
to:
```yaml
    description: Value passed to Swatinem/rust-cache 'env-vars' input. Default extends defaults with GGML, WHISPER, and ORT so build-affecting flips (CPU SIMD, whisper flags, ONNX Runtime CUDA major) bust the cache.
```

- [ ] **Step 3: Commit**

```bash
git add .github/actions/setup-sidecar-rust/action.yml
git commit -m "ci(cache): bust rust-cache on ORT_* env changes"
```

---

## Phase 2 — Bump the toolkit and the runtime-artifact manifest

### Task 5: Bump `Jimver/cuda-toolkit` to 13.2.0 in both legs

**Files:**
- Modify: `.github/workflows/release.yml:201` (posix CUDA leg)
- Modify: `.github/workflows/release.yml:297` (windows CUDA leg)

- [ ] **Step 1: posix leg — bump the `cuda:` input**

In the `build-sidecar-posix` job's `Install CUDA toolkit` step, change:
```yaml
        with:
          cuda: '12.9.0'
          method: network
```
to:
```yaml
        with:
          cuda: '13.2.0'
          method: network
```

- [ ] **Step 2: windows leg — bump the `cuda:` input (keep the sub-packages list)**

In the `build-sidecar-windows` job's `Install CUDA toolkit` step, change `cuda: '12.9.0'` to `cuda: '13.2.0'`. Leave `sub-packages` unchanged — `visual_studio_integration` is still required for the VS CMake generator; whether it maps cleanly onto VS 18 is the headline dry-run risk (see Risks).

- [ ] **Step 3: Sanity-check the workflow YAML parses**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!y.includes(\"cuda: '13.2.0'\")) throw new Error('cuda input not bumped'); if(y.includes(\"cuda: '12.9.0'\")) throw new Error('a 12.9.0 input remains');"`
Expected: exit 0, no throw.

- [ ] **Step 4: Commit** (bundle with Task 6 if preferred; kept separate here for clarity)

```bash
git add .github/workflows/release.yml
git commit -m "ci(cuda): install CUDA toolkit 13.2.0 in both CUDA legs"
```

### Task 6: Update `native/cuda-artifacts.json` runtime sonames

**Files:**
- Modify: `native/cuda-artifacts.json:7-8`

- [ ] **Step 1: Rewrite the `runtime` block**

Replace the file's `runtime` object with (note `cufft` → **12**, the others → **13**):
```json
  "runtime": {
    "linux": ["libcudart.so.13", "libcublas.so.13", "libcublasLt.so.13", "libcufft.so.12"],
    "win32": ["cudart64_13.dll", "cublas64_13.dll", "cublasLt64_13.dll", "cufft64_12.dll"]
  }
```
Leave the `providers` block unchanged (provider DLL/.so names are CUDA-major-agnostic).

- [ ] **Step 2: Verify the manifest still parses and lists the new files**

Run: `node scripts/list-cuda-artifacts.mjs runtime win32`
Expected output:
```
cudart64_13.dll
cublas64_13.dll
cublasLt64_13.dll
cufft64_12.dll
```
Run: `node scripts/list-cuda-artifacts.mjs runtime linux`
Expected: the four `.so.13`/`.so.12` names.

- [ ] **Step 3: Commit**

```bash
git add native/cuda-artifacts.json
git commit -m "feat(cuda): update bundled runtime sonames for CUDA 13.2"
```

---

## Phase 3 — Make Windows packaging robust to the runtime-dir move

### Task 7: Resolve the Windows CUDA runtime dir across `bin\x64` and `bin`

**Why:** Issue #139 claims CUDA 13 moved the Windows runtime DLLs to `%CUDA_PATH%\bin\x64`; that move is **unverified** in NVIDIA docs. Rather than bet the release on one path, resolve the first candidate dir that actually contains the runtime files. Linux is unaffected (derives the lib dir from `nvcc`).

**Files:**
- Modify: `scripts/package-sidecar-archive.mjs:51-52`
- Add: helper `findWindowsCudaRuntimeDir()` near the other helpers
- Test: `test/package-sidecar-archive.test.ts` (new; pure helper)

- [ ] **Step 1: Write the failing test for the dir-resolution helper**

To keep the helper unit-testable without a real CUDA install, factor the candidate-selection into a pure function that takes an existence predicate. Create `test/package-sidecar-archive.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { pickFirstExistingDir } from '../scripts/lib/pick-existing-dir.mjs';

describe('pickFirstExistingDir', () => {
  it('returns the first candidate that exists', () => {
    const exists = (p: string) => p === 'C:/cuda/bin/x64';
    expect(pickFirstExistingDir(['C:/cuda/bin/x64', 'C:/cuda/bin'], exists)).toBe('C:/cuda/bin/x64');
  });

  it('falls through to a later candidate when earlier ones are absent', () => {
    const exists = (p: string) => p === 'C:/cuda/bin';
    expect(pickFirstExistingDir(['C:/cuda/bin/x64', 'C:/cuda/bin'], exists)).toBe('C:/cuda/bin');
  });

  it('throws a descriptive error when no candidate exists', () => {
    expect(() => pickFirstExistingDir(['a', 'b'], () => false)).toThrow(/none of the candidate/i);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/package-sidecar-archive.test.ts`
Expected: FAIL — `Cannot find module '../scripts/lib/pick-existing-dir.mjs'`.

- [ ] **Step 3: Implement the pure helper**

Create `scripts/lib/pick-existing-dir.mjs`:
```javascript
// Pick the first directory from `candidates` for which `exists(dir)` is true.
// Factored out of package-sidecar-archive.mjs so the bin\x64-vs-bin fallback
// (CUDA 13 may relocate Windows runtime DLLs; the move is unconfirmed) is unit
// testable without a real CUDA install.

export function pickFirstExistingDir(candidates, exists) {
  for (const dir of candidates) {
    if (exists(dir)) return dir;
  }
  throw new Error(`none of the candidate directories exist: ${candidates.join(', ')}`);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/package-sidecar-archive.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the helper into the packaging script**

In `scripts/package-sidecar-archive.mjs`, add to the imports (after the existing `./lib/cuda-artifacts.mjs` import):
```javascript
import { existsSync } from 'node:fs';

import { pickFirstExistingDir } from './lib/pick-existing-dir.mjs';
```
Then replace line 52:
```javascript
  const runtimeSourceDir = isWindows ? join(requiredEnv('CUDA_PATH'), 'bin') : linuxCudaLibDir();
```
with:
```javascript
  // CUDA 13 may relocate the Windows runtime DLLs from %CUDA_PATH%\bin to
  // %CUDA_PATH%\bin\x64 (unconfirmed in NVIDIA docs), so try x64 first and fall
  // back to the historical location. Linux derives its lib dir from nvcc.
  const runtimeSourceDir = isWindows
    ? pickFirstExistingDir(
        [join(requiredEnv('CUDA_PATH'), 'bin', 'x64'), join(requiredEnv('CUDA_PATH'), 'bin')],
        existsSync,
      )
    : linuxCudaLibDir();
```

- [ ] **Step 6: Verify the JS gate still passes**

Run: `npm run check:frontend`
Expected: PASS (typecheck + lint + the new test + frontend build). The new `.mjs` is covered by the existing biome config.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pick-existing-dir.mjs scripts/package-sidecar-archive.mjs test/package-sidecar-archive.test.ts
git commit -m "fix(release): resolve Windows CUDA runtime dir across bin and bin/x64"
```

---

## Phase 4 — Unpin the Windows runner

### Task 8: Return the Windows CUDA leg to `windows-latest` (VS 2026)

**Files:**
- Modify: `.github/workflows/release.yml:271-275`

- [ ] **Step 1: Replace the pin and its stale comment**

Change:
```yaml
    # Pinned to the VS 2022 image: CUDA 12.9 ships MSBuild integration only up
    # to VS 2022, and both windows-latest and windows-2025 are mid-migration to
    # a VS 2026 (v18) image that carries no VS 2022 toolchain, so CMake fails
    # with "No CUDA toolset found". See #139 for the unpin path.
    runs-on: windows-2022
```
to:
```yaml
    # windows-latest is the VS 2026 (v18) image. CUDA 13.2 is the first toolkit
    # to support MSVC v18 as a host compiler, so the VS CUDA generator works
    # here again. The rust-cache key is forked by VS product line (see
    # setup-sidecar-rust) so a future runner-image VS bump can't poison the
    # cache. See #139.
    runs-on: windows-latest
```

- [ ] **Step 2: Confirm the only remaining `windows-2022` reference (if any) is intentional**

Run: `grep -rn "windows-2022" .github/`
Expected: no matches (the CI workflow uses `windows-latest`; the pin was release-only).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: unpin Windows CUDA leg to windows-latest now that CUDA 13.2 supports VS 2026"
```

---

## Phase 5 — Documentation

### Task 9: `native`-adjacent runtime-dependency doc

**Files:**
- Modify: `docs/release/platform-runtime-dependencies.md`

- [ ] **Step 1: Update the bundled-runtime table (lines 31-32)**

Replace the Linux/Windows runtime-lib cells:
- Linux: `libcudart.so.13`, `libcublas.so.13`, `libcublasLt.so.13`, `libcufft.so.12`
- Windows: `cudart64_13.dll`, `cublas64_13.dll`, `cublasLt64_13.dll`, `cufft64_12.dll`

- [ ] **Step 2: Update CUDA-major references**

- Line 57 (Windows GPU driver row): `CUDA 12.x-compatible display driver` → `CUDA 13.x-compatible display driver (R580 or newer)`.
- Line 94 (Flatpak symlink note): `/run/host/usr/local/cuda-12.9/...` → `/run/host/usr/local/cuda-13.2/...`.
- Add a sentence to the cuDNN rows (Windows line 59, Linux line 73 contexts): cuDNN must be **cuDNN 9 built for CUDA 13 (9.20 or newer)** — same `cudnn64_9.dll` / `libcudnn.so.9` soname as the CUDA-12 build, so a CUDA-12 cuDNN is found by name but fails at runtime.
- Lines 154-155 (CI artifacts table): the Windows runner is back to `windows-latest` — this matches the unpinned workflow now, leave as `windows-latest`.

- [ ] **Step 3: Verify no stale `12` runtime sonames remain in this doc**

Run: `grep -nE "so\.11|64_11|so\.12|64_12|cuda-12" docs/release/platform-runtime-dependencies.md`
Expected: only intentional historical/Flatpak-version mentions, no bundled-runtime soname rows. `cufft64_12.dll` / `libcufft.so.12` are now correct (cuFFT major 12 under CUDA 13) — do not "fix" those to 13.

### Task 10: Windows CUDA setup guide

**Files:**
- Modify: `docs/guides/windows-cuda-setup.md`

- [ ] **Step 1: Update requirements + source-build references**

- Line 17: `driver compatible with CUDA 12.x` → `driver compatible with CUDA 13.x (R580 or newer)`.
- Line 18: `CUDA Toolkit 12.9` → `CUDA Toolkit 13.2`.
- Line 30: `CUDA 12.x userspace libraries` → `CUDA 13.x userspace libraries`.
- Line 35: rewrite the "CUDA 13 is not a drop-in" paragraph — it is now the shipped target. Replace with guidance that the release archive ships the CUDA 13 runtime DLLs (`cudart64_13.dll`, `cublas64_13.dll`, …) and source builds need CUDA Toolkit 13.2 with `nvcc`.
- Lines 53, 57, 60, 104: `cudart64_12.dll` → `cudart64_13.dll`; `CUDA Toolkit 12.9` → `13.2`.

- [ ] **Step 2: Verify**

Run: `grep -nE "12\.9|cudart64_12|CUDA 12" docs/guides/windows-cuda-setup.md`
Expected: no matches.

### Task 11: Linux Flatpak GPU setup guide

**Files:**
- Modify: `docs/guides/linux-flatpak-gpu-setup.md`

- [ ] **Step 1: Bump the toolkit-version path examples**

Lines 25, 39, 55, 68, 113, 122, 152, 173: change `12.9`/`cuda-12.9`/`cuda-12.x` example paths to the `13.2`/`cuda-13.2` equivalents (these are source-build/host example paths; keep them consistent with the documented toolkit). Line 25 also: `CUDA Toolkit 12.9` → `CUDA Toolkit 13.2`.

- [ ] **Step 2: Verify**

Run: `grep -nE "12\.9|cuda-12" docs/guides/linux-flatpak-gpu-setup.md`
Expected: no matches.

### Task 12: README + CONTRIBUTING

**Files:**
- Modify: `README.md:27`
- Modify: `CONTRIBUTING.md:9,14`

- [ ] **Step 1: README acceleration line (27)**

Change `…a driver compatible with CUDA 12.9; Cohere on CUDA also needs cuDNN 9 (falls back to CPU without it).` to reference **a driver compatible with CUDA 13.x (R580 or newer)** and **cuDNN 9 for CUDA 13**. Keep the "RTX 20-series / GTX 16-series or newer" GPU floor — unchanged under CUDA 13.

- [ ] **Step 2: CONTRIBUTING build-deps (9, 14)**

- Line 9: `CUDA Toolkit 12.9` → `CUDA Toolkit 13.2`.
- Line 14: update the prose to CUDA 13.2 and the R580 driver floor; cuDNN guidance → cuDNN 9 for CUDA 13.

- [ ] **Step 3: Verify both files**

Run: `grep -nE "12\.9|CUDA 12" README.md CONTRIBUTING.md`
Expected: no matches.

- [ ] **Step 4: Commit the whole docs phase**

```bash
git add docs/release/platform-runtime-dependencies.md docs/guides/windows-cuda-setup.md docs/guides/linux-flatpak-gpu-setup.md README.md CONTRIBUTING.md
git commit -m "docs(cuda): update to CUDA 13.2, R580 driver floor, cuDNN 9-for-CUDA-13"
```

### Task 13: Release-notes file (authored at tag time)

**Files:**
- Create: `docs/release-notes/<release-version>.md` (version chosen when the release is cut, per the `YYYY.M.counter` scheme; must sort above `2026.6.10`)

- [ ] **Step 1: When cutting the release, create the notes file with the user-facing CUDA callout**

`release.yml`'s `metadata` job hard-fails if `docs/release-notes/<version>.md` is missing or empty. Author it with at least:
```markdown
## Hardware acceleration

- CUDA acceleration now requires an **NVIDIA R580 or newer driver** (was ~R525). On older drivers, CUDA silently falls back to CPU until you update the driver.
- For Cohere on CUDA, cuDNN must be **cuDNN 9 built for CUDA 13** (9.20 or newer). Same file name as before (`cudnn64_9.dll` / `libcudnn.so.9`), so replace an older CUDA-12 cuDNN to avoid a runtime fallback.
- Supported GPUs are unchanged (Turing / RTX 20-series, GTX 16-series, or newer).
```

---

## Verification — the authoritative gate

### Task 14: CI dry-run of the release workflow

- [ ] **Step 1: Push the branch and trigger a dry-run**

```bash
git push -u origin feat/cuda-13
gh workflow run release.yml --ref feat/cuda-13
```
`workflow_dispatch` uploads a `release-<version>` Actions artifact instead of publishing.

- [ ] **Step 2: Watch both CUDA legs to green**

```bash
gh run watch
```
Expected green: `build-sidecar-posix` (linux CUDA) and `build-sidecar-windows` (windows CUDA on `windows-latest`/VS 2026). The Windows leg green is the real proof that CUDA 13.2's `visual_studio_integration` maps onto VS 18.

- [ ] **Step 3: Inspect the staged CUDA archives for the right runtime libs**

Download the `release-<version>` artifact and confirm each CUDA archive contains the four CUDA 13 runtime libs from the manifest (`cudart64_13.dll`/`libcudart.so.13`, …, `cufft64_12.dll`/`libcufft.so.12`) plus the two provider libs. A missing-runtime-lib also trips the existing `assemble-release-files.mjs` set checks at publish, but verify by hand on the first CUDA-13 build.

- [ ] **Step 4: (If isolating risk) run the staged dry-run**

Optional belt-and-suspenders: before Task 8 (the unpin), run one dry-run with CUDA 13.2 still on `windows-2022` to prove the toolkit/whisper/packaging changes independently of VS 2026; then unpin and re-run. Skip if the combined run is green.

---

## Optional hardening (propose to user; not required for the upgrade)

### Task 15 (optional): Close the Linux `libcurand.so.10` packaging gap

Issue #139 found the Linux ORT CUDA EP `NEED`s `libcurand.so.10`, which is **not** in `cuda-artifacts.json` today — Linux Cohere CUDA silently depends on a host-provided curand. **Verify before adding** (the soname may differ under cu13): during the dry-run, run `patchelf --print-needed` (or `ldd`) on the staged `libonnxruntime_providers_cuda.so` and enumerate its `NEEDED` CUDA libs. If `libcurand.so.NN` is required and unshipped, add it to `runtime.linux` in `cuda-artifacts.json` (and the Windows equivalent `curand64_NN.dll` if the win32 EP needs it — the cu13 Windows EP statically links cudart, so check rather than assume).

### Task 16 (optional): Auto-verify bundled runtime libs satisfy the provider's NEEDED set

Add a release-workflow step (Linux leg) that diffs the provider `.so`'s `NEEDED` CUDA libraries against `cuda-artifacts.json` `runtime.linux`, failing if the EP needs a CUDA lib the archive doesn't ship. This turns the class of bug behind Task 15 into a hard CI gate instead of a silent runtime fallback. Scope creep risk — only do if the user wants the hardening.

---

## Self-review (completed by author)

- **Spec coverage:** toolkit bump (T5), ORT cu13 selection (T3/T4), runtime sonames incl. cuFFT-major-12 correction (T6), Windows dir move handled defensively (T7), Windows unpin (T8), driver floor + cuDNN-9-for-CUDA-13 + all CUDA-12 doc refs (T9-T13), dependency hygiene (T1-T2), authoritative CI dry-run gate (T14). The two issue-#139 loose ends (curand gap, NEEDED-libs verifier) are captured as flagged optional tasks (T15-T16).
- **Type/name consistency:** `pickFirstExistingDir(candidates, exists)` is defined in T7 Step 3 and consumed in T7 Step 1 (test) and Step 5 (script) with the same signature. `ORT_CUDA_VERSION` value `13` is consistent across T3 and T4. cuFFT soname is `12` everywhere (T6, T9), the other three are `13`.
- **Placeholder scan:** the only deferred value is the release version in T13, which is a legitimate tag-time decision, not a content gap — the notes body is fully specified.
