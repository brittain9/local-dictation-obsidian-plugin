# Discord posts: May-July 2026

## May 20, 2026 at 7:13 PM

**Reactions:** 9 bookmarks, 2 stars.

**Attachment:** Short product demo video (not archived here).

### Local Dictation v2026.5.20

Fast, accurate, on-device speech-to-text for Obsidian. No cloud, no account, no telemetry.

✨ Highlights

- Cohere Transcribe (tops the HF Open ASR Leaderboard) and Whisper, both running locally
- Silero v6 VAD for speech boundary detection
- One-click model manager inside the plugin, no CLI setup
- Hardware acceleration: Metal on macOS, CUDA on Linux/Windows (Turing+), CPU fallback everywhere
- Setup wizard on first run

Source: https://github.com/brittain9/local-dictation-obsidian-plugin
Install: https://community.obsidian.md/plugins/local-dictation

Feedback and issues very welcome

Demo (video below)

Short clip shows the LLM processing in action. ✨ Ships with some built-in presets: Clean up, Professional writing, TLDR, Markdown formatting, and a Voice commands mode. You can also save your own custom presets for LLM post-processing from the settings.

## May 24, 2026 at 11:51 AM

**Reactions:** None.

### Local Dictation 2026.5.24

Hey everyone

I just released Local Dictation 2026.5.24

Local Dictation is a private, accurate speech-to-text plugin for Obsidian designed for live audio transcription from your mic as you work in your vault that includes many features:

- Cohere Transcribe (leading open source speech-to-text model) support
- Whisper (tried and true local OpenAI model) support
- Time stamps
- Local LLM processing via Ollama
- Smart paragraph formatting
- Setup wizard to get you going in less than 2 minutes
- Keep the note you are dictating into open and freely talk and explore your vault
- And many other features to customize transcription for how you speak

New in this release:

- Audio input device selection
- Obsidian Plugin and native sidecar version drift detection
- Refined reactive audio wave ribbon button
- And performance improvements and bug fixes

Many more features planned. Please try it out and reach out if you have any issues or star to support the project

Install: https://community.obsidian.md/plugins/local-dictation
Source: https://github.com/brittain9/local-dictation-obsidian-plugin

## June 11, 2026 at 5:32 PM

**Reactions:** 5 bookmarks, 2 fires.

**Attachment:** ChatGPT-generated promotional image (not archived here).

### Local Dictation 2026.6.10

First — thank you for 225+ downloads! Genuinely awesome to see people using this.

For anyone new: Local Dictation is private speech-to-text for Obsidian. You talk, it types into your note, and transcription runs 100% on your machine — no accounts, no cloud, no telemetry.

This update is about what happens after transcription: cleaning up raw dictation with an LLM. Until now that was local-only through Ollama. Now you can also route cleanup through OpenRouter for access to frontier models — and the new Auto mode means you don't have to think about it: everyday dictations stay on your machine, and only long transcripts that would hang on a local model go to the cloud.

What's new:

- Local / Remote / Auto routing for LLM cleanup — Ollama on-device, OpenRouter remote, Auto picks by transcript size
- Remote kill switch — one toggle guarantees no transcript ever leaves your device
- Searchable OpenRouter model picker — with live price tiers (Free / $–$$$$) so cost is visible before you pick
- Preset manager — create, edit, duplicate, or delete your own cleanup presets alongside the built-ins
- Presets can add instead of replace — TLDR puts a summary above your untouched transcript; a new Action items preset appends a checklist
- Plus security hardening, bug fixes, and performance improvements.

On privacy: local is in the name for a reason. Transcription never leaves your device, and LLM features are optional and off by default. Want remote? OpenRouter supports zero data retention (ZDR) endpoints, and a one-click test button verifies your key and model end to end.

Try it: search "Local Dictation" in Community Plugins, or:

🔗 https://community.obsidian.md/plugins/local-dictation
🔗 https://github.com/brittain9/local-dictation-obsidian-plugin

Feedback and feature requests welcome — I read everything. 🙏

## June 23, 2026 at 11:23 PM

**Reactions:** 3 stars, 2 bookmarks.

**Attachment:** ChatGPT-generated promotional image (not archived here).

### Local Dictation 2026.6.23

Two new features in this release:

- Speaker diarization — automatically labels who said what in multi-speaker recordings.
- System audio capture — transcribe audio playing on your computer, not just your mic.

Try it: search "Local Dictation" in Community Plugins, or:

🔗 https://community.obsidian.md/plugins/local-dictation
🔗 https://github.com/brittain9/local-dictation-obsidian-plugin

## July 5, 2026 at 4:09 PM

**Reactions:** 4 bookmarks.

### Local Dictation — live dictation is here

Talk into your Obsidian notes and watch the words land. Local Dictation is private, on-device speech-to-text: no accounts, no cloud, nothing leaves your machine.

What's new

- Live dictation — new Moonshine streaming models show words as you speak and finalize on a pause. Tiny, Small, and Medium; Small is the sweet spot.
- Three top model families, all local — Whisper, Cohere Transcribe, and Moonshine, on CPU or GPU.
- Clearer model picker — settings now show which models dictate live vs. transcribe after a pause.
- More reliable & responsive — streaming finalization is more accurate and stays smooth through long dictation.

Plus on-device speaker labels, system-audio capture, and optional local LLM cleanup.

Get it: Obsidian → Settings → Community Plugins → search "Local Dictation". https://community.obsidian.md/plugins/local-dictation https://github.com/brittain9/local-dictation-obsidian-plugin

## July 10, 2026 at 7:31 PM

**Reactions:** None.

**Thread reply:** “What’s with your version number? Is that a date? That isn’t how software versioning works?”

### Local Dictation 2026.7.4 is out — private, offline speech-to-text for Obsidian

Dictate notes or transcribe entire meetings 100% locally — nothing ever leaves your machine. Local Whisper transcription with speaker labels, timestamps, and optional AI cleanup. No subscription, no API key, no cloud.

What's new in 2026.7.4:

✨ Try dictation right from setup — finish the wizard and jump straight into a real dictation session. Zero to talking-to-your-vault in one click.

📌 Dictation stays in the right note — browse your vault mid-dictation and your transcript keeps landing exactly where you started it.

🛡️ Safer, smarter recovery — clearer guidance when something goes wrong, and if a note changes underneath an active session, dictation now stops safely instead of writing to the wrong spot.

If you've been meaning to try voice notes or meeting transcription without shipping your audio to someone else's server, now's a great time:

👉 Install from Community Plugins: https://obsidian.md/plugins?id=local-dictation

Feedback and feature requests welcome: https://github.com/brittain9/local-dictation-obsidian-plugin

## July 14, 2026 at 6:19 PM

**Reactions:** 3 bookmarks.

### Local Dictation 2026.7.6 is out

Speech-to-text that runs 100% on your device — no cloud, no API keys, nothing leaves your vault.

Why people pick it up:

🔒 Fully local & private — choose from top models run on-device, offline
⚡ Live dictation — words appear as you speak and refine in place, Apple-Dictation style
🧑‍🤝‍🧑 Meeting capture — record system audio alongside your mic, with automatic speaker labels and timestamps

New in this release:

- Never lose a sentence — new commands reinsert your last utterance or restore the raw transcript if an AI cleanup mangles it
- Better timestamps — drop them in every few minutes, at each sentence, or at paragraph breaks
- Cap speaker labels — tell diarization how many speakers to expect (1–8) so it stops inventing extras
- Plus general fixes and stability improvements across settings, live transcription, and microphone handling

Grab it from Community Plugins → "Local Dictation" or see the full notes: https://github.com/brittain9/local-dictation-obsidian-plugin/releases/tag/2026.7.6

## July 18, 2026 at 12:43 PM

**Reactions:** 2 thumbs up, 1 sparkles.

### Local Dictation is now multilingual 🌍

Local Dictation turns your speech into text right inside Obsidian — running entirely on your machine. The latest release adds the biggest feature yet:

🗣️ Dictate in 8 languages — English, Spanish, German, French, Portuguese, Italian, Dutch, and Japanese via Whisper Large V3 Turbo. Pick your language or let it auto-detect.
⚡ Live multilingual dictation with the new NVIDIA Nemotron 3.5 ASR engine, which streams text as you speak in any of the eight languages.
🎯 No guesswork — settings only offer languages your installed model's weights actually support.
📊 Every language is certified against real human speech recordings before release, and the full quality report (per-language error rates, latency, streaming responsiveness) is public: https://github.com/brittain9/local-dictation-obsidian-plugin/blob/main/docs/quality/multilingual-quality-report.md

Why I built it this way:

- Completely free and MIT-licensed — no accounts, no credit cards, no API keys. Install, click a few buttons, start talking.
- Works offline. Everything runs locally and your voice never leaves your machine — no per-hour API costs, no audio sitting on someone's server.
- Cross-platform, with the same experience on Windows, macOS, and Linux.
- The engine is built in — no cloud API to configure, no self-hosted endpoint to babysit. Models install from a catalog inside settings, and dictation, meeting transcription, and cleanup all live where your notes already are.
- Optional AI cleanup with your own OpenRouter key, stored in Obsidian's Secret Storage instead of plain-text settings.

Next up: localizing the plugin's UI itself into all eight languages.

📦 Install: https://community.obsidian.md/plugins/local-dictation
⭐ GitHub: https://github.com/brittain9/local-dictation-obsidian-plugin
☕ If it saves you time: https://buymeacoffee.com/alexbrittaq

## July 20, 2026 at 8:27 PM

**Reactions:** None.

### Local Dictation now speaks your language!

🌍🎙️ Local Dictation now speaks your language!

🇪🇸 El dictado local ya está en tu idioma.
🇩🇪 Lokales Diktieren gibt es jetzt in deiner Sprache.
🇫🇷 La dictée locale est maintenant disponible dans votre langue.
🇵🇹 O ditado local agora está no seu idioma.
🇮🇹 La dettatura locale ora è nella tua lingua.
🇳🇱 Lokaal dicteren is er nu in jouw taal.
🇯🇵 ローカル音声入力があなたの言語で使えるようになりました。

The complete Local Dictation interface is now localized in 8 languages: English, Spanish, German, French, Portuguese, Italian, Dutch, and Japanese.

🎤 Dictate directly into your notes
📝 Transcribe meetings using microphone and system audio
🌎 Use local multilingual speech models
✨ Clean up and transform transcripts with optional AI tools
🔒 Keep speech recognition local and private by default

Available for macOS Apple silicon, Windows x64, and Linux x64.

🔊 And stay tuned: the next update will let you listen to your notes using high-quality, natural-sounding local text-to-speech models—without the robotic voices you might expect.

🚀 Install Local Dictation from Obsidian:
https://obsidian.md/plugins?id=local-dictation

⭐ View the project on GitHub:
https://github.com/brittain9/local-dictation-obsidian-plugin

## July 23, 2026 at 6:58 PM

**Reactions:** 2 “Nice” reactions.

### Local Dictation: natural, private text-to-speech is here

Local Dictation can now read your Obsidian notes aloud with Pocket TTS - with natural, non-robotic speech that runs 100% locally on your device.

There are no usage fees, no text sent to a cloud service, and no internet connection required after downloading a model. Your notes stay private, and TTS is free to use.

The new experience is deliberately command-first:

- Bind Local Dictation: Read aloud to any hotkey.
- Select text to read only that selection, or run the command with nothing selected to read the full note.
- While reading, compact controls appear for the model, voice, speed, pause/resume, and stop - without adding more ribbon clutter.
- Choose local models and voices, with pitch-preserving playback speeds from 0.75× to 2×.

Dedicated Pocket TTS models are available for English, French, German, Spanish, Portuguese, and Italian.

I chose Pocket TTS first because its voices have more natural prosody and sound less robotic than lightweight alternatives such as Supertonic.

Supertonic is planned as a future option for 31-language coverage and faster synthesis on lower-powered CPUs.

Get Local Dictation from the [Obsidian Community Plugins directory](https://obsidian.md/plugins?id=local-dictation).

You can also see the full [2026.7.11 release on GitHub](https://github.com/brittain9/local-dictation-obsidian-plugin/releases/tag/2026.7.11).

Please reach out with bugs and feature requests - especially what you'd like to see more of in future releases:

- More languages
- Local Translation
- More TTS models and voices
- Deeper Obsidian integration

Try it and let me know what would make local read-aloud more helpful for accessibility in your workflow.

## July 26, 2026 at 3:28 PM

**Reactions:** 3 bookmarks.

### Local Dictation 2026.7.12

Speak into your notes, and have your notes speak back to you — all locally on your device and 100% free.

What's new

🔊 Local Dictation now supports Supertonic 3 for fast, lightweight text-to-speech that runs efficiently on your CPU — no GPU or cloud service required.

Supertonic 3 supports 31 languages, with eight currently available in Local Dictation: English, Spanish, German, French, Portuguese, Italian, Dutch, and Japanese. It also includes 10 built-in voices.

This release also includes general stability fixes, performance improvements, smoother model installation and recovery, improved CUDA setup, and security fixes.

[GitHub](https://github.com/brittain9/local-dictation-obsidian-plugin) | [Changelog](https://github.com/brittain9/local-dictation-obsidian-plugin/releases/latest) | [Obsidian](https://obsidian.md/plugins?id=local-dictation) | [Buy me a](https://buymeacoffee.com/alexbrittaq) ☕

## July 29, 2026 at 10:33 PM

**Reactions:** 3 bookmarks.

### Local Dictation is now Speech Kit

🎙️ Local Dictation is now Speech Kit
The speech and language toolkit for Obsidian

Local Dictation has grown beyond dictation. Speech Kit brings tools that are usually split across separate apps into one place inside the note editor you already use.

🎤 Dictate directly into your notes
📝 Transcribe meetings, calls, and recordings
🌍 Translate text across eight languages
🔊 Listen to notes with natural voices

New in 2026.7.13: Translate notes locally

Translate selections or entire notes between English and Spanish, German, French, Portuguese, Italian, Dutch, and Japanese. Preview the result before changing your note, then continue working offline with translation running on your device.

Why Speech Kit?

🧩 One toolkit inside your notes for dictation, meeting transcription, translation, and read aloud
💻 Cross-platform on desktop with the same workflow on macOS, Windows, and Linux
🔄 Choose your models freely without being tied to one engine or API
🔒 Everything runs on your device so your work stays private and continues working offline

If you already use Local Dictation, your settings, hotkeys, and installed models carry over automatically.

⬇️ [Install Speech Kit](https://obsidian.md/plugins?id=local-dictation) • 📝 [Release notes](https://github.com/brittain9/speech-kit-obsidian-plugin/releases/latest) • 💻 [GitHub](https://github.com/brittain9/speech-kit-obsidian-plugin) • 💜 [Support the project](https://buymeacoffee.com/alexbrittaq)
