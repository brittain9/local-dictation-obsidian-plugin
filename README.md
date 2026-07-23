# Local Dictation

**Obsidian handles the notes. Local Dictation handles the speech.**

Your notes already have Markdown, links, properties, search, templates, and a place in your knowledge system. Local Dictation adds the missing spoken workflow directly to that foundation.

Dictate live. Transcribe meetings. Shape the result. Listen to notes with local voices.

[Install Local Dictation from Obsidian Community Plugins](https://obsidian.md/plugins?id=local-dictation)

## Speech that belongs to the note

Local Dictation does more than paste a transcript at the cursor. It manages an active dictation session inside the note you are editing.

Streaming text can develop and revise in place. Final utterances land in Markdown. Meeting capture can combine your microphone with system audio, timestamps, and optional speaker labels.

When the raw transcript needs work, transform it in context with local Ollama or remote OpenRouter models. Recovery commands preserve a short-lived path back to recent raw text.

The note remains the center of the workflow from capture through refinement.

## One tool, three directions

### Dictate

Use a streaming model when seeing words immediately helps you think. Use a batch model when accuracy after each pause matters more.

### Transcribe

Capture meetings, calls, interviews, or videos with microphone and system audio on supported platforms. Add timestamps and speaker labels when the selected model supports them.

### Listen

Run **Read aloud** from the command palette or bind it to a hotkey. It reads the
selected text when there is a selection, or starts at the beginning of the note
when there is not. Pocket TTS playback stays local and provides active controls
for language/model, speed, voice, pause/resume, and stop without adding another
ribbon icon.

## Model choice without model management pain

Choose the speech engine that fits the job, then install it from Settings.

| Need | Options |
| --- | --- |
| Responsive live English text | Moonshine streaming models |
| Multilingual live text | Experimental Nemotron 3.5 ASR |
| Higher-accuracy notes | Whisper Large V3 Turbo, Cohere Transcribe, and other batch models |
| Local read aloud | Pocket TTS in English, French, German, Spanish, Portuguese, and Italian |
| Local text cleanup | Ollama |
| Selected remote text cleanup | OpenRouter |

The setup wizard gets the native engine and first model in place. You can change models later as your language, hardware, or workflow changes.

## Designed for repeated use

Start dictation from the ribbon, command palette, or hotkey. For read aloud, the
recommended workflow is the **Read aloud** command bound to a hotkey, with the
selection context menu as a discoverable alternative. Model downloads are
managed. Session state is controlled. Short-lived recovery can restore a recent
utterance or the raw text behind a cleanup.

The goal is dictation reliable enough to become muscle memory.

## Languages

The complete interface is available in English, Spanish, German, French, Portuguese, Italian, Dutch, and Japanese.

Whisper Large V3 Turbo and Nemotron 3.5 ASR support the verified multilingual set. Moonshine, Cohere Transcribe, and `.en` Whisper models remain English-only.

Automatic detection chooses one language per utterance. Manual selection produces the most predictable transcription and cleanup behavior.

## Getting started

1. Install **Local Dictation** from [Community Plugins](https://obsidian.md/plugins?id=local-dictation).
2. Follow the setup wizard to download the native engine and a speech model.
3. Select **Try dictation now** or begin from the ribbon microphone, command palette, or a hotkey.

The initial downloads replace provider setup. Local transcription requires no speech API key, account, usage credits, or ongoing network connection.

## Platform support

| Platform | Architecture | Acceleration | System audio |
| --- | --- | --- | --- |
| macOS | Apple silicon | Metal for Whisper | macOS 14.2 or later |
| Windows | x86-64 | Optional NVIDIA CUDA | Supported |
| Linux | x86-64 glibc | Optional NVIDIA CUDA | PulseAudio or PipeWire |

macOS and Windows are the primary tested targets. Fedora native and Flatpak installs are used daily. See the [Linux support guide](docs/guides/linux-support.md) and [CUDA setup guide](docs/guides/cuda-setup.md).

## Local by default, flexible by choice

- Audio is processed locally for speech recognition.
- Note text is synthesized locally for read aloud.
- Model downloads are visible and explicit.
- Transcription remains available offline after setup.
- Ollama transformations stay on your computer.
- OpenRouter is optional and receives text, not audio, only when you select it.
- Speaker embeddings and recovery records are short-lived rather than stored as profiles.

## Support development

If Local Dictation is useful to you, you can support continued local-first development:

<a href="https://buymeacoffee.com/alexbrittaq"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="217"></a>

## Development and project links

Local Dictation pairs a TypeScript plugin with a Rust native sidecar. See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture, setup, and development workflow.

[Community Plugin](https://obsidian.md/plugins?id=local-dictation) · [Latest release](https://github.com/brittain9/local-dictation-obsidian-plugin/releases/latest)

[Issues](https://github.com/brittain9/local-dictation-obsidian-plugin/issues) · [License](LICENSE)

Third-party component and model licenses are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and shown before model download.
