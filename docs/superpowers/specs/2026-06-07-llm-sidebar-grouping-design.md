# LLM transformation sidebar — grouping cleanup

- **Date:** 2026-06-07
- **Status:** Approved (design decisions confirmed via brainstorming; micro-decisions noted below)
- **Scope:** Light UI regrouping of the Local Dictation sidebar's "LLM transformation" panel. No behavior, settings schema, or provider-logic changes.
- **Primary file:** `src/ui/local-dictation-view.ts` (plus one label removal in `src/ui/llm-routing-controls.ts`).

## Problem

The whole feature renders into one flat "LLM transformation" `setting-group` card that mixes four
unrelated concerns with no internal landmarks (`local-dictation-view.ts:160-186`):

1. The on/off switch (Transform).
2. Where it runs — segmented Local/Remote/Auto + provider config.
3. What it does — Preset, Mode... but the **Prompt is exiled to Advanced**, despite being the core knob.
4. What it sees — "Use note as LLM context" is orphaned at the bottom, while its dependent setting
   ("Note context chars") is buried in Advanced → Context limits. Split brain.

Secondary issues:

- **Off-state collapse.** When Transform is off, `refresh()` returns right after the toggle
  (`local-dictation-view.ts:164`), leaving a single toggle row in an otherwise-empty card. Reads as broken.
- **Advanced is five sub-cards** (Context limits / Prompt / Skip gates / Generation / Diagnostics),
  several holding a single field. Over-fragmented and arbitrarily ordered.

## Goals

- Give the panel clear, labeled groups so concerns are visually separated.
- Make the off-state intentional instead of empty.
- Slim Advanced.
- Keep it **light**: pure regrouping — reassign which group each existing setting renders into. No new
  settings, no behavior changes, no provider-logic changes.

## Non-goals

- No preset save/load modal rework (explicitly deferred by the user).
- No changes to routing, provider, threshold, or transform execution logic.
- No settings-schema or migration changes.

## Approved decisions (from brainstorming)

1. **Off-state:** explainer line, not an empty card.
2. **Body grouping:** three labeled groups — Where it runs / Style / Context.
3. **Advanced:** promote the Prompt editor up into the body; slim Advanced from 5 cards to 3.

### Micro-decisions (principal-eng call; open to veto on this spec)

- **Middle group named "Style"** (not "Transform") to avoid colliding with the "Transform" toggle.
  Matches existing vocabulary: `renderStylePicker`, `resolveStyleOption`, `SaveStyleModal`, the style picker.
- **Routing's internal "Where transforms run" label is removed**; the "Where it runs" group heading
  replaces it so the label is not doubled.

## Target structure

### When ON

```
[card] LLM transformation            (i)
   Transform                       [toggle]   ← master switch
[card] Where it runs
   [ Local | Remote | Auto ]
   threshold (auto) + provider config
[card] Style                         (i)
   Preset            [ ... ]  save/delete
   Mode              [ ... ]   (conditional, unchanged)
   Prompt            [ textarea ]              ← promoted from Advanced
[card] Context
   Use note as LLM context        [toggle]
   Note context chars [ ... ]   (only when toggle on)  ← promoted from Advanced
[details] Advanced
   [card] Limits        Total context cap · Prior utterances (when !batch) · Min words
   [card] Generation    Temperature
   [card] Diagnostics   Show raw beneath · Reset LLM defaults
```

### When OFF

```
[card] LLM transformation            (i)
   Transform                       [toggle]
   Raw Whisper text is inserted as-is. Turn on to clean,
   rewrite, or summarize the transcript with an LLM.   (muted paragraph)
```

No groups, no Advanced when off.

## Mapping — what moves where

Every item below already exists; only its parent group changes.

| Setting | Today | Target |
|---|---|---|
| Transform toggle | LLM transformation card | unchanged (master switch) |
| Segmented routing + provider config | LLM transformation card | **Where it runs** card |
| Preset (+ save/delete) | LLM transformation card | **Style** card |
| Mode (conditional) | LLM transformation card | **Style** card |
| Prompt textarea | Advanced → "Prompt" card | **Style** card |
| Use note as LLM context | LLM transformation card | **Context** card |
| Note context chars (conditional) | Advanced → "Context limits" | **Context** card |
| Total context cap (+ warning) | Advanced → "Context limits" | Advanced → **Limits** |
| Prior utterances (conditional) | Advanced → "Context limits" | Advanced → **Limits** |
| Min words | Advanced → "Skip gates" | Advanced → **Limits** |
| Temperature | Advanced → "Generation" | Advanced → **Generation** (unchanged) |
| Show raw / Reset defaults | Advanced → "Diagnostics" | Advanced → **Diagnostics** (unchanged) |
| Runtime failure banner | LLM transformation card | top of body (after Transform card) — unchanged behavior |

Eliminated cards: "Context limits", "Skip gates", "Prompt" (its content moves into Style and Limits).

## Conditionals preserved (no logic change)

- **Mode** row shows only when the active preset declares no fixed mode (`renderCleanupMode`).
- **Note context chars** shows only when `useLlmNoteContext` is true.
- **Prior utterances** shows only when `llmPostprocessMode !== 'batch'`.
- **Total context cap** warning shows when `ceil(cap / 4) >= 4000`.
- **Min words / Temperature** preset-override disabling is preserved.

Each group always has at least one always-present row, so no group renders empty.

## Implementation notes

- The mechanism is the existing `createSettingGroup(parent, heading, tooltip?)` helper
  (`setting-helpers.ts:157`), already used for Advanced's sub-cards. The three body groups are created
  the same way, as siblings under `contentEl`.
- `refresh()` (`local-dictation-view.ts:143`) is rewritten to:
  1. Build the "LLM transformation" card with the Transform toggle.
  2. If off: render the muted explainer paragraph (`local-dictation-muted`) and return.
  3. If on: render the three group cards, then the Advanced details with its three sub-cards.
- `renderContextLimitsSection` is split: note-context-chars moves to the new Context group; the rest
  becomes the "Limits" card, which also absorbs Min words. `renderSkipSection` and
  `renderCustomizeStyleSection` are removed as standalone sections (their fields relocate).
- `renderSegmentedControl` (`llm-routing-controls.ts:178`) drops its internal
  `local-dictation-route-field__label` ("Where transforms run") since the group heading now carries it.
  The segmented control, hint, threshold, and provider rows are unchanged.
- The "Where it runs" group wraps `routingControls.render(...)`. `LlmRoutingControls` keeps owning its
  own rendering; the view just gives it a titled parent.
- Tooltips: the existing `STYLE_PICKER_TOOLTIP` stays on the Preset row (its current home via
  `appendInfoTooltip`). The Style group heading gets no info button. The "LLM transformation" card keeps
  `HEADING_TOOLTIP`. No new tooltip copy is introduced.

## Testing / verification

- No existing tests assert on this view's DOM or section strings (verified: `rg` over `test/` for
  "Context limits", "Skip gates", "Where transforms run", "Use note as LLM context" returns nothing).
  This is presentation-only, so unit tests are low ROI; do not add structure-snapshot tests.
- Verify by build + manual load in Obsidian:
  - `npm run build` / typecheck passes.
  - Toggle Transform off → explainer paragraph shows; no empty card; no Advanced.
  - Toggle on → four cards (LLM transformation / Where it runs / Style / Context) + Advanced (Limits /
    Generation / Diagnostics).
  - Prompt edits still debounce-save and flip Preset to "Custom" on blur.
  - Note context chars appears/disappears with the Use-note toggle; Prior utterances hidden in batch mode.
  - Provider config still works under "Where it runs" with no duplicated label.

## Risks / rollback

- **Low risk:** confined to two UI files, no state or logic. The change is reversible by reverting the
  commit. Main hazard is accidentally dropping a conditional during the move — covered by the manual
  checklist above.
