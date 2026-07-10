# Local Dictation

[![GitHub release](https://img.shields.io/github/v/release/brittain9/local-dictation-obsidian-plugin?style=flat-square)](https://github.com/brittain9/local-dictation-obsidian-plugin/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/brittain9/local-dictation-obsidian-plugin?style=flat-square)](https://github.com/brittain9/local-dictation-obsidian-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

**Private speech-to-text, directly in your Obsidian notes.** Dictate with live text or capture a meeting from your microphone and system audio. Transcription runs on your device, with no account or cloud service required.

Optional text transformations can run locally through Ollama or remotely through OpenRouter. Remote processing is off until you configure and select it; audio is never sent to either provider.

[Install Local Dictation from Obsidian Community Plugins](https://obsidian.md/plugins?id=local-dictation)

## See it in action

![Obsidian showing Local Dictation's active waveform icon and provisional Moonshine text in a disposable vault](docs/media/live-dictation.png)

_Live Moonshine output captured while the real plugin transcribed a synthetic audio file through Chromium's test microphone._

![Obsidian reading view showing synthetic meeting notes with a microphone and system audio source, timestamped speaker labels, and action items](docs/media/meeting-notes.png)

_A synthetic meeting note demonstrates the system-audio, timestamp, and speaker-label workflow without exposing a real vault._

![Local Dictation setup wizard explaining streaming Moonshine and batch Whisper models in a disposable Obsidian vault](docs/media/setup-wizard.png)

_The first-run wizard installs the native engine and helps you choose between live and batch transcription._

## Choose your workflow

| Workflow | What happens | Model fit |
| --- | --- | --- |
| **Live dictation** | Provisional words appear and revise in place while you speak. | Moonshine streaming models |
| **Notes and drafts** | Final text lands at your cursor after each pause. | Whisper or Cohere Transcribe batch models |
| **Meetings and calls** | Add computer audio to microphone capture, then optionally label speakers and add timestamps. | Whisper or Cohere Transcribe batch models |

All transcription models in the current catalog run locally and support English. Moonshine is optimized for live dictation; speaker labels currently require a batch model.

## Features

- **Live text.** Moonshine streaming models show provisional words and revise them in place until each utterance finalizes.
- **Meeting capture.** Include system audio from meetings, calls, or videos alongside your microphone on Windows, Linux, and macOS 14.2 or later.
- **Speaker labels.** Optional on-device diarization assigns session-stable speaker labels. Speaker embeddings stay in memory and are discarded after the session.
- **Timestamps.** Add elapsed or wall-clock timestamps at configurable intervals.
- **Local model choices.** Choose Whisper, Cohere Transcribe, or Moonshine models and download them from Settings.
- **Optional text transformation.** Clean up, summarize, extract action items, or apply a custom prompt through local Ollama or remote OpenRouter models.
- **Explicit remote controls.** Keep transformations local, allow OpenRouter only for oversized transcripts, or disable remote and LLM features entirely.

## Getting started

1. [Install **Local Dictation** from Community Plugins](https://obsidian.md/plugins?id=local-dictation).
2. Follow the setup wizard to download the native speech-to-text engine and a starter model.
3. Click the microphone in the ribbon, or bind a hotkey to **Local Dictation: Toggle dictation**, and start talking. Text lands at your cursor.

The engine and models need a one-time download. Transcription then works without an ongoing network connection.

## Platform support

Published sidecar builds currently target Apple silicon on macOS and x86-64 on Windows and Linux.

| Platform | CPU | Hardware acceleration | System audio |
| --- | --- | --- | --- |
| **macOS (Apple silicon)** | Supported | Metal is automatic for Whisper | macOS 14.2 or later |
| **Windows (x86-64)** | Supported | Optional CUDA on a recent NVIDIA GPU | Supported |
| **Linux (x86-64)** | Supported | Optional CUDA on a recent NVIDIA GPU | Supported through PulseAudio/PipeWire |

macOS and Windows are the primary tested targets. On Linux, the plugin is used daily on Fedora (native and Flatpak); other distributions should work but are not routinely verified. If something breaks on yours, [open an issue](https://github.com/brittain9/local-dictation-obsidian-plugin/issues).

For CUDA requirements and Flatpak-specific setup, see the [CUDA setup guide](docs/guides/cuda-setup.md).

## Privacy

- **Transcription stays local.** Audio is processed by the native sidecar on your computer and is not uploaded for transcription.
- **Downloads are explicit.** The sidecar comes from GitHub Releases; model files come from the source URLs shown in the model catalog. Downloaded engine and model files live outside your vault.
- **Remote cleanup uses text, not audio.** If you configure and select OpenRouter, it receives the transcript plus any note context you choose to include. Ollama requests stay on your computer through its loopback interface.
- **Remote processing is optional.** You can disable OpenRouter routing or all LLM features from Settings. If you use OpenRouter, configure its provider and zero-data-retention controls to match your requirements.
- **Speaker identity is session-only.** Diarization embeddings are held in memory for the active session and are not persisted as voice profiles.

## Contributing

Local Dictation pairs a TypeScript plugin with a Rust sidecar for inference. See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture, setup, and workflow.

## License

Local Dictation is MIT-licensed; see [LICENSE](LICENSE).

The bundled sidecar models are openly licensed: Silero VAD (MIT) for voice activity detection, WeSpeaker (CC BY 4.0) for speaker embeddings, and pyannote segmentation (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full attributions. Transcription model licenses are shown in the model catalog before download.
