# Local Dictation

Private, on-device speech-to-text for Obsidian. Dictate notes with Whisper or Cohere Transcribe; clean up with a local Ollama model.

[![GitHub release](https://img.shields.io/github/v/release/brittain9/local-dictation-obsidian-plugin?style=flat-square)](https://github.com/brittain9/local-dictation-obsidian-plugin/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/brittain9/local-dictation-obsidian-plugin?style=flat-square)](https://github.com/brittain9/local-dictation-obsidian-plugin/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

## Features

- **Cohere Transcribe** — a [Hugging Face Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard)-topping engine, running locally.
- **Whisper** — mature offline transcription with a range of size/speed options.
- **Silero v6 VAD** — [enterprise-grade neural voice activity detection](https://github.com/snakers4/silero-vad) for real-time speech boundary detection.
- **Optional Ollama LLM cleanup** — polish dictated text with a local LLM.
- **One-click model management** — browse, download, and remove models from inside the plugin.
- **Hardware acceleration** — Metal on macOS, CUDA on Linux/Windows (Turing-or-newer NVIDIA GPUs).
- **Private and offline** — transcription stays on-device. No cloud, no telemetry, no account. Only model downloads need a network.

## Platform Support

| Platform | Hardware Acceleration |
|---|---|
| macOS | Metal for Whisper (automatic via system frameworks). |
| Linux | CUDA for Whisper and Cohere on Turing-or-newer NVIDIA GPUs. Flatpak installs need a [GPU setup step](docs/guides/linux-flatpak-gpu-setup.md). |
| Windows | CUDA for Whisper and Cohere on Turing-or-newer NVIDIA GPUs — see [Windows CUDA setup](docs/guides/windows-cuda-setup.md). |

CPU works everywhere with no extra dependencies. CUDA acceleration requires an RTX 20-series / GTX 16-series or newer GPU with a driver compatible with CUDA 12.9; Cohere on CUDA also needs cuDNN 9 (falls back to CPU without it). Full details in [Platform Runtime Dependencies](docs/release/platform-runtime-dependencies.md).

## Quick Start

Install Local Dictation from Obsidian's Community Plugins. Open `Settings → Local Dictation` and install the sidecar from the plugin settings — the plugin downloads it from the matching GitHub Release, verifies it, and stores it under the plugin's `bin/` directory. Then click `Manage models`, install a model, open a note, and start dictation from the ribbon button or via the `Local Dictation: Start dictation session` command.

The sidecar and model downloads are separate on purpose: Obsidian installs the plugin UI, the plugin installs the native sidecar, and the sidecar manages model downloads. Transcription runs locally after setup.

## Privacy

Local Dictation is built to be private. Your audio and your notes never leave your machine. There is no account, no cloud service, no telemetry, and no background network traffic.

To make local transcription work, the plugin does a few things outside Obsidian's vault:

- **Installs a helper program.** A small native "sidecar" is downloaded once from this repository's GitHub Releases and stored inside the plugin's folder. The plugin runs this helper locally to do the actual transcription.
- **Stores model files on disk.** Whisper and voice-activity models are cached outside your vault so they aren't duplicated per-vault. You can browse and remove them from the plugin's model manager.
- **Uses the network only for downloads.** The sidecar archive and model files are fetched from their official sources on demand. Nothing else is sent anywhere.

Your vault contents are only read and written through Obsidian's normal editor API — your notes or audio never leaves your machine.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, setup, scripts, branching conventions, PR workflow, and architecture overview.

## License

MIT. See [LICENSE](LICENSE).
