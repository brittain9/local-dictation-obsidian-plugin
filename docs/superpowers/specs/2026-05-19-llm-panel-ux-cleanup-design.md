# LLM Sidebar Panel UX Cleanup

Date: 2026-05-19
Status: approved

## Problem

The Local Dictation sidebar's "LLM transformation" section silently no-ops when Ollama isn't running. The only signal is buried in `Advanced > Diagnostics > Ollama status`. Three smaller frictions compound: the "Use note as LLM context" setting hides in Advanced despite being a common knob; its description carries a redundant second sentence; the Advanced `<summary>` element renders with the disclosure arrow at content offset 0, visually misaligned with the setting rows above and below it.

## Goal

One pass over `src/ui/local-dictation-view.ts` (and a small CSS tweak) to:

1. Surface Ollama health inline when Transform is on.
2. Reorder the main section around the user's mental flow (model → preset → mode → context).
3. Move "Use note as LLM context" out of Advanced with a slimmer description.
4. Realign the Advanced disclosure header.

Non-goals: redesigning the Advanced section itself, adding a manual Ollama "Retry" button (the existing focus-based re-probe already covers it), changing settings persistence or the underlying Ollama probe code.

## New layout

Order inside the `LLM transformation` setting-group when Transform is **on**:

```
Transform                          [ON]
⚠ <inline status row — only when problematic>

Ollama model    [— select a model  ▼] ↻
Preset          [Clean transcription ▼]
Mode            [After each phrase  ▼]   (only when preset doesn't fix the mode)
Use note as LLM context            [ON]
Include the open note above the cursor.

▾ Advanced
```

When Transform is **off**, only the Transform row renders (current behavior preserved).

### Inline status row

Sits directly under the Transform toggle, only when Transform is on. Single line; CSS class `local-dictation-status-warning` for the warning variant, `local-dictation-status-info` for the info variant. Replaces the existing "Pick an Ollama model above to enable the transform." muted text under the model picker.

| State | Text | Variant |
|---|---|---|
| Ollama unreachable | `⚠ Ollama is not running.` | warning |
| Ollama running, no chat models installed | `⚠ No chat models installed in Ollama.` | warning |
| Selected model not in current model list | `⚠ Selected model is unavailable.` | warning |
| Models available, none selected | `Select an Ollama model below.` | info |
| Healthy + model selected | — (row not rendered) | — |

State derivation uses existing fields: `ollamaStatus` ("Not running." / "Running, but no chat models installed." / "Ready (...)."), `this.models`, and `settings.llmPostprocessModel`. No new probe.

### "Use note as LLM context" relocation

Move `renderContextSection` out of `Advanced` and into the main `cleanupGroup`, rendered after `renderCleanupMode`. Description shortens from:

> Include text from the open note above the cursor in the LLM prompt. Off keeps dictation context-isolated.

to:

> Include the open note above the cursor in the LLM prompt.

### Advanced disclosure alignment

The native `<summary>` marker sits at content offset 0; the setting rows above it have Obsidian's intrinsic `.setting-item` padding. Fix in `styles.css`:

- Add `padding-inline: var(--size-4-3) 0` (or matching Obsidian's setting-item left padding) to `.local-dictation-advanced > summary`.
- Verify the disclosure triangle and "Advanced" word visually align with the names of setting rows immediately above.

If the simple padding fix doesn't read cleanly, fall back to `list-style: none` on the summary + a custom chevron (using `setIcon('chevron-right')` rotated 90° when `[open]`).

## Implementation outline

All changes in `src/ui/local-dictation-view.ts` plus `styles.css`. No settings schema change, no new dependencies.

1. **Reorder rendering** in `render()` (around line 137-161):
   - `renderCleanupToggle` (unchanged)
   - new `renderInlineStatus` (after toggle, before mode block)
   - `renderModelPicker` (moved up — was after `renderStylePicker`)
   - `renderStylePicker` (unchanged)
   - `renderCleanupMode` (unchanged; runs after preset)
   - `renderContextSection` (moved out of Advanced, slimmer description)
   - Advanced disclosure (no longer holds context section)

2. **Add `renderInlineStatus(parent, settings)`** that:
   - Returns early if Transform is off.
   - Derives state from `this.ollamaStatus`, `this.models`, `settings.llmPostprocessModel`.
   - Renders nothing in the healthy state.
   - Renders a single `<div>` with text + variant class otherwise.

3. **Remove `renderModelPicker`'s muted "Pick an Ollama model above…" element** (line 338-343). The inline status row handles this case now.

4. **Tighten `renderContextSection` description.**

5. **CSS fix** in `styles.css`:
   - Pad `.local-dictation-advanced > summary` so its content aligns with adjacent setting names.
   - Add `.local-dictation-status-warning` and `.local-dictation-status-info` rules (warning color + small margin so it reads as a row, not floating text).

## Error handling

State derivation reads in-memory fields only — no new failure modes. Ollama probe failures continue to surface via the existing `refreshModels` path; this design just changes where the resulting status text appears.

## Tests

`local-dictation-view` isn't unit-tested today (no existing test file for it). For a UX cleanup of this size, manual verification in the dev vault is the bar:

- Transform off → only Transform row visible.
- Transform on + Ollama not running → warning row appears under Transform.
- Start Ollama + window focus → re-probe fires, warning disappears.
- Pick a model that gets removed externally → warning flips to "Selected model is unavailable."
- "Use note as LLM context" appears below Mode (or below Preset when Mode is hidden by preset), not inside Advanced.
- Advanced disclosure header aligns with the row immediately above when closed.

If state derivation feels load-bearing enough to warrant a test, extract a pure `deriveInlineStatus({ ollamaStatus, models, selectedModel }): { kind, text } | null` helper and unit-test that — keeps the view untestable but the logic verified.

## Open questions

None — design is approved as-is.
