# Read-aloud command UX research

Primary-source review completed 2026-08-15. This note evaluates command scope,
not synthesis quality or playback controls.

## Existing product behavior

[`Read aloud`](../../src/commands/register-commands.ts) already has a useful
primary-command contract: read the active selection when one exists; otherwise
read the whole note.

## Relevant conventions

| Product | Scope model | Implication |
| --- | --- | --- |
| [NVDA](https://download.nvaccess.org/releases/stable/documentation/keyCommands.html) | `Say all` starts at the current system-caret position and advances it. `Read current text selection` is a separate command. | A cursor-to-end action is an established first-class reading scope, particularly for keyboard-oriented reading. |
| [Windows Narrator](https://support.microsoft.com/en-US/accessibility/windows/narrator/chapter-4-reading-text) | It separately offers reading from focus/cursor, from the beginning, and from the beginning to the cursor. | “From cursor” is precise, conventional terminology; it should not silently mean “whole document.” |
| [Apple Spoken Content on iPhone](https://support.apple.com/en-sa/guide/iphone/iph96b214f0/ios) | `Speak Selection` reads selected text; `Speak Screen` reads all screen text. | Selection and broad-context reading are both discoverable scopes. |
| [Apple Speak Selection on macOS](https://support.apple.com/en-au/guide/mac-help/mh27448/mac) | A bindable command speaks the selection, or available text in the current window when no selection exists. | A selection-first smart primary command is familiar and efficient. |
| [Microsoft Edge Reading mode](https://support.microsoft.com/en-us/edge/use-immersive-reader-in-microsoft-edge) | Read Aloud reads the reading surface; selection can instead be opened as a partial reading surface. Playback adds previous/next paragraph controls. | Mainstream reader UX defaults to the readable document, with an explicit route for partial content. |

## Recommendation

Keep two commands and do **not** add a mode/setting:

1. **Read aloud** — selection when present; otherwise the whole note. This is
   the simple, discoverable default and preserves the current documented
   contract.
2. **Read aloud from cursor** — selection when present; otherwise cursor to the
   end of the note. Make it independently hotkey-bindable.

The selection override is a deliberate product choice, not the only industry
precedent: NVDA instead makes the caret authoritative and exposes selection as
a distinct command. In an editor plugin, however, a live selection is a strong
and visible expression of scope. Keeping that rule identical across both
commands makes behavior easy to predict, avoids accidentally reading extra
content, and exactly covers the issue's no-selection use case.

If the product later adds a third command, make it explicitly scope-specific
(`Read selection`) rather than changing either command's established behavior.
That would be useful only if selection-only hotkeys or a focused context-menu
action becomes a demonstrated need.

## Naming and discoverability

- Use **Read aloud from cursor**, not “continue reading.” It describes the
  input state and works for a first invocation, not just a paused session.
- Keep both commands adjacent under the same command prefix in Obsidian's
  command palette and Hotkeys settings.
- Do not assign a default hotkey. The two commands intentionally differ by
  scope, so a user should choose their own shortcut rather than inherit a
  potentially surprising one.
- Existing playback controls should remain the place for fine-grained
  next/previous navigation; the commands choose the initial scope.

## Decision boundary

This is a UX recommendation, not an accessibility-equivalence claim. Full
screen readers use a system caret and richer navigation model; Speech Kit's
commands should remain compatible with Obsidian's editor and follow the
plugin's existing selection-first contract.
