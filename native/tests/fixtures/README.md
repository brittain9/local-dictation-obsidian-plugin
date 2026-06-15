# Audio fixtures

Known-good speech clips used by the sidecar transcription quality suite
(`tests/transcription_e2e.rs`, `tests/sidecar_protocol_e2e.rs`, and
`benches/transcription.rs`). Each clip has a verified reference transcript in
[`audio/manifest.json`](audio/manifest.json); the suite runs every clip through
the full sidecar and asserts the output against that reference.

## Format requirements

The sidecar consumes 16 kHz, mono, 16-bit little-endian PCM (20 ms frames). To
keep the suite fast and hermetic, **commit fixtures already in that format** so
no resampling is needed at test time. The harness validates the format on load
and fails loudly if a clip does not match.

## Adding a fixture

1. Add a small (`< ~1 MB`), permissively licensed, 16 kHz mono 16-bit WAV under
   `audio/`.
2. Add an entry to `audio/manifest.json` with its `reference` transcript,
   `anchors` (must-appear words), a `max_wer` budget, and `source` provenance
   (title, URL, license, sha256).
3. That's it — no code change. The data-driven suite picks it up automatically.

Prefer public-domain or clearly permissive sources, and record the exact URL,
license, and sha256 so provenance is auditable.

## Inventory

| File | Source | License | sha256 (prefix) |
| ---- | ------ | ------- | --------------- |
| `audio/jfk.wav` | JFK Inaugural Address (1961) excerpt, via [whisper.cpp `v1.7.5` samples](https://github.com/ggml-org/whisper.cpp/blob/v1.7.5/samples/jfk.wav) | Public Domain (U.S. federal government work, 17 U.S.C. § 105) | `59dfb9a4…` |
