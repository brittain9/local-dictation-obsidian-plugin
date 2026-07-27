# Product marketing copy

This document is the source of truth for Local Dictation's positioning and externally managed listing copy.

## Messaging core

- **Category:** Local voice and language tools for Obsidian.
- **Brand line:** Obsidian handles the notes. Local Dictation handles voice and language.
- **Product arc:** Dictate. Transcribe. Translate. Listen.
- **Product promise:** A complete private voice and language workflow built into your notes.
- **Local advantage:** Download the models you want and use them without a transcription or translation account, metered speech API, or ongoing connection.

Local and privacy are supporting proof. The headline is one note-centered
workflow for spoken input, translation, and read aloud.

## Product status

Public listing copy presents live dictation, meeting transcription, transcript
transformation, local translation, and local read aloud as available.

## Repository-managed copy

### README

The root [README](../../README.md) contains the complete product narrative. Its opening position is:

> **Obsidian handles the notes. Local Dictation handles voice and language.**

### Manifest and package description

`manifest.json` is the source for the plugin description. Keep `package.json.description` identical.

```text
Private local voice and language tools for notes. Dictate, transcribe meetings, translate text, and read notes aloud with on-device models.
```

This copy intentionally omits “Obsidian” because the Community Plugins validator rejects descriptions that repeat the host application's name.

## GitHub About

Repository: [brittain9/local-dictation-obsidian-plugin](https://github.com/brittain9/local-dictation-obsidian-plugin)

### Description

```text
Local voice and language tools for Obsidian. Dictate into Markdown, transcribe meetings, translate text, and read notes aloud with on-device models.
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
- `machine-translation`
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
Private local voice and language tools for notes. Dictate, transcribe meetings, translate text, and read notes aloud with on-device models.
```

### Long description

```text
Obsidian handles the notes. Local Dictation handles voice and language.

Local Dictation adds a complete spoken workflow to your vault. Dictate live into Markdown or switch to a higher-accuracy model when final wording matters.

Capture meetings from your microphone and system audio with optional speaker labels and timestamps.

Choose the speech engine that fits the job: streaming or batch, English or multilingual, CPU or accelerated. Download a model once and start talking - no transcription account, speech API key, metered credits, or ongoing connection.

Shape raw transcripts into useful notes with optional cleanup, summaries, action items, and custom prompts through local Ollama or remote OpenRouter. Audio is never sent to a cleanup provider.

Read any note aloud with natural on-device voices. Speech-to-text and text-to-speech belong in the same note-centered workflow.

Translate selections or whole notes between English and seven other languages
with a local model pack. Review the result before replacing, inserting, or
copying it; note text is never sent to a translation service.
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
