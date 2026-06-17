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

The corpus mixes one public-domain political-speech clip with several
[LibriSpeech](https://www.openslr.org/12/) read-speech utterances — distinct
speakers, lengths, and genres — so the suite exercises more than a single voice.
LibriSpeech references are the corpus's own official transcripts (kept verbatim;
the harness normalizes case and punctuation before scoring).

| File | Source | License | sha256 (prefix) |
| ---- | ------ | ------- | --------------- |
| `audio/jfk.wav` | JFK Inaugural Address (1961) excerpt, via [whisper.cpp `v1.7.5` samples](https://github.com/ggml-org/whisper.cpp/blob/v1.7.5/samples/jfk.wav) | Public Domain (U.S. federal government work, 17 U.S.C. § 105) | `59dfb9a4…` |
| `audio/3575-170457-0051.wav` | [LibriSpeech](https://www.openslr.org/12/) test-clean, utterance `3575-170457-0051` (speaker 3575) | CC BY 4.0 | `06072cea…` |
| `audio/1580-141084-0047.wav` | [LibriSpeech](https://www.openslr.org/12/) test-clean, utterance `1580-141084-0047` (speaker 1580) | CC BY 4.0 | `06c7526b…` |
| `audio/5683-32866-0024.wav` | [LibriSpeech](https://www.openslr.org/12/) test-clean, utterance `5683-32866-0024` (speaker 5683) | CC BY 4.0 | `7012971d…` |
| `audio/3729-6852-0040.wav` | [LibriSpeech](https://www.openslr.org/12/) test-clean, utterance `3729-6852-0040` (speaker 3729) | CC BY 4.0 | `7a0214b0…` |
| `audio/7021-79740-0000.wav` | [LibriSpeech](https://www.openslr.org/12/) test-clean, utterance `7021-79740-0000` (speaker 7021) | CC BY 4.0 | `d0d6bcf2…` |

LibriSpeech is derived from public-domain LibriVox audiobooks and distributed
under CC BY 4.0 (Panayotov et al., 2015); attribution is recorded per clip in
[`audio/manifest.json`](audio/manifest.json).
