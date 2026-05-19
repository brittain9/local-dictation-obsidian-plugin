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

| Platform | Support Status | Hardware Acceleration |
|---|---|---|
| macOS | Supported | Metal support for Whisper. |
| Linux Native | Supported | CUDA support for Whisper and Cohere on Turing-or-newer NVIDIA GPUs. |
| Linux Flatpak | Supported | CUDA supported on Turing-or-newer NVIDIA GPUs - [Flatpak GPU setup](docs/guides/linux-flatpak-gpu-setup.md). |
| Windows | Supported | CUDA support for Whisper and Cohere on Turing-or-newer NVIDIA GPUs. [Windows CUDA setup](docs/guides/windows-cuda-setup.md). |

## Runtime Dependencies

The CPU sidecar has no GPU runtime dependencies. macOS Whisper uses Metal through system frameworks automatically. Linux and Windows CUDA acceleration needs a Turing-or-newer NVIDIA GPU (RTX 20-series / GTX 16-series or newer) and a driver compatible with CUDA 12.9. Cohere CUDA additionally needs cuDNN 9 runtime libraries; without cuDNN, Cohere falls back to CPU.

See [Platform Runtime Dependencies](docs/release/platform-runtime-dependencies.md) for the full contract.

## Quick Start

Install Local Dictation from Obsidian's Community Plugins. Open `Settings → Local Dictation` and install the sidecar from the plugin settings — the plugin downloads it from the matching GitHub Release, verifies it, and stores it under the plugin's `bin/` directory. Then click `Manage models`, install a model, open a note, and start dictation from the ribbon button or via the `Local Dictation: Start dictation session` command.

The sidecar and model downloads are separate on purpose: Obsidian installs the plugin UI, the plugin installs the native sidecar, and the sidecar manages model downloads. Transcription runs locally after setup.

## Privacy & system access

Local Dictation runs transcription on your own machine. To do that, the plugin reaches beyond Obsidian's vault API in two specific ways. Both are surfaced by Obsidian's community-plugin review as `fs` and `child_process` warnings — this section is the audit trail for what they cover.

- **Filesystem (`fs`)** — used to install the native sidecar into the plugin's `bin/` directory, to manage Whisper and Silero model files cached outside the vault, and to write transient audio dumps when transcription fails and you have diagnostics enabled. No vault content is read or written through `fs`; that goes through Obsidian's editor API.
- **Process execution (`child_process`)** — used to spawn the local Rust sidecar (`local-dictation-sidecar`) and stream PCM audio to it over stdio. The command path is the installed binary; no shell is invoked and no part of the command is user-supplied.
- **Network** — used only to download the sidecar archive once from this repository's GitHub Releases and to fetch model files from their official sources on demand. There is no telemetry, no analytics, no account, and no background traffic after setup.

The source of truth for these accesses is [`src/sidecar/sidecar-installer.ts`](src/sidecar/sidecar-installer.ts) and the IPC layer in [`src/sidecar/`](src/sidecar/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, setup, scripts, branching conventions, PR workflow, and architecture overview.

## License

MIT. See [LICENSE](LICENSE).
