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

## Remaining production work

- Implement the Rust synthesis adapter and autoregressive loop behind
  `engine-pocket-tts`, including cancellation, bounded audio-ahead flow
  control, PCM framing, and pitch-preserving speed processing.
- Add the task axis, English catalog artifacts/voices, installer subsets,
  protocol types, and task-aware capability probes.
- Add plugin extraction/segmentation, Web Audio playback, settings/model UI,
  commands/status UI, and dictation interlock.
- Add the English Whisper round-trip gate, manual acceptance guide, license
  attribution, and release note.
- Run the full Rust/TypeScript/release checks, perform the required Standards
  and Spec review, resolve findings, push, and open the PR.
