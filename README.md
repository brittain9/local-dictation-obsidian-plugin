# Local Dictation

Private, on-device speech-to-text for Obsidian. Dictate notes with Whisper or Cohere Transcribe; transform the text with a local LLM (Ollama), or route oversized jobs to OpenRouter.

[![GitHub release](https://img.shields.io/github/v/release/brittain9/local-dictation-obsidian-plugin?style=flat-square)](https://github.com/brittain9/local-dictation-obsidian-plugin/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/brittain9/local-dictation-obsidian-plugin?style=flat-square)](https://github.com/brittain9/local-dictation-obsidian-plugin/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

## ✨ Features

- **Cohere Transcribe** — a [Hugging Face Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard)-topping engine, running locally.
- **Whisper** — mature offline transcription with a range of size/speed options.
- **Silero v6 VAD** — [enterprise-grade neural voice activity detection](https://github.com/snakers4/silero-vad) for real-time speech boundary detection.
- **Optional LLM transformation** — clean up, rewrite, or summarize dictated text with a local model (Ollama) or OpenRouter. Keep everything local, or auto-route a job to OpenRouter once it outgrows your machine.
- **One-click model management** — browse, download, and remove models from inside the plugin.
- **Hardware acceleration** — Metal on macOS, CUDA on Linux/Windows (Turing-or-newer NVIDIA GPUs).
- **Private and offline** — transcription stays on-device. No cloud, no telemetry, no account. Only model downloads need a network.

## 💻 Platform Support

| Platform | Hardware Acceleration |
|---|---|
| macOS | Metal for Whisper (automatic via system frameworks). |
| Linux | CUDA for Whisper and Cohere on Turing-or-newer NVIDIA GPUs. Flatpak installs need a [GPU setup step](docs/guides/linux-flatpak-gpu-setup.md). |
| Windows | CUDA for Whisper and Cohere on Turing-or-newer NVIDIA GPUs — see [Windows CUDA setup](docs/guides/windows-cuda-setup.md). |

CPU works everywhere with no extra dependencies. CUDA acceleration requires an RTX 20-series / GTX 16-series or newer GPU with a driver compatible with CUDA 12.9; Cohere on CUDA also needs cuDNN 9 (falls back to CPU without it). Full details in [Platform Runtime Dependencies](docs/release/platform-runtime-dependencies.md).

> **Linux distro coverage.** macOS and Windows are the primary tested targets. On Linux, the plugin is regularly used on Fedora 44; other distributions (Arch, Ubuntu, Debian, etc.) should work but are not routinely verified. If you hit a problem on your distro, please open an issue with details.

> **macOS Voice Isolation.** If transcription quality drops on macOS, open Control Center → Mic Mode and set it to **Standard**. Voice Isolation and Wide Spectrum are applied by Core Audio at the system level and can clip sibilants in ways the plugin can't override.

## 🚀 Quick Start

Install Local Dictation from Obsidian's Community Plugins. On first run, a **setup wizard** walks you through downloading the speech engine and picking a transcription model — that's the easiest path.

If you'd rather do it manually, open `Settings → Local Dictation`: install the sidecar from the sidecar section, then click **Manage models** to download a model. Either way, once setup finishes you can dictate from the mic in the ribbon, or bind a hotkey to the `Local Dictation: Toggle dictation` command.

Where things live:

- **Sidecar binary:** inside the plugin folder, under `.obsidian/plugins/local-dictation/bin/`.
- **Models:** stored outside your vault, in your user data directory, so they aren't duplicated per-vault:
  - Windows: `%LOCALAPPDATA%\obsidian-local-stt\models`
  - macOS: `~/Library/Application Support/obsidian-local-stt/models`
  - Linux: `~/.local/share/obsidian-local-stt/models`

## 🔒 Privacy

Local Dictation is built to be private. By default, your audio and notes never leave your machine — no account, no telemetry, no background network traffic, and transcription always runs on-device. The only way text leaves your machine is the optional OpenRouter transform, and only when you turn it on.

To make local transcription work, the plugin does a few things:

- **Installs a helper program.** A small native "sidecar" is downloaded once from this repository's GitHub Releases and stored inside the plugin's folder. The plugin runs this helper locally to do the actual transcription.
- **Stores model files on disk.** Whisper and voice-activity models are cached outside your vault so they aren't duplicated per-vault. You can browse and remove them from the plugin's model manager.
- **Uses the network only for downloads — and OpenRouter, if you opt in.** The sidecar archive and model files are fetched from their official sources on demand. Nothing else is sent anywhere unless you enable OpenRouter transformation.
- **Optional OpenRouter transformation (off by default).** LLM transformation is opt-in and runs locally through Ollama by default. If you choose OpenRouter as the transform provider — or turn on automatic routing of large jobs — the transcript text and any note context you include are sent to OpenRouter for that step only; your audio is never sent. You can scope your OpenRouter key to privacy-respecting endpoints, and you set the size threshold above which jobs are routed.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, setup, scripts, branching conventions, PR workflow, and architecture overview.

## 📄 License

MIT. See [LICENSE](LICENSE).
