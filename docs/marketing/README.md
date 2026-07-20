# Product marketing copy

This document is the source of truth for Local Dictation's positioning and externally managed listing copy.

## Messaging core

- **Category:** Local speech for Obsidian.
- **Brand line:** Obsidian handles the notes. Local Dictation handles the speech.
- **Product arc:** Dictate. Transcribe. Listen.
- **Product promise:** A complete spoken workflow built into your notes.
- **Local advantage:** Download the models you want and use them without a transcription account, metered speech API, or ongoing connection.

Local and privacy are supporting proof. The headline is a unified speech experience that turns spoken input into useful notes and reads those notes aloud.

## Product status

Public listing copy presents live dictation, meeting transcription, transcript transformation, and local read-aloud as available.

The root [README](../../README.md) temporarily retains its current “coming next” qualifier for text-to-speech. Remove that qualifier when the read-aloud work is merged into the release branch.

## Repository-managed copy

### README

The root [README](../../README.md) contains the complete product narrative. Its opening position is:

> **Obsidian handles the notes. Local Dictation handles the speech.**

### Manifest and package description

`manifest.json` is the source for the plugin description. Keep `package.json.description` identical.

```text
Local speech-to-text and text-to-speech for notes and meetings. Dictate live, transcribe microphone and system audio with Whisper and other models, add speaker labels and timestamps, shape transcripts, and read notes aloud.
```

This copy intentionally omits “Obsidian” because the Community Plugins validator rejects descriptions that repeat the host application's name.

## GitHub About

Repository: [brittain9/local-dictation-obsidian-plugin](https://github.com/brittain9/local-dictation-obsidian-plugin)

### Description

```text
Local speech for Obsidian. Dictate live into Markdown, transcribe meetings and system audio, shape transcripts, and read notes aloud with on-device speech models.
```

### Website

```text
https://community.obsidian.md/plugins/local-dictation
```

### Topics

- `obsidian-plugin`
- `dictation`
- `speech-to-text`
- `text-to-speech`
- `speech-recognition`
- `transcription`
- `whisper`
- `meeting-notes`
- `read-aloud`
- `local-first`
- `llm`
- `writing`

## Obsidian listing

Listing: [Local Dictation](https://community.obsidian.md/plugins/local-dictation)

The Overview tab is populated from the root README. The short description and long About description are managed separately and must be updated manually.

### Short description

Use the same copy as `manifest.json.description`:

```text
Local speech-to-text and text-to-speech for notes and meetings. Dictate live, transcribe microphone and system audio with Whisper and other models, add speaker labels and timestamps, shape transcripts, and read notes aloud.
```

### Long description

```text
Obsidian handles the notes. Local Dictation handles the speech.

Local Dictation adds a complete spoken workflow to your vault. Dictate live into Markdown or switch to a higher-accuracy model when final wording matters.

Capture meetings from your microphone and system audio with optional speaker labels and timestamps.

Choose the speech engine that fits the job: streaming or batch, English or multilingual, CPU or accelerated. Download a model once and start talking - no transcription account, speech API key, metered credits, or ongoing connection.

Shape raw transcripts into useful notes with optional cleanup, summaries, action items, and custom prompts through local Ollama or remote OpenRouter. Audio is never sent to a cleanup provider.

Read any note aloud with natural on-device voices. Speech-to-text and text-to-speech belong in the same note-centered workflow.
```

## Update checklist

When the product positioning or feature status changes:

1. Update the root README.
2. Update `manifest.json.description` and mirror it to `package.json.description`.
3. Update the GitHub About description, website, and topics.
4. Manually update the Obsidian short description.
5. Manually update the Obsidian long About description.
6. Verify the rendered GitHub repository and Obsidian listing.

## Deferred visual work

Screenshots, GIFs, and other visual proof are intentionally deferred. Add them in a separate marketing pass rather than blocking this copy update.
