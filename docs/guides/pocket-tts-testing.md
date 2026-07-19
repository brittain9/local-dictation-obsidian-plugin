# Pocket TTS manual acceptance

Use a desktop Obsidian build on macOS, Windows, or Linux. Pocket TTS is local
and CPU-backed; the first English install downloads about 126 MiB. Keep the
developer console open during failure-path checks and confirm no model file,
note text, or synthesized audio is sent to a remote service.

## Install and configure

1. Build and install the feature branch's plugin and sidecar.
2. Open **Settings → Local Dictation → Read aloud → Manage models**.
3. Under **Read-aloud models**, install **Pocket TTS English**. Confirm the
   initial install includes Alba and does not disturb the selected dictation
   model.
4. Select Pocket TTS English, choose Alba, then install one optional voice.
   Confirm the optional download does not re-download the runtime and the new
   voice appears in the settings picker.

## Text and playback

Create a note containing frontmatter, headings, emphasis, links, an embed, a
list, a table, inline code and math, fenced code, a display-math block, and
several ordinary paragraphs.

1. Select part of a paragraph and run **Read aloud**. Only the selection should
   be spoken.
2. Clear the selection, put the cursor in the middle of a paragraph, and run
   **Read aloud**. Reading should start at that Markdown block and continue to
   the end.
3. Run **Read entire note**. Frontmatter, code, math, formatting marks, and
   table separators must be silent; headings, link labels, list text, table
   cells, and normal prose must be spoken in source order.
4. Pause for at least 45 seconds. Audio and synthesis must remain paused, then
   resume without a pitch or ordering jump.
5. Stop while audio is queued. Playback must stop immediately and no later
   audio may leak into a new reading.
6. Change reading speed at 0.75×, 1×, 1.5×, and 2×. Pitch should remain stable.
   Changing speed during playback may restart at the current sentence.
7. Confirm the status-bar controls and command-palette pause/resume and stop
   commands remain synchronized.

## Interlock and recovery

1. Start dictation, then start Read aloud. Dictation must stop gracefully and
   drain accepted speech before synthesis begins.
2. While reading, start dictation from the command palette and from the ribbon.
   Read aloud must stop before microphone capture begins.
3. Kill the sidecar process during synthesis. The plugin must report the
   failure, stop queued playback, and recover on the next read after restart.
4. Switch notes or close the source note during playback. Playback may continue
   because Stage A does not highlight source text, but Obsidian must remain
   responsive and Stop must still work.

Record the OS, architecture, first-audio latency, model and voice used, and any
failed step in the PR's manual-test result.
