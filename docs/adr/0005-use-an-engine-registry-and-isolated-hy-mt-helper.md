---
status: accepted
---

# Use a translation-engine registry and isolated HY-MT helper

Translation is exposed through stable engine IDs rather than through a generic model selector. Firefox Translations remains the backward-compatible fast, literal default and continues to run in a plugin Web Worker. Tencent HY-MT is an optional natural, paraphrastic engine covering its documented 38 languages all-to-all; unsupported Firefox pairs automatically use HY-MT.

HY-MT inference runs in a version-matched helper shipped beside every sidecar. The main sidecar launches that exact sibling path and supervises bounded framed stdin/stdout, cancellation, shutdown, and a five-minute idle lifetime. Keeping llama.cpp in the helper avoids the Whisper/llama.cpp GGML symbol collision without adding a user-installed service, localhost API, or `PATH` dependency. The model itself remains a direct, explicit, hash-verified upstream download and is not redistributed.

The plugin owns a controller-level translation job, so closing the preview only detaches the view. One active Natural inference is allowed; the status bar reopens it, explicit Cancel aborts it, and completed output stays recoverable until applied, dismissed, or replaced.
