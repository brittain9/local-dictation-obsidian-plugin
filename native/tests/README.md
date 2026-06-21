# Sidecar test suite

Two tiers of tests live here, on top of the per-module unit tests in `src/`:

| File | Tier | Needs a model? | Runs in `cargo test`? |
| ---- | ---- | -------------- | --------------------- |
| `registry_smoke.rs` | Smoke | no | yes |
| `harness_unit.rs` | Unit (harness + fixtures) | no | yes |
| `transcription_e2e.rs` | End-to-end accuracy (in-process) | yes | only with `--ignored` |
| `sidecar_protocol_e2e.rs` | End-to-end contract (real binary, wire protocol) | yes | only with `--ignored` |

The end-to-end tier is the quality suite: it feeds known audio fixtures through
the **full sidecar** and asserts the transcript. The benchmark in
`../benches/transcription.rs` is its performance arm.

## Layout

```
tests/
  common/            shared harness (one responsibility per module)
    audio.rs           WAV fixture -> 16 kHz mono PCM 20 ms frames
    text.rs            normalize + Word Error Rate + anchor checks
    manifest.rs        loads the reference corpus (fixtures/audio/manifest.json)
    model.rs           acquires a whisper model (env path | cache | catalog download)
    driver.rs          runs frames through the sidecar (in-process + subprocess)
  fixtures/
    audio/*.wav        committed, 16 kHz mono 16-bit clips
    audio/manifest.json reference transcripts + per-fixture quality budgets
  harness_unit.rs
  transcription_e2e.rs
  sidecar_protocol_e2e.rs
```

## Running

Fast tests (no model, run in CI):

```sh
cargo test --manifest-path native/Cargo.toml
```

Full end-to-end quality suite (downloads a tiny whisper model on first run):

```sh
npm run test:sidecar:e2e
# or directly:
cargo test --manifest-path native/Cargo.toml --release \
  --test transcription_e2e --test sidecar_protocol_e2e -- --ignored --nocapture
```

> Use `--release`: whisper.cpp inference in a debug build is dramatically slower.

Benchmark:

```sh
cargo bench --manifest-path native/Cargo.toml --bench transcription
```

## Model acquisition

The e2e tests and the benchmark resolve a whisper model in this order:

1. `STT_TEST_WHISPER_MODEL` — absolute path to an existing `ggml-*.bin` model.
2. A cached download under `STT_TEST_MODEL_DIR` (default: a temp subdirectory),
   verified by sha256 and reused across runs.
3. A fresh download of the smallest bundled catalog model
   (`whisper_tiny_en_q8_0`) from the catalog's pinned URL, verified and cached.

Because the URL and sha256 come straight from the bundled `catalog.json`, there
is no duplicated model metadata to drift.

## Adding a fixture

See [`fixtures/README.md`](fixtures/README.md). In short: drop a small,
permissively licensed, 16 kHz mono 16-bit WAV in `fixtures/audio/`, add an entry
to `fixtures/audio/manifest.json`, and the data-driven suite picks it up — no
code change.

## Design notes

- **Two drivers, one harness.** `transcribe_in_process` drives the public
  `AppState` API exactly as `main.rs` does (minus stdio framing) — fast feedback
  over the real VAD, worker thread, and inference. `transcribe_via_process`
  spawns the actual binary and speaks the length-prefixed stdin/stdout protocol
  the TypeScript plugin uses, guarding that wire contract. They share fixture
  decoding, model acquisition, and scoring.
- **Fuzzy assertions.** ASR output varies across model versions and backends, so
  the suite asserts a Word Error Rate budget plus must-appear "anchor" words
  rather than exact strings. The intent is regression detection (garbage output,
  empty transcripts, broken wiring), not enforcing a specific decoder revision.
- **`#[ignore]` by default.** The model dependency and inference cost keep the
  e2e tier out of the fast `cargo test` path; CI runs it in the dedicated
  `sidecar-e2e` workflow (manual + weekly), with the model cached.
