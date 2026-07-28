# Contributing

A TypeScript Obsidian plugin (`src/`) paired with a native Rust sidecar (`native/`)
that handles local speech inference. Dictation audio crosses the boundary as
16 kHz mono PCM over stdin and transcripts return as JSON events. For read
aloud, the plugin extracts text from Markdown, the sidecar synthesizes it, and
model-native mono PCM (24 or 44.1 kHz) returns over stdout for Web Audio
playback in the plugin.

See [docs/system-architecture.md](docs/system-architecture.md) for the pipeline stages, the engine registry, and the wire protocol.

## Prerequisites

- Node.js `24.14.1`, npm `11.12.1`
- TypeScript `6.0.3`
- Rust `1.94.1`
- CMake and a platform C/C++ toolchain for native sidecar builds
- CUDA Toolkit `13.2` with `nvcc` for Linux/Windows CUDA sidecar builds only

The recommended Node version is pinned in `package.json` `engines` (a compatibility floor, not an exact pin) and the Rust toolchain in `rust-toolchain.toml`. If you use [mise](https://mise.jdx.dev), `mise install` sets up the Node and Rust toolchains automatically.

The CUDA Toolkit is a build-from-source dependency. Published Linux/Windows CUDA sidecar archives bundle the CUDA runtime libraries needed to accelerate Whisper through whisper.cpp; release users need only a Turing-or-newer NVIDIA GPU and an R595 or newer driver. The archives use CUDA 13.2 with a PTX-only compute 7.5 target, so they require CUDA 13.2's native driver branch rather than CUDA minor-version compatibility.

## Getting it running

Install dependencies:

```sh
npm install
```

For fast frontend iteration, symlink or clone this repo into `<vault>/.obsidian/plugins/local-dictation`, run watch mode, and reload Obsidian after rebuilds:

```sh
npm run build:sidecar
npm run dev
```

For release-style local testing without cutting a GitHub Release, build the output and copy it into a test vault:

```sh
npm run build:frontend
npm run build:sidecar
npm run install:dev -- --vault ~/Documents/test-vault-stt --sidecars --enable
```

This installs the built `main.js`, `manifest.json`, and `styles.css` into the vault. With `--sidecars`, it also copies locally built sidecars into the plugin-local `bin/cpu` and `bin/cuda` layout. That lets you test the installed-plugin path without publishing a GitHub Release first.

For Linux CUDA testing:

```sh
npm run install:dev:cuda -- --vault ~/Documents/test-vault-stt
```

This one-command flow builds the frontend, CPU sidecar, and CUDA sidecar,
verifies the build output, prunes stale files from the vault's installed plugin
directory, then installs and enables the plugin. It prints a step-by-step status
log and an override report. Existing vault-local `data.json` is preserved by
default; pass `--reset-data` to wipe it too.

For macOS testing, `npm run build:sidecar` builds the Metal-capable sidecar automatically.

## Scripts

**Build:**
```sh
npm run build            # build sidecar + bundle plugin
npm run build:frontend   # bundle plugin only (skip sidecar rebuild)
npm run build:sidecar    # build sidecar only
npm run build:sidecar:cuda            # Linux CUDA sidecar
npm run build:sidecar:cuda:windows    # Windows CUDA sidecar
npm run dev              # watch mode for plugin
npm run install:dev -- --vault <vault> --sidecars --enable
npm run install:dev:cuda -- --vault <vault> # build CPU+CUDA and force-install
```

**Test and check:**
```sh
npm run test             # TypeScript unit tests
npm run test:system-audio # Manual hardware smoke for native system audio
npm run typecheck        # type checking
npm run lint             # Biome linting
npm run check            # full quality gate (TS + Rust)
```

**Format:**
```sh
npm run format           # auto-format with Biome
```

## Quality gates

`npm run check` is the single quality gate. It runs:

- **TypeScript:** typecheck, lint (Biome), test (Vitest), build (esbuild)
- **Rust:** `cargo build`, `cargo fmt --check`, `cargo clippy`, `cargo test`

Do not merge with failing CI.

## Translating the plugin

English is the source of truth for user-visible plugin copy. Translation catalogs live in
`src/locales/`, with one TypeScript module per Obsidian locale code. To add a language, copy an
existing non-English catalog, translate its values, and register it in `src/locales/index.ts`.
The locale does not need to be one of Speech Kit's supported dictation languages.

Keep catalog keys identical to `src/locales/en.ts`, preserve placeholders such as `{provider}`
and `{max}` exactly, and leave product names such as Speech Kit, Obsidian, Ollama,
OpenRouter, CUDA, and model names untranslated. Use the language's natural punctuation and UI
wording rather than translating English syntax literally. If an English key has not been
translated yet, omit it: the UI falls back to English for that key.

Run `npm run test -- test/locales-parity.test.ts` before opening a translation PR. The parity
test rejects unknown keys and changed placeholders, and reports catalog coverage. Also run
`npm run typecheck` to verify that the catalog is registered correctly.

## Workflow

Trunk-based development. `main` stays releasable at all times.

- All meaningful work happens on short-lived branches merged via PR.
- Branches should live days, not weeks.
- CI must pass before merge. Squash-merge preferred for single-concern PRs.
- Direct pushes to `main` are acceptable only for trivial fixes (typos, comment corrections).

### Branch naming

Use a prefix that describes the type of change:

| Prefix | Use |
|---|---|
| `feat/` | New feature or capability |
| `fix/` | Bug fix |
| `refactor/` | Code restructuring without behavior change |
| `docs/` | Documentation only |
| `chore/` | Build, CI, tooling, or repo maintenance |

Examples: `feat/punctuation-stage`, `fix/cohere-segments`, `chore/ci-caching`.

### Pull requests

1. Create a PR against `main`.
2. Fill out the PR template.
3. Wait for CI to pass (`npm run check` runs typecheck, lint, test, build, cargo fmt, clippy, cargo test).
4. Merge when green.

Keep PRs small and focused. One concern per PR.

## Versioning

Releases use calendar versioning in the form `YYYY.M.MICRO`:

- `YYYY` — four-digit year
- `M` — month, no leading zero
- `MICRO` — release counter within that month, starting at `1`

`2026.7.2` is the second release of July 2026. The third number is **not** a day-of-month; multiple releases on the same day just increment the counter.

Rules:

- Every new version must sort above all previously published versions (Obsidian's updater compares versions numerically), so the four-digit year is permanent — a two-digit year like `26.x` would read as a downgrade and existing installs would stop receiving updates.
- Versions up to and including `2026.6.9` used day-of-month numbering, so June 2026 counters continue from `2026.6.10`. From July 2026 onward the counter starts at `1` each month.

A version bump touches `manifest.json`, `package.json` + `package-lock.json`, `versions.json`, and `native/Cargo.toml` + `native/Cargo.lock`.
