# Spec: Release finalizing touches (2026-07-14 smoke test)

Status: approved for implementation (handoff to Codex)
Source: pre-release smoke test on main @ `885cac0`, 2026-07-14.

## Product goal

This is the last polish pass before cutting the release. The bar: the plugin
should feel Obsidian-native, solid, and consistent, and nothing in settings
should be confusing or behave in an undefined way. The smoke test surfaced one
structural problem (timestamp frequency) and several small consistency issues.
Everything else in the release looked good.

Recent context: #252 and #257 built the current timestamp settings; #263 moved
advanced transcript controls into modals; #265 grouped transform sidebar
settings by owner. This spec walks back part of #257's user-facing surface.

## P0-1 · Timestamp frequency: remove model-dependent modes

Files: `src/settings/timestamp-settings-modal.ts`,
`src/settings/timestamp-capability.ts`, `src/settings/plugin-settings.ts`,
`src/transcript/renderer.ts`, `src/dictation/dictation-session-controller.ts`.

### Problems observed

1. **"Every word · model timed" output is unusable.** It renders a landmark
   before every single word (`(0:00.1) Specifically, (0:01.0) I'm …`). No
   dictation user wants this inline; it drowns the text.
2. **"Every phrase" doesn't match its name.** It emits one landmark per VAD
   utterance, which under continuous speech is far coarser than "every
   phrase/sentence".
3. **Undefined capability state.** The `detailed` option is model-dependent.
   Select it under Whisper, switch to Moonshine, reopen the modal: the
   dropdown shows "Detailed model timing · unavailable" — disabled *but still
   selected*, timestamps still on, and what a session will actually do is not
   communicated anywhere. A settings choice must never silently depend on
   which model happens to be active.

### Direction

Make timestamp frequency model-independent. The Frequency dropdown offers
exactly:

| Option | Behavior |
| --- | --- |
| At intervals (default) | Unchanged: landmark when `sparseIntervalMs` has elapsed since the last one. |
| Every phrase | One landmark per phrase. When the active model provides engine segment timing, emit a landmark before **each engine segment** inside the utterance (reuse the existing detailed-segment span rendering in `buildTranscriptSpans`), so Whisper users get true ~sentence granularity. Otherwise one landmark per VAD utterance, as today. This is the finest frequency we support. |
| At paragraph breaks | New. Emit a landmark whenever the renderer inserts a paragraph break (smart paragraphs), plus the first landmark of the session. No hidden fallback: when transcript formatting is not Smart paragraphs, paragraph breaks never occur and the modal must say so inline (e.g. desc: "Requires Smart paragraphs formatting" shown as a warning state when formatting is anything else). |

Consequences:

- Delete `detailed` as a user-facing density. Remove the inline every-word
  rendering path (word-by-word landmarks) entirely. `timestamp-capability.ts`
  and its presentation strings go away or shrink to whatever "Every phrase"
  needs to describe segment-vs-VAD granularity; the modal copy must no longer
  change meaning based on the active model.
- **Migration:** in `normalizePluginSettings`, stored `timestampDensity:
  'detailed'` maps to `'every_utterance'`. Update `TIMESTAMP_DENSITIES` and
  add the new paragraph density (suggested value: `'paragraph'`). No dead
  settings keys left behind.
- If the sidecar session request still asks for word/segment timing, keep
  requesting segment timing only when density is `every_utterance` (it powers
  the segment-level landmarks); never request word timing.
- Word-level timing remains a sidecar capability (protocol untouched) — we are
  only removing the plugin-side rendering mode and UI. Do not touch
  `native/` in this pass.

Out of scope (explicitly rejected for now): "every N seconds snapped to the
exact model-timed word" — nice idea, not worth the complexity this release.

## P0-2 · Settings modals: auto-save instead of Save/Cancel

Files: `src/settings/timestamp-settings-modal.ts`,
`src/settings/smart-paragraph-settings-modal.ts`,
`src/settings/diarization-settings-modal.ts`,
`src/ui/llm-timing-settings-modal.ts`, `src/ui/llm-model-settings-modal.ts`,
`src/ui/llm-context-settings-modal.ts`.

Obsidian settings are auto-save everywhere; our modals bolting Save/Cancel/
Reset onto them feels foreign and adds a failure mode (close without saving).
Convert all six settings modals to:

- Persist each control on change (toggles/dropdowns immediately; numeric text
  inputs on valid change, keeping current validation — an invalid value is
  never persisted and shows the existing inline validity message; last valid
  value wins on close).
- Keep a single **Reset** button (restores that modal's fields to
  `DEFAULT_PLUGIN_SETTINGS` values and persists).
- Remove Save and Cancel. Closing the modal (X / Esc) just closes it.
- `onSave` callbacks that refresh parent UI should fire on each persist (or on
  close if per-change is too chatty for a given parent — implementer's call,
  but the parent must reflect new values by the time the modal is closed).

`preset-manager-modal.ts` is excluded: it edits a named entity draft, where
explicit save semantics are correct.

## P0-3 · Smart paragraph defaults

File: `src/settings/plugin-settings.ts`.

Both defaults are currently `DEFAULT_SMART_PARAGRAPH_PAUSE_MS = 3_000`. Equal
values make the line-break tier unreachable (renderer: `< lineBreak` → space,
`< paragraph` → newline, else paragraph), so every ≥3 s pause becomes a new
paragraph — too aggressive for dictation thinking-pauses.

Replace the single constant with two:

- `DEFAULT_SMART_PARAGRAPH_LINE_BREAK_PAUSE_MS = 4_000`
- `DEFAULT_SMART_PARAGRAPH_PARAGRAPH_PAUSE_MS = 10_000`

No migration of stored user values — this affects fresh installs and the
Reset button only. Update the modal's Reset accordingly (it already reads the
defaults).

## P1 · Capability-drop log spam

File: `src/dictation/dictation-session-controller.ts` (~line 833).

`capability gate dropped "<field>": <reason>` is logged per
`transcript_ready` event, so a Moonshine session with diarization enabled
spams it on every revision. Log each distinct `(field, reason)` **once per
session** — first occurrence keeps the current debug line (ideally phrased as
a session-level fact, e.g. that diarization is disabled for this session);
repeats are suppressed. Track per `ManagedSession` entry.

## P2 · Transform sidebar: "Show original transcript" placement

File: `src/ui/local-dictation-view.ts` (+ `llm-sidebar-presentation.ts` if
ordering lives there).

"Show original transcript" currently sits directly under the "Enabled"
toggle, where it reads as a sub-setting of enablement. It is output behavior,
like "Run transform". Move it to sit with "Run transform" in the
transform-output group (after Run transform, before routing/model controls),
consistent with #265's group-by-owner structure. Keep "Model behavior" as the
compact row linking to the model settings modal — no other sidebar changes.
This is deliberately minimal; a bigger sidebar rethink is post-release.

## Non-goals

- Phrase finalization presets: Responsive / Balanced / Patient naming stays.
- Multi-speaker diarization verification (covered by the second smoke test).
- Any `native/` sidecar changes.
- Release version bump / notes (separate step, see
  `docs/release/cutting-a-release.md`).

## Acceptance criteria

1. Frequency dropdown shows exactly: At intervals, Every phrase, At paragraph
   breaks — identical options regardless of active model; no disabled or
   "unavailable" entries.
2. With Whisper (segment timing) and Frequency = Every phrase, a long
   continuous utterance renders multiple ~sentence-level landmarks; with
   Moonshine, one landmark per VAD phrase. No word-by-word landmark output is
   reachable from any setting.
3. A settings file with `timestampDensity: "detailed"` loads as
   `every_utterance` with no console errors.
4. Frequency = At paragraph breaks + Smart paragraphs formatting: landmark at
   session start and at each paragraph break; with another formatting mode the
   modal shows the inline requirement note.
5. All six listed modals persist on change, have Reset only, and never
   persist an invalid numeric value.
6. Fresh-install defaults: line break 4 s, paragraph 10 s; Reset in the smart
   paragraph modal yields those values.
7. A Moonshine session with diarization enabled logs the capability drop once,
   not per revision.
8. "Show original transcript" renders adjacent to "Run transform" in the
   transform group.

## Verification

- `npm run check` green.
- Update/extend the high-signal tests only: renderer landmark behavior
  (segment-level every-phrase, paragraph-break density), settings
  normalization migration for `detailed`, log-once-per-session dedupe. Modal
  auto-save needs a test only if one already exists for the save path being
  replaced — no new implementation-detail modal tests.
- Manual pass: flip models Whisper ↔ Moonshine with timestamps on and confirm
  the settings modal is identical and sessions behave per the table above.
