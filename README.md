# Local Dictation

Run private, GPU-accelerated dictation directly in Obsidian with Whisper, Cohere Transcribe, Silero VAD, and optional LLM processing via Ollama.

## Features
- **Cross-platform design** — built for desktop Obsidian on macOS, Linux, and Windows.
- **Cohere Transcribe support** — use a [Hugging Face Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard)-topping speech recognition model directly inside Obsidian.
- **Whisper support** — choose a mature offline transcription model with a wide range of size and performance options.
- **Silero v6 voice activity detection** — [enterprise-grade neural VAD](https://github.com/snakers4/silero-vad) for accurate, real-time speech boundary detection.
- **Optional LLM processing via Ollama** — clean up dictated text with a local LLM when you want an extra pass.
- **One-click model management** — browse, download, and remove models from inside the plugin.
- **Hardware acceleration** — supports Metal on macOS and CUDA on Linux/Windows with Turing-or-newer NVIDIA GPUs.
- **Obsidian-native experience** — integrates cleanly with the app through native settings, commands, and interface elements.
- **English-first** — optimized for English; other languages supported where engines allow
- **Privacy-first** — transcription happens locally, with no cloud processing, no telemetry, and no account required for model downloads.
- **Offline after setup** — only model downloads require a network connection

## Platform Support

| Platform | Support Status | Hardware Acceleration |
|---|---|---|
| macOS | Supported | Metal support for Whisper. |
| Linux Native | Supported | CUDA support for Whisper and Cohere on Turing-or-newer NVIDIA GPUs. |
| Linux Flatpak | Supported | CUDA supported on Turing-or-newer NVIDIA GPUs - [Flatpak GPU setup](docs/guides/linux-flatpak-gpu-setup.md). |
| Windows | Supported | CUDA support for Whisper and Cohere on Turing-or-newer NVIDIA GPUs. [Windows CUDA setup](docs/guides/windows-cuda-setup.md). |

## Runtime Dependencies

The CPU sidecar has no GPU runtime dependencies. On macOS, Whisper can use Metal through system frameworks; CUDA, cuDNN, and the CUDA Toolkit are not required.

Linux and Windows CUDA acceleration requires an NVIDIA Turing-generation or newer GPU, meaning compute capability 7.5 or newer. In consumer GPU terms, that means RTX 20-series / GTX 16-series or newer. CUDA release archives bundle the CUDA runtime libraries used by Whisper CUDA, so release users do not need to install the CUDA Toolkit or `nvcc`.

Use an NVIDIA driver compatible with CUDA 12.9. NVIDIA's CUDA 12.9 release notes list Linux driver 575.51.03+ and Windows driver 576.02+ as the toolkit release baseline. Cohere CUDA additionally requires cuDNN 9 runtime libraries; when cuDNN is not available, Cohere falls back to CPU with an explicit runtime status.

For the full platform contract, see [Platform Runtime Dependencies](docs/release/platform-runtime-dependencies.md). NVIDIA references: [CUDA 12.9 release notes](https://docs.nvidia.com/cuda/archive/12.9.0/cuda-toolkit-release-notes/index.html) and [CUDA GPU compute capability](https://developer.nvidia.com/cuda-gpus).

## Quick Start

### Users

The community-plugin package contains only Obsidian's three plugin files:

- `main.js`
- `manifest.json`
- `styles.css`

After those files are installed, open `Settings -> Local Dictation` and install the sidecar from the plugin settings. The plugin downloads the sidecar archive from the `sidecar-<version>` GitHub Release that matches its own `manifest.version`, verifies it, and stores it under the plugin's `bin/` directory. Then click `Manage models`, install a model, open a note, and start dictation from the ribbon button or `Local Dictation: Start dictation session`.

The sidecar and model downloads are separate on purpose: Obsidian installs the plugin UI, the plugin installs the native sidecar, and the sidecar manages model downloads. Transcription runs locally after setup.

### Manual Release Install

For manual testing of a published release, download these files from the same GitHub Release tag and place them in `<vault>/.obsidian/plugins/local-dictation/`:

```text
main.js
manifest.json
styles.css
```

Restart Obsidian or reload plugins, enable `Local Dictation`, then use the settings page to download the sidecar and models.

Do not mix plugin files from one version with sidecar assets from another version. Sidecar downloads are version-locked to `manifest.version`, not to the latest GitHub Release.

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
