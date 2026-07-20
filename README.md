# Local Dictation

**Cross-platform, multilingual dictation for Obsidian — local by default.**

Local Dictation adds a native speech layer to Obsidian so you can dictate notes, capture meetings, and turn spoken ideas into Markdown without leaving your vault. It runs high-quality speech models on your computer by default, supports eight localized UI languages, and lets you choose the model and text-processing workflow that fits your machine.

[Install Local Dictation from Obsidian Community Plugins](https://obsidian.md/plugins?id=local-dictation)

## Why use it

- **Dictate where you write.** Start from the ribbon, command palette, or hotkey and place text directly at your cursor in the active Markdown note.
- **Use it in your language.** The plugin UI is localized in English, Spanish, German, French, Portuguese, Italian, Dutch, and Japanese. Multilingual dictation is available with supported Whisper Large V3 Turbo and Nemotron 3.5 ASR models.
- **Stay local by default.** Speech recognition runs in a native sidecar on your computer. Model downloads are explicit, and transcription does not require an account or ongoing network connection after setup.
- **Bring your own workflow.** Choose streaming dictation for live text, batch transcription for longer recordings and meetings, optional speaker labels and timestamps, and optional LLM cleanup through local Ollama or remote OpenRouter.
- **Built for the desktop Obsidian workflow.** Local Dictation supports Windows, macOS, and Linux release targets, including system-audio capture for calls, videos, and meetings where the platform allows it.

## What you can do

| Workflow | Best for | Models |
| --- | --- | --- |
| **Live dictation** | Drafting notes and ideas with text that appears while you speak. | Moonshine streaming models for English; experimental Nemotron 3.5 ASR for multilingual streaming. |
| **Accurate note capture** | Dictating polished notes, journals, drafts, and longer thoughts after pauses. | Whisper Large V3 Turbo, Cohere Transcribe, and other managed batch models. |
| **Meetings and calls** | Capturing microphone plus system audio, then adding timestamps and optional speaker labels. | Batch models such as Whisper or Cohere Transcribe. |
| **Text transformation** | Cleaning up raw transcripts, summarizing, extracting action items, or applying custom prompts. | Optional Ollama or OpenRouter text models; audio is not sent to cleanup providers. |

## Languages

Local Dictation is release-ready for a multilingual Obsidian workflow:

| Language | UI localization | Dictation support |
| --- | --- | --- |
| English | Yes | Yes |
| Spanish / Español | Yes | Yes |
| German / Deutsch | Yes | Yes |
| French / Français | Yes | Yes |
| Portuguese / Português | Yes | Yes |
| Italian / Italiano | Yes | Yes |
| Dutch / Nederlands | Yes | Yes |
| Japanese / 日本語 | Yes | Yes |

Multilingual dictation depends on the selected model. Whisper Large V3 Turbo and Nemotron 3.5 ASR support the verified language set and automatic detection. Moonshine, Cohere Transcribe, and `.en` Whisper models remain English-only. Manual language selection is recommended when you know the language; automatic detection chooses one language per utterance and is not a guarantee for code-switching within a single utterance.

## Getting started

1. Install **Local Dictation** from [Obsidian Community Plugins](https://obsidian.md/plugins?id=local-dictation).
2. Open Obsidian settings and follow the Local Dictation setup wizard.
3. Download the native sidecar and at least one speech model.
4. Start dictating from the ribbon microphone, command palette, or the **Local Dictation: Toggle dictation** hotkey.

The sidecar and models are downloaded once. After that, local transcription works without an ongoing network connection.

## Platform support

Published sidecar builds currently target Apple silicon on macOS and x86-64 on Windows and Linux.

| Platform | CPU | Hardware acceleration | System audio |
| --- | --- | --- | --- |
| **macOS (Apple silicon)** | Supported | Metal is automatic for Whisper | macOS 14.2 or later |
| **Windows (x86-64)** | Supported | Optional CUDA on a recent NVIDIA GPU | Supported |
| **Linux (x86-64)** | Supported | Optional CUDA on a recent NVIDIA GPU | Supported through PulseAudio/PipeWire |

macOS and Windows are the primary tested targets. On Linux, the plugin is used daily on Fedora native and Flatpak installs; other x86-64 glibc distributions are compatibility targets rather than distro-specific guarantees. See the [Linux support guide](docs/guides/linux-support.md) for package, audio-stack, Flatpak, and troubleshooting details.

For GPU requirements and sandbox-specific setup, see the [CUDA setup guide](docs/guides/cuda-setup.md).

## Local by default, flexible when you need it

- **Speech recognition runs locally.** Audio is processed by the native sidecar on your computer and is not uploaded for transcription.
- **Downloads are explicit.** The sidecar comes from GitHub Releases. Model files come from the source URLs shown in the model catalog and use a shared local data directory outside your vault by default.
- **Text cleanup is optional.** You can keep transformations local with Ollama, allow remote OpenRouter models, route only oversized transcripts remotely, or disable LLM features entirely.
- **Remote cleanup receives text, not audio.** If you configure and select OpenRouter, it receives the transcript plus any note context you choose to include. Configure provider and retention settings to match your requirements.
- **Session recovery is short-lived.** Recent utterance and cleanup recovery state is kept in memory and can be disabled or cleared from commands/settings.

## Roadmap

Local Dictation is becoming a local-first speech and language layer for Obsidian. Text-to-speech is the next major direction, alongside tighter note-aware workflows that make spoken input and audio output feel native inside your vault.

## Development

Local Dictation pairs a TypeScript Obsidian plugin with a Rust native sidecar for inference. See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture, setup, and workflow.

## Project links

[Community Plugin](https://obsidian.md/plugins?id=local-dictation) · [Latest release](https://github.com/brittain9/local-dictation-obsidian-plugin/releases/latest) · [Issues](https://github.com/brittain9/local-dictation-obsidian-plugin/issues) · [License](LICENSE)

Third-party component and model licenses are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and shown in the model catalog before download.
