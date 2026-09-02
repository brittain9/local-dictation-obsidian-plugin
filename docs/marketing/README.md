# Product marketing copy

This document is the source of truth for Speech Kit's positioning and externally managed listing copy.

## Brand

**Speech Kit** (two words, both capitalized) — formerly Local Dictation. The plugin ID remains `local-dictation` permanently; only the product name changed.

Use "formerly Local Dictation" in externally visible copy (README, listing long description, release announcements) through at least three releases after the rename, then drop it.

## Messaging core

- **Category:** The speech and language toolkit for Obsidian.
- **Brand line:** Obsidian handles the notes. Speech Kit handles speech and language.
- **Product arc:** Dictate. Transcribe. Translate. Listen.
- **Product promise:** Everything you need to work with speech and language, right inside your notes.
- **Differentiator:** Competing tools do one slice — transcription, or read aloud, or translation — and often in the cloud. Speech Kit does all of it locally, inside the note-centered workflow.
- **Local advantage:** Download the models you want and use them without a transcription or translation account, metered speech API, or ongoing connection.

The positioning hierarchy is: **speech and language capabilities** → powered by local-first technology → guided by privacy. Local and privacy are principles and proof, not the category. Do not lead with "no cloud"; lead with what the toolkit does.

### Principles (not headlines)

- Local-first
- Private by default
- High-quality models
- Fast
- Extensible

### Vocabulary

- Prefer concrete capability words (dictation, transcription, translation, read aloud, speaker labels) over "AI".
- "ML" and "LLM" are acceptable as implementation details; models are how the product works, not what it is.
- Never name-drop specific competitor products in published copy.

## Product status

Public listing copy presents live dictation, meeting transcription, transcript transformation, local translation, and local read aloud as available.

## Repository-managed copy

### README

The root [README](../../README.md) contains the complete product narrative. Its opening position is:

> **The speech and language toolkit for Obsidian.**

### Manifest and package description

`manifest.json` is the source for the plugin description. Keep `package.json.description` identical.

```text
Local speech and language toolkit for notes. Dictate, transcribe meetings, translate text, and read notes aloud with on-device models.
```

This copy intentionally omits "Obsidian" because the Community Plugins validator rejects descriptions that repeat the host application's name.

## GitHub About

Repository: [brittain9/speech-kit-obsidian-plugin](https://github.com/brittain9/speech-kit-obsidian-plugin)

### Description

```text
The speech and language toolkit for Obsidian. Dictate into Markdown, transcribe meetings, translate text, and read notes aloud with on-device models. Formerly Local Dictation.
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

Listing: [Speech Kit](https://community.obsidian.md/plugins/local-dictation) — the URL keeps the original plugin ID.

The Overview tab is populated from the root README. The short description and long About description are managed separately and must be updated manually.

### Short description

Use the same copy as `manifest.json.description`:

```text
Local speech and language toolkit for notes. Dictate, transcribe meetings, translate text, and read notes aloud with on-device models.
```

### Long description

```text
Obsidian handles the notes. Speech Kit handles speech and language.

Speech Kit — formerly Local Dictation — is a complete speech and language toolkit built into your vault.

Dictate live into Markdown or switch to a higher-accuracy model when final wording matters. Capture meetings from your microphone and system audio with optional speaker labels and timestamps.

Translate selections or whole notes locally with the model and language direction you choose. Firefox directions download as small packs on demand, and note text is never sent to a translation service. Review the result before replacing, inserting, or copying it.

Read any note aloud with natural on-device voices. Speech-to-text and text-to-speech belong in the same note-centered workflow.

Shape raw transcripts into useful notes with optional LLM-powered cleanup, summaries, action items, and custom prompts - local or remote, your choice. Audio is never sent to a cleanup provider.

Choose the engine that fits the job: streaming or batch, English or multilingual, CPU or accelerated. Download a model once and start talking - no transcription account, speech API key, metered credits, or ongoing connection.
```

## Update checklist

When the product positioning or feature status changes:

1. Update the root README.
2. Update `manifest.json.description` and mirror it to `package.json.description`.
3. Update the GitHub About description, website, and topics.
4. Manually update the Obsidian short description.
5. Manually update the Obsidian long About description.
6. Verify the rendered GitHub repository and Obsidian listing.

## Future visual work

The README has matching light and dark hero banners. Functional screenshots, GIFs, and other visual proof remain deferred so they never block a copy update. Target shot list:

1. GIF: live dictation with streaming text revising in place
2. GIF: translate selection with the review preview
3. GIF: read aloud with playback controls
4. Screenshot: model browser / catalog
5. Screenshot: settings surface

An icon pass for the Speech Kit identity is likewise deferred; the ribbon microphone iconography is unchanged by the rename.
