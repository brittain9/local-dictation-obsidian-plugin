# Local Dictation

On-device dictation plugin for Obsidian. Talk directly into your notes with fast accurate transcription from top models running on your CPU or GPU.

[![GitHub release](https://img.shields.io/github/v/release/brittain9/local-dictation-obsidian-plugin?style=flat-square)](https://github.com/brittain9/local-dictation-obsidian-plugin/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/brittain9/local-dictation-obsidian-plugin?style=flat-square)](https://github.com/brittain9/local-dictation-obsidian-plugin/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

Transcription runs entirely on your device. No accounts or cloud required. A fast rust sidecar handles the inference and all models can be downloaded directly in the settings.

## Features

- **Top models, run locally.** Whisper or Cohere Transcribe, on CPU or GPU. Cohere Transcribe currently tops the [Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard).
- **Speaker labels.** Optional on-device diarization tags who's talking — for interviews, meetings, and calls. Nothing is stored; voiceprints live in memory for the session only.
- **System audio.** Transcribe your computer's output — meetings, calls, videos — not just your mic. Available on Windows and Linux.
- **Timestamps.** Optionally stamp phrases with elapsed or wall-clock time — handy for meetings and interviews.
- **LLM presets.** Clean up, summarize, pull out action items, or reshape a transcript with built-in or custom presets, run through a local model (Ollama) or OpenRouter.
- **Auto routing.** Keep cleanup fully local, or have only oversized transcripts route automatically to OpenRouter for a bigger model and larger context window.
- **Runs on your hardware.** Metal on macOS, CUDA on recent NVIDIA GPUs, CPU everywhere else.

## 🚀 Getting started

Install **Local Dictation** from Obsidian's Community Plugins. A setup wizard downloads the engine and a starter model on first launch.

Then click the microphone in the ribbon, or bind a hotkey to **Local Dictation: Toggle dictation**, and start talking. Text lands at your cursor.

## Platform support

CPU works everywhere with no extra setup. Hardware acceleration is available for faster transcription — use Metal (macOS, automatic) or CUDA on a recent NVIDIA GPU (RTX 20-series / GTX 16-series or newer, with a current driver). See the [CUDA setup guide](docs/guides/cuda-setup.md) to enable it.

macOS and Windows are the primary tested targets. On Linux, the plugin is used daily on Fedora 44 (native and Flatpak); other distributions should work but aren't routinely verified. If something breaks on yours, [open an issue](https://github.com/brittain9/local-dictation-obsidian-plugin/issues).

## 🔒 Privacy

Your audio never leaves your device — transcription is always local. The sidecar and models download once from GitHub Releases, and model files live outside your vault.

Local LLMs are limited in capability, so you can route your transcribed text to OpenRouter for frontier models and much larger context windows. Restrict it to ZDR endpoints and approved providers in OpenRouter to match your own privacy standards. Remote LLM features turn off with a single toggle, and a second toggle disables all LLM features in the plugin.

## Contributing

A TypeScript plugin paired with a rust sidecar for inference. See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture, setup, and workflow.

## License

Local Dictation is MIT-licensed — see [LICENSE](LICENSE).

The models bundled in the sidecar are openly licensed too: Silero VAD (MIT) for voice activity detection, plus the diarization models WeSpeaker (CC-BY-4.0) and pyannote segmentation (MIT). Full attributions are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
