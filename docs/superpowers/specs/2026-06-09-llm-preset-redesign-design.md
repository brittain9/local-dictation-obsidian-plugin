# LLM Preset Redesign — Design

Date: 2026-06-09
Branch: `feat/llm-preset-manager`

## Problem

The LLM transformation panel's preset UX is confusing:

- Editing the inline prompt textarea flips the Preset dropdown into an ephemeral
  "Custom" state, with save/delete affordances that appear and disappear.
- The Preset row's description reads out long prompt-like text.
- Mode taxonomy is muddled: "Any mode", per-preset mode pinning that hides the
  Mode dropdown, and a planned "additive" behavior that doesn't fit the
  per-utterance/batch axis.
- Settings store both the live prompt (`llmPostprocessPrompt`) and the active
  preset ref, kept in sync by string-matching prompts (`findMatchingStyleRef`).
- Preset overrides (min words, temperature) are all-or-nothing and can only be
  changed by deleting and re-saving the preset.

## Decisions (made with the user)

1. **Additive is not a mode.** Mode answers *when* (per phrase / on stop);
   each preset additionally declares *what the output does*: `replace`,
   `add_above`, or `add_below`. Additive output is batch-only in v1 and leaves
   the transcript completely untouched.
2. **The inline prompt textarea and the "Custom" state are removed.** The
   prompt is viewed/edited only inside the preset manager. You are always on a
   named preset. Built-ins are read-only; duplicate one to customize.
3. **Mode control is always visible** in the panel; when the active preset pins
   timing, the dropdown shows the pinned value disabled with a note
   ("Set by TLDR — runs once on stop").
4. **Per-preset overrides:** min words, temperature, and note-as-context — each
   independently optional; blank means inherit the global value. No
   model/routing pinning.
5. **Manager modal uses the drill-in layout** (list view ⇄ editor view inside
   one modal), matching the Manage models → details pattern.
6. **Panel shows the preset's description** under the dropdown (never the
   prompt), falling back to an auto-generated behavior line when empty.
7. **Settings store the ref only.** `llmPostprocessPrompt` is removed;
   `llmPostprocessActivePresetRef` is the single source of truth.
8. **Shipped lineup:** Clean up, Professional writing, TLDR (→ add above),
   Markdown formatting, Brain dump organizer, **Action items** (new, add
   below). Voice commands is dropped.

## Data model

```ts
interface LlmPreset {
  id: string;
  label: string;
  description?: string;                 // optional, shown in panel + manager
  prompt: string;
  timing?: 'per_utterance' | 'batch';   // undefined = either (user picks via Mode)
  output: 'replace' | 'add_above' | 'add_below'; // add_* requires timing 'batch'
  overrides?: {
    minWords?: number;        // 0–50 integer
    temperature?: number;     // 0–2
    useNoteContext?: boolean; // tri-state in UI: inherit / on / off
  };
}
```

- A preset has exactly one output behavior; output never varies by timing.
  "Either" timing exists only for `replace` presets. `add_*` presets are
  always batch — there is no per-utterance additive, and a single preset
  cannot replace per-utterance while adding on stop (that would be chained
  transforms, out of scope).
- `overrides` is the extension point for future per-transform settings: each
  new setting is one optional field (missing = inherit global), one editor
  row, and is resolved through the same shared per-field resolution helper.
  Absent fields inherit, so adding fields never needs migration.
- One shape for built-in and user presets. Built-ins live in a readonly
  constant in `src/llm/presets.ts`; user presets in settings.
- Ref format unchanged: `builtin:<id>` / `user:<id>`.
- Limits unchanged: max 25 user presets, label ≤ 60 chars, description ≤ 240.
- `llmPostprocessMode` unchanged (`off` / `per_utterance` / `batch`). A preset
  with pinned timing (or `add_*` output) forces the *effective* mode while
  active without overwriting the stored value, so switching back to a flexible
  preset restores the user's last choice.

### Migration (in `readSettings`)

- If a legacy `llmPostprocessPrompt` exists and differs from the active ref's
  prompt: create a user preset labeled "My preset" (prompt only, no timing or
  overrides, `output: 'replace'`) and point the active ref at it. If it
  matches, drop the field.
- Existing user presets: `mode` field maps to `timing`; missing `output`
  defaults to `'replace'`; legacy paired `minWords`/`temperature` map into
  `overrides`.
- Unknown/deleted active ref falls back to `builtin:clean-up`.
- If "My preset" collides with an existing label, suffix with a number
  ("My preset 2").

### Removed

`llmPostprocessPrompt` setting, `findMatchingStyleRef`, the Custom-state sync,
the prompt blur/re-render machinery in `local-dictation-view.ts`, and
`SaveStyleModal` (`src/ui/save-style-modal.ts`).

## UX

### Settings panel (LLM transformation section)

- **Preset** row: dropdown listing built-ins then user presets; labels carry a
  suffix only when pinned ("(after each phrase)" / "(on stop)"). Row
  description = preset description, else auto-generated behavior line, e.g.
  "Runs once on stop · adds a summary above the transcript · overrides
  temperature". A "Manage presets" extra button opens the manager modal.
- **Mode** row: always rendered. Free dropdown for either-presets; disabled
  showing the pinned value with "Set by <preset> — …" when pinned.
- **Min words / Temperature / note-context** rows: when overridden by the
  active preset, disabled with "Set by preset '<label>'. Edit the preset to
  change."
- No prompt textarea, no save icon, no trash icon in the panel.

### Preset manager modal (drill-in)

**List view**

- "+ New preset" button (disabled at 25 with explanatory tooltip).
- Sections: "Built-in" and "Your presets". Each row: name, badge line
  (timing · output · overrides dot), checkmark on the active preset.
- Built-in row actions: view, duplicate. User row actions: edit, duplicate,
  delete (ConfirmModal). Clicking the row opens it.
- Duplicate opens the editor prefilled with the source preset's fields and the
  name "<label> (copy)"; nothing is saved until the user hits Save, where
  normal uniqueness validation applies.

**Editor view** (back arrow returns to list)

- Name — required, unique case-insensitive across built-ins + user presets.
- Description — optional.
- Prompt — large textarea, required.
- Timing — Either / After each phrase / Once on stop.
- Output — Replace text / Add above / Add below. Choosing an Add option sets
  Timing to "Once on stop" and locks it.
- Overrides — three independent optional fields; blank = inherit. Min words
  (0–50), Temperature (0–2), Note context (Inherit / On / Off).
- Save / Cancel. Validation errors shown inline (role=alert), as in the old
  save modal.
- Built-ins render in this view read-only with a Duplicate button instead of
  Save.

## Runtime

- **Snapshot resolution:** at session start, resolve the active preset into the
  session snapshot: prompt, effective temperature / min words / note-context
  (global unless overridden), forced effective mode, output behavior.
  Mid-session preset edits do not affect a running session.
- **Additive (batch only):** on success, instead of
  `replaceSessionRangeWithCleaned`, a sibling session method inserts the
  generated block above or below the tracked session range, separated by a
  blank line; the transcript is untouched. The processing flash still marks the
  range. "Show raw beneath LLM output" is ignored for additive presets.
- **Per-utterance:** unchanged except effective values come from the snapshot's
  resolved overrides.
- **Reset LLM defaults:** active preset → Clean up, mode → after each phrase,
  context/skip/generation globals → defaults. User presets and provider/model
  kept. Confirm copy states "Your saved presets are kept."
- **Delete active preset:** fall back to Clean up with a Notice.

## Shipped built-in presets

| Preset | Timing | Output | Notes |
| --- | --- | --- | --- |
| Clean up | either | replace | default |
| Professional writing | either | replace | |
| TLDR | batch | add above | prompt rewritten to emit only the "TLDR" heading + 1–3 bullets |
| Markdown formatting | batch | replace | |
| Brain dump organizer | batch | replace | |
| Action items | batch | add below | new; emits an "Action items" section from the transcript |

Voice commands is removed; vaults referencing `builtin:voice-commands` fall
back to Clean up via the unknown-ref rule.

## Testing (high-ROI behavior only)

- Settings migration: legacy prompt → "My preset"; `mode` → `timing`; `output`
  defaulting; legacy override pair → `overrides`; unknown ref fallback.
- Effective-settings resolution: per-field override inheritance; mode forcing.
- Behavior-line formatter.
- Preset editor validation: required/unique name, required prompt, add_* locks
  timing to batch.
- Session insertion: add-above and add-below placement relative to the session
  range.
- Shared fixtures in `test/fixtures/`.

## Out of scope

- Per-utterance additive output (inline annotations).
- Model/provider pinning per preset.
- Import/export of presets.
