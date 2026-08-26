# Pocket TTS manual testing

Use this checklist after installing the development build into a test vault.
Run it on macOS, Windows, and Linux before release; record the platform, CPU,
selected model, voice, and any buffering.

## Model and voice management

1. Open **Settings → Speech Kit → Read aloud → Manage models**. Confirm the
   picker opens on Read-aloud models and remains separate from Dictation models.
2. Install one Pocket TTS language. Confirm the warning and required download
   size are clear before installing a high-CPU model.
3. Install an optional voice. Without restarting Obsidian, confirm the voice
   appears in both the Read aloud settings dropdown and the active-reading
   status control.
4. Select another installed language and confirm its voice selection is
   independent from the dictation model and dictation language.
5. Use the **Recommended shortcut** button. Confirm Obsidian opens Hotkeys
   filtered to **Read aloud**, then assign a test hotkey.

## Reading and playback

Test a note containing frontmatter, headings, emphasis, lists, links, embeds, a
table, inline code, a fenced code block, inline math, and display math.

1. With a selection, run **Read aloud** and confirm only the selected prose is
   spoken. With no selection, confirm reading begins at the start of the note.
   Confirm frontmatter, code, and math are skipped while readable labels and
   table cells are retained.
2. Pause for at least 30 seconds, resume, and confirm playback continues without
   a gap, duplicate sentence, or unbounded background CPU use.
3. Stop during model load, during the first sentence, and after several queued
   sentences. Confirm audio stops and does not restart later.
4. Confirm the active-only status player shows the current language/model,
   speed, and voice. Test every active speed preset: 0.75×, 1×, 1.25×, 1.5×,
   and 2×. Change model, speed, and voice during playback; the current sentence
   may restart, but pitch should remain natural and stale audio must not return.
   Record first-audio latency and any buffering at 2×. The French 24-layer model
   is certified for real-time 1× synthesis on Linux x86_64 CI, not uninterrupted
   2× playback, so distinguish its documented buffering from control or audio
   corruption bugs.
5. Start Read aloud during dictation and then start dictation during Read aloud.
   Confirm the first operation stops cleanly before the second begins and the
   final dictation transcript is retained.
6. End the sidecar process during playback. Confirm the plugin returns to idle,
   reports the failure once, and the next Read aloud command starts a fresh
   sidecar session.

The automated real-model gate covers pinned artifacts, non-silent 24 kHz PCM,
first-audio latency, duration at supported speeds, and Whisper round-trip word
error rate. This checklist covers the Obsidian, Web Audio, and hardware behavior
that CI cannot prove.
