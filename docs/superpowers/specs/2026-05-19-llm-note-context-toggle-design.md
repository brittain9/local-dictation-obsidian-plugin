# LLM Note-Context Toggle — Design

Date: 2026-05-19
Status: Approved, ready for implementation plan

## Problem

The LLM postprocess feature runs in two modes:

- **Per-utterance** — every transcribed utterance is sent to the local LLM live. Because each utterance is short and standalone, the model benefits from surrounding note text so it can keep terminology and style consistent.
- **Batch** — the entire session transcript is sent to the LLM once after the user stops dictating. The full transcript is already in the prompt, so additional note context is often redundant and can dilute the model's signal.

Today the plugin unconditionally feeds note text to both paths whenever `llmPostprocessNoteContextChars > 0` (default 3 000). There is no clear user control for "should the LLM see anything from my note?" The numeric chars setting is an indirect, buried off-switch.

This design adds an explicit, privacy-first toggle that suppresses the note-text source for the LLM in both modes.

## Goals

- One clear user-facing control for "include note context in the LLM prompt."
- Default off — opt-in to sending note text out of the editor to the LLM.
- Apply uniformly to per-utterance and batch.
- One pure decision function shared by both call sites (DRY).
- No legacy compatibility code or migration logic. Greenfield.

## Non-goals

- Per-mode defaults stored separately. One stored boolean covers both modes.
- Per-preset overrides. Presets do not declare their own context preference.
- Renaming or repurposing the existing `useNoteAsContext` setting, which gates the STT spelling glossary. That control stays as-is.
- Fixing the unrelated UI quirk where the Context section shows `llmPostprocessTotalContextCap` in batch mode (batch path does not consult it). Tracked as a follow-up.

## What "note context" means here

Three context sources can flow to either the STT engine or the LLM today:

| Source            | Built by                | Goes to       | Existing gate                                |
|-------------------|-------------------------|---------------|----------------------------------------------|
| `note_glossary`   | `readNoteGlossary()`    | STT engine    | `useNoteAsContext` (boolean, STT spelling)   |
| `note_text`       | `readNoteText()`        | LLM           | `llmPostprocessNoteContextChars > 0` (chars) |
| `prior_utterance` | `readPriorUtterances()` | LLM (per-utt) | `llmPostprocessPriorUtterancesN > 0` (count) |

**Scope of this design: `note_text` only.** The new toggle does not affect the STT glossary or prior utterances. Each context source remains independently controlled.

## Design

### 1. New setting

Add one boolean field to `PluginSettings` in `src/settings/plugin-settings.ts`:

```ts
useLlmNoteContext: boolean;
```

- Default: `false`.
- Read in `resolvePluginSettings()` via the existing `readBoolean()` helper, fallback to default.
- Added to `resetLlmPostprocessDefaults()` so the "Reset LLM defaults" action restores it to `false`.
- No protocol field, no preset field, no per-mode duplicate.

### 2. New helper module

Create `src/llm/note-context.ts` with a single pure function:

```ts
import type { PluginSettings } from '../settings/plugin-settings';

export function resolveLlmNoteContextBudget(settings: PluginSettings): number {
  return settings.useLlmNoteContext ? settings.llmPostprocessNoteContextChars : 0;
}
```

This is the single source of truth for the gating decision. Returning a numeric budget (rather than a boolean) lets both call sites keep their existing `> 0` checks unchanged — the helper folds toggle and chars into one effective value.

### 3. Call-site updates (`src/dictation/dictation-session-controller.ts`)

Two places construct the effective budget today; both move to the helper.

**Per-utterance** — `resolveLlmPostprocessSnapshot()`:

```diff
- noteContextChars: settings.llmPostprocessNoteContextChars,
+ noteContextChars: resolveLlmNoteContextBudget(settings),
```

**Snapshot construction** for batch — the `ActiveSessionSnapshot` literal built inside `DictationSessionController.startSession()` (today around `dictation-session-controller.ts:230`):

```diff
- llmPostprocessNoteContextChars: settings.llmPostprocessNoteContextChars,
+ llmPostprocessNoteContextChars: resolveLlmNoteContextBudget(settings),
```

The snapshot field name stays the same; its semantics shift from "raw setting" to "effective budget after toggle." That is consistent with how the snapshot already captures effective values for other settings (e.g. `llmPostprocessTemperature` resolves through `resolveActiveGenerationDefaults`).

The two consumer call sites need no change:

- `runBatchCleanup` (line 484) keeps its `snapshot.llmPostprocessNoteContextChars > 0` gate.
- `buildLlmContextSources` (line 685) keeps its `config.noteContextChars > 0` gate.

### 4. UI (`src/ui/local-dictation-view.ts`, `renderContextSection`)

Insert a new toggle row at the **top** of the Context group, before "Note context chars."

- Label: **Use note as LLM context**
- Description: **Include text from the open note above the cursor in the LLM prompt. Off keeps dictation context-isolated.**
- Wires to `useLlmNoteContext` via `this.saveField('useLlmNoteContext', value, { rerender: true })` so the section re-renders on change.

When `useLlmNoteContext` is **false**, hide the "Note context chars" number input. "Prior utterances" and "Total context cap" rows are unaffected.

Update the Context group subtitle so it remains accurate when note text is suppressed. Suggested copy: **"Bounded slice of the open note and recent utterances fed to the model to keep style and terminology consistent."** — works regardless of toggle state.

### 5. Tests

- **New file** `test/note-context.test.ts` — unit tests for `resolveLlmNoteContextBudget`:
  - Returns `0` when `useLlmNoteContext === false`, even with chars > 0.
  - Returns `llmPostprocessNoteContextChars` when toggle is on.
  - Returns `0` when toggle on but chars is 0 (degenerate but legal).
- **`test/plugin-settings.test.ts`** — extend existing settings round-trip cases to cover `useLlmNoteContext`:
  - Default value is `false`.
  - Accepted as a literal boolean.
  - Non-boolean values fall back to default.
- **`test/dictation-session-controller.test.ts`** — two new integration cases:
  - With `useLlmNoteContext = false`, `runBatchCleanup` does not call `session.readNoteText`, and the user message sent to `OllamaClient.cleanup` has an empty `<note_context>` block.
  - With `useLlmNoteContext = false`, `buildLlmContextSources` returns sources containing no `note_text` entry, and only emits `prior_utterance` sources (if any).

## Edge cases

- **Toggle on, chars = 0.** Budget is 0; no note text is read. Equivalent to off. Acceptable degenerate state — the chars input enforces a sensible minimum via existing clamping.
- **Toggle off, chars > 0.** Budget is 0; no note text is read. The stored chars value is preserved so flipping the toggle back on restores the user's previous budget.
- **Mode switch while toggle is off.** Both per-utterance and batch see budget 0. No mode-specific surprise.
- **Empty note.** Already handled — `readNoteText` returns `null` when the slice is empty.

## Behavioral summary

| Toggle | Mode           | `note_text` source | `prior_utterance` source | STT glossary           |
|--------|----------------|--------------------|--------------------------|------------------------|
| off    | per-utterance  | none               | controlled by `priorUtterancesN` | controlled by `useNoteAsContext` |
| off    | batch          | empty in prompt    | n/a                      | controlled by `useNoteAsContext` |
| on     | per-utterance  | up to `noteContextChars` (clamped by `totalContextCap`) | controlled by `priorUtterancesN` | controlled by `useNoteAsContext` |
| on     | batch          | up to `noteContextChars` | n/a                      | controlled by `useNoteAsContext` |

## File-touch list

- `src/settings/plugin-settings.ts` — new field, default, reader, reset entry.
- `src/llm/note-context.ts` — new module, one function.
- `src/dictation/dictation-session-controller.ts` — two assignments swap to helper.
- `src/ui/local-dictation-view.ts` — new toggle row, conditional rendering of chars row, subtitle copy.
- `test/note-context.test.ts` — new file.
- `test/plugin-settings.test.ts` — extend.
- `test/dictation-session-controller.test.ts` — two new cases.
