# Pocket TTS implementation record

This is the durable execution log for issue #288. Requirements and design
decisions remain authoritative in [`tts-pocket.md`](tts-pocket.md); this file
records what was actually done, the evidence collected, and what remains.

## Branch and staging

- Branch: `feat/tts-pocket`.
- Base specification commit: `3ad2f58` (`docs: specify Pocket TTS phase 0`).
- Work is kept in a dedicated linked worktree because the original checkout's
  Git metadata is mounted read-only in the agent environment.
- No model weights, generated audio, binaries, caches, or Python bytecode may
  be committed.

## 2026-07-19 — Phase 0

Status: complete and committed in `0a8fb8a`.

Decisions:

- Select the existing ONNX Runtime route with INT8 graphs.
- Reject the `pocket-tts` Candle crate even though its 2.28 MiB compressed
  binary delta passes the 20 MiB gate: version 0.6.2 cannot load the pinned
  April 2026 model and its quantized API is a placeholder.
- Do not download or initialize `mimi_encoder.onnx` in Stage A. Precomputed
  voice state files bypass the voice-cloning encoder.
- Use sidecar-side, pitch-preserving time stretch for `ttsSpeed`; the model has
  no speaking-rate control and Web Audio `playbackRate` would shift pitch.
- Ship only English in Stage A. The French 24-layer validation is slower than
  real time at two threads (RTF 1.068), so all 24-layer language entries remain
  Stage B pending smaller-variant benchmarks or an explicit hardware floor.
- Install the English runtime with Alba by default. Manage Models exposes
  Cosette, Fantine, Javert, Jean, and Marius as verified optional voice
  artifacts; settings and the reading status UI select among installed voices.

Evidence:

- Exact size, RTF, waveform, and command record:
  [`scripts/pocket-tts-phase0/README.md`](../../scripts/pocket-tts-phase0/README.md).
- Exact artifact URLs, immutable revisions, sizes, and SHA-256 values for all
  six specified variants:
  [`scripts/pocket-tts-phase0/artifacts.json`](../../scripts/pocket-tts-phase0/artifacts.json).
- The repository's exact `ort = 2.0.0-rc.12` binding loaded all five exported
  graph families. The full autoregressive loop was validated against the
  pinned Python ONNX runner; production will port that loop to Rust.
- The decoder contract is 24-kHz mono float32; protocol output will quantize to
  PCM16LE.
- English INT8 two-thread RTF: 0.323. English ORT-default RTF: 0.452.
- The maintainer's labeled listening comparison found no material audible
  fp32-to-INT8 regression.

Contradictions corrected in the spec amendment:

- `babybirdprd/pocket-tts` is a third-party community port, not first-party
  Kyutai code.
- `KevinAHM/pocket-tts-onnx/generate.py` is a generation CLI, not a conversion
  script. No reproducible exporter is published in that repository.
- The pinned ONNX revision already contains all six requested variants.
- The open-items section's 25 MiB value disagreed with D1's 20 MiB gate.

## 2026-07-19 — Stage A1 catalog and build contract

Status: complete at the current commit boundary.

Implemented:

- Added the explicit `stt`/`tts` task axis to family capabilities, family
  descriptors, and catalog models. Existing adapters report STT; validation
  rejects family/model task mismatches.
- Added task-relevant capability fields for available voices, speed control,
  and output sample rate, including wire-format regression coverage.
- Added synthesis and voice artifact roles. Voice artifacts carry an explicit
  `voiceId`; catalog validation rejects implicit filename/ID conventions and
  requires a TTS model's default voice to reference a declared voice artifact.
- Added `ModelFamilyId::PocketTts` and the `engine-pocket-tts` production build
  feature. The release and Rust-check scripts now compile it with the other
  engines, and ONNX Runtime is enabled when Pocket TTS is the only ONNX engine.
- Added the pinned English INT8 catalog model. Required install content is the
  runtime plus Alba (131,654,174 bytes); Cosette, Fantine, Javert, Jean, and
  Marius are explicit optional voice artifacts.
- Made `whisper-rs` genuinely optional. Previously, a no-default-features build
  still compiled Whisper, which violated the existing per-engine feature
  boundary and prevented an isolated Pocket TTS build.

Verification at this boundary:

- Catalog tests: 8 passed, including bundled Pocket TTS pins/default voice and
  task/voice validation.
- Capability tests: 5 passed with no default engine features.
- `git diff --check`: clean.

Resume point:

- Implement an incremental verified artifact install. Installing one optional
  voice must download only that voice, preserve the existing runtime, merge
  install metadata, and expose installed voice IDs to the plugin. The intended
  regression test was explored but deliberately not committed in a red state.
- Confirmed `bos_before_voice.npy` is not needed by the native precomputed
  voice-state path. It is used only when conditioning raw voice embeddings;
  Stage A restores the safetensor flow state directly. The production catalog
  excludes it and the required-download total was reduced by 4,224 bytes.

## 2026-07-19 — Stage A implementation

Implemented the verified incremental voice installer, native autoregressive
INT8 adapter, cancellation and bounded flow control, PCM framing,
pitch-preserving speed processing, Markdown extraction and range mapping,
Web Audio playback, task-aware model settings, installed-voice selection,
commands, status controls, and dictation interlock.

Verification at this boundary:

- 269 Pocket-only native unit tests passed.
- The pinned English model synthesized non-silent 24-kHz audio through the
  production Rust adapter.
- The pinned sentence round-tripped through the repository's Whisper Tiny
  product adapter at 0.000 WER.
- TypeScript type checking and the focused extraction, playback, controller,
  connection, protocol, command, settings, and model-manager tests passed.

Remaining release work is the full repository quality suite, the required
Standards and Spec review with all findings resolved, PR publication, and
green hosted checks.
