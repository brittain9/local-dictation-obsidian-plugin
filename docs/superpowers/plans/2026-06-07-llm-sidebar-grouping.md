# LLM Transformation Sidebar Grouping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup the Local Dictation sidebar's "LLM transformation" panel into clear labeled groups (Where it runs / Style / Context), promote the Prompt editor out of Advanced, slim Advanced to three cards, and give the Transform-off state an explainer instead of an empty card.

**Architecture:** Pure presentation change. Reassign which `createSettingGroup` card each already-existing setting renders into, by rewriting `LocalDictationView.refresh()` and reshaping its private section-render helpers. One duplicated label and its dead CSS rule are removed from the routing control. No settings schema, no behavior, no provider logic changes.

**Tech Stack:** TypeScript, Obsidian plugin API (`Setting`, `ItemView`), esbuild, Biome, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-llm-sidebar-grouping-design.md`

---

## Why no new automated tests

This change is presentation-only and no existing test asserts on this view's DOM or section
strings (verified: `rg "Context limits|Skip gates|Where transforms run|Use note as LLM context"
test/` returns nothing). A DOM-structure snapshot here would be an implementation-detail test that
passes with a constant and breaks on any future tweak — it violates the project's test standards
(high-ROI only; no implementation-detail tests). Verification is the existing typecheck/lint/build
gate plus a manual checklist in Obsidian. All conditionals are preserved exactly, so there is no new
logic to cover.

## File structure

- **Modify** `src/ui/local-dictation-view.ts` — rewrite `refresh()`; replace three section helpers
  (`renderContextLimitsSection`, `renderSkipSection`, `renderCustomizeStyleSection`) with three new
  ones (`renderLimitsSection`, `renderNoteContextChars`, `renderPromptEditor`); drop the off-state
  description on the Transform toggle. `renderGenerationSection` and `renderDiagnosticsSection` are
  unchanged.
- **Modify** `src/ui/llm-routing-controls.ts` — remove the internal "Where transforms run" label
  (now carried by the "Where it runs" group heading).
- **Modify** `styles.css` — remove the now-unused `.local-dictation-route-field__label` rule.

---

### Task 1: Restructure the sidebar view into header + three groups + slim Advanced

All edits in this task are in `src/ui/local-dictation-view.ts`. They are interdependent (the new
`refresh()` calls the new helpers and no longer calls the removed ones), so they land as one
compile-clean commit.

**Files:**
- Modify: `src/ui/local-dictation-view.ts`

- [ ] **Step 1: Drop the off-state description on the Transform toggle**

The off-state explanation now lives in a dedicated paragraph (added in `refresh()` below), so the
toggle itself carries no description in either state. In `renderCleanupToggle`, change the `setDesc`
line:

```ts
// before
      .setDesc(enabled ? '' : 'Raw Whisper text is inserted directly.')
// after
      .setDesc('')
```

Leave the rest of `renderCleanupToggle` (the `enabled` calc, toggle wiring, `refreshActiveProviders`)
exactly as-is.

- [ ] **Step 2: Rewrite `refresh()` to build the header card, off-state explainer, three groups, and slim Advanced**

Replace the entire body of `refresh()` (currently `local-dictation-view.ts:143-186`) with:

```ts
  refresh(): void {
    const { contentEl } = this;
    const settings = this.dependencies.getSettings();

    this.focusedInput = null;
    this.promptBlurRenderPending = false;
    contentEl.empty();
    contentEl.addClass('local-dictation-sidebar');

    if (!settings.llmFeaturesEnabled) {
      return;
    }

    if (settings.llmPostprocessMode !== 'off') {
      this.lastEnabledMode = settings.llmPostprocessMode;
    }

    const headerGroup = createSettingGroup(contentEl, 'LLM transformation', HEADING_TOOLTIP);
    this.renderCleanupToggle(headerGroup, settings);

    if (settings.llmPostprocessMode === 'off') {
      headerGroup.createEl('p', {
        cls: 'local-dictation-muted',
        text: 'Raw Whisper text is inserted as-is. Turn on to clean, rewrite, or summarize the transcript with an LLM.',
      });
      return;
    }

    this.renderRuntimeFailureBanner(headerGroup);

    const whereGroup = createSettingGroup(contentEl, 'Where it runs');
    this.routingControls.render(whereGroup, settings);

    const styleGroup = createSettingGroup(contentEl, 'Style');
    this.renderStylePicker(styleGroup, settings);
    this.renderCleanupMode(styleGroup, settings);
    this.renderPromptEditor(styleGroup, settings);

    const contextGroup = createSettingGroup(contentEl, 'Context');
    this.renderUseNoteContextToggle(contextGroup, settings);
    this.renderNoteContextChars(contextGroup, settings);

    const advanced = contentEl.createEl('details', { cls: 'local-dictation-advanced' });
    advanced.createEl('summary', { text: 'Advanced' });
    advanced.open = this.advancedOpen;
    advanced.addEventListener('toggle', () => {
      this.advancedOpen = advanced.open;
    });

    this.renderLimitsSection(advanced, settings);
    this.renderGenerationSection(advanced, settings);
    this.renderDiagnosticsSection(advanced, settings);
  }
```

Notes: the only behavioral differences from the original are (a) the off-state renders an explainer
paragraph instead of nothing, and (b) settings are distributed across four cards + three Advanced
cards instead of one card + five Advanced cards. The runtime failure banner moves to the header card
(top of the panel) so failures are prominent.

- [ ] **Step 3: Add `renderPromptEditor` (Prompt moves into the Style group)**

This replaces `renderCustomizeStyleSection`. It renders the prompt textarea directly into the passed
parent (the Style group's `setting-items`) with no inner `createSettingGroup` wrapper. Remove
`renderCustomizeStyleSection` and add:

```ts
  private renderPromptEditor(parent: HTMLElement, settings: PluginSettings): void {
    this.addTextAreaSetting(
      parent,
      'Prompt',
      'System prompt sent to the model.',
      settings.llmPostprocessPrompt,
      10,
      (value) => {
        this.schedulePromptSave(value);
      },
      'Instructions sent as the system prompt for the local LLM transform.',
    );
  }
```

- [ ] **Step 4: Add `renderNoteContextChars` (note-context field moves beside its toggle)**

The "Note context chars" field, previously the first item of `renderContextLimitsSection`, now lives
in the Context group next to the toggle that gates it. Add:

```ts
  private renderNoteContextChars(parent: HTMLElement, settings: PluginSettings): void {
    if (!settings.useLlmNoteContext) {
      return;
    }
    this.addNumberSetting(
      parent,
      'Note context chars',
      'Chars of note text',
      settings.llmPostprocessNoteContextChars,
      (value) => this.saveField('llmPostprocessNoteContextChars', value, { rerender: false }),
      'Characters of surrounding note text fed to the model as context.',
    );
  }
```

- [ ] **Step 5: Add `renderLimitsSection` (merges remaining Context limits + Skip gates)**

This replaces both `renderContextLimitsSection` and `renderSkipSection`. It is the Advanced "Limits"
card: Total context cap (+ warning), Prior utterances (when not batch), Min words. Remove
`renderContextLimitsSection` and `renderSkipSection`, then add:

```ts
  private renderLimitsSection(parent: HTMLElement, settings: PluginSettings): void {
    const items = createSettingGroup(
      parent,
      'Limits',
      'Bounds on the context fed to the model, plus a word floor for skipping the transform.',
    );

    this.addNumberSetting(
      items,
      'Total context cap',
      'Hard cap on context chars',
      settings.llmPostprocessTotalContextCap,
      (value) => this.saveField('llmPostprocessTotalContextCap', value, { rerender: false }),
      'Hard cap on total context characters across note and prior utterances.',
    );

    if (Math.ceil(settings.llmPostprocessTotalContextCap / 4) >= 4_000) {
      items.createEl('p', {
        cls: 'local-dictation-muted',
        text: 'Large context windows can slow local models and reduce LLM transform quality.',
      });
    }

    if (settings.llmPostprocessMode !== 'batch') {
      this.addNumberSetting(
        items,
        'Prior utterances',
        'Recent utterances kept',
        settings.llmPostprocessPriorUtterancesN,
        (value) => this.saveField('llmPostprocessPriorUtterancesN', value, { rerender: false }),
        'Number of recent transcribed utterances included as conversation history.',
      );
    }

    const override = activePresetOverride(settings, 'minWords');
    this.addNumberSetting(
      items,
      'Min words',
      override !== null
        ? `Set by preset "${override.label}". Delete and re-save the preset to change.`
        : 'Skip the transform under N words.',
      override?.value ?? settings.llmPostprocessSkipMinWords,
      (value) => this.saveField('llmPostprocessSkipMinWords', value, { rerender: false }),
      'Skip the LLM transform when the utterance has fewer words than this.',
      { disabled: override !== null },
    );
  }
```

- [ ] **Step 6: Confirm the removed helpers have no remaining references**

After Steps 3–5, these three methods must be gone and unreferenced: `renderContextLimitsSection`,
`renderSkipSection`, `renderCustomizeStyleSection`. `renderGenerationSection`,
`renderDiagnosticsSection`, `renderStylePicker`, `renderCleanupMode`, and
`renderUseNoteContextToggle` remain unchanged.

Run: `rg -n "renderContextLimitsSection|renderSkipSection|renderCustomizeStyleSection" src/`
Expected: no matches.

- [ ] **Step 7: Typecheck + lint the view change**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (If lint flags member-ordering for the new private methods, place them where Biome
wants — adjacent to the other `render*` helpers.)

- [ ] **Step 8: Commit**

```bash
git add src/ui/local-dictation-view.ts
git commit -m "refactor(ui): regroup LLM transformation sidebar into Where it runs / Style / Context"
```

---

### Task 2: Remove the duplicated routing label and its dead CSS

The "Where it runs" group heading now labels the routing block, so the routing control's own
"Where transforms run" label is redundant. Removing it leaves its CSS rule unused, so that goes too.

**Files:**
- Modify: `src/ui/llm-routing-controls.ts:180`
- Modify: `styles.css` (the `.local-dictation-route-field__label` rule)

- [ ] **Step 1: Remove the internal label in `renderSegmentedControl`**

In `src/ui/llm-routing-controls.ts`, delete this line (currently line 180):

```ts
    field.createDiv({ cls: 'local-dictation-route-field__label', text: 'Where transforms run' });
```

Leave the surrounding `field` div (`local-dictation-route-field`) and the segmented/hint rendering
intact — only the label child is removed.

- [ ] **Step 2: Remove the dead CSS rule**

In `styles.css`, delete the entire rule block (currently lines 701–706):

```css
.local-dictation-route-field__label {
  margin-bottom: var(--size-4-2);
  font-size: var(--font-ui-small);
  font-weight: 600;
  color: var(--text-normal);
}
```

- [ ] **Step 3: Confirm the class is fully gone**

Run: `rg -n "route-field__label" src/ styles.css`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add src/ui/llm-routing-controls.ts styles.css
git commit -m "refactor(ui): drop duplicate routing label now carried by the group heading"
```

---

### Task 3: Full verification gate + manual smoke test

**Files:** none (verification only).

- [ ] **Step 1: Run the frontend check gate**

Run: `npm run check:frontend`
Expected: PASS (typecheck + Biome + Vitest + esbuild production build all green).

- [ ] **Step 2: Manual smoke test in Obsidian**

Build/install the dev plugin (`npm run install:dev`) or load the built `main.js`, open the Local
Dictation sidebar, and confirm:

- [ ] Transform OFF → header card shows the toggle + the muted explainer paragraph; no empty card, no
      group cards, no Advanced section.
- [ ] Transform ON → four stacked cards in order: **LLM transformation**, **Where it runs**,
      **Style**, **Context**; then a collapsible **Advanced** with **Limits**, **Generation**,
      **Diagnostics**.
- [ ] **Where it runs** shows the segmented Local/Remote/Auto control with no duplicated
      "Where transforms run" text above it; provider config (Ollama model, or OpenRouter key+model,
      or Auto's both legs + threshold) renders as before.
- [ ] **Style** shows Preset (with save/delete buttons + info tooltip), Mode (only when the active
      preset declares no fixed mode), and the Prompt textarea.
- [ ] **Context** shows the "Use note as LLM context" toggle; "Note context chars" appears only when
      that toggle is on and disappears when off.
- [ ] **Advanced → Limits** shows Total context cap (with the large-window warning when
      `cap/4 >= 4000`), Prior utterances (hidden when Mode is batch), and Min words (disabled with the
      preset-override description when a preset fixes it).
- [ ] Editing the Prompt still debounce-saves and flips Preset to "Custom" on blur.
- [ ] A simulated runtime cleanup failure still surfaces its banner at the top of the panel.

- [ ] **Step 3: Update the release notes if this ships in a release**

Per the repo's release checklist, a user-facing UI change warrants a line in the current
`docs/release-notes/<version>.md`. If cutting a release with this change, add a short entry (e.g.
"Reorganized the LLM transformation sidebar into clearer groups"). If this is landing mid-cycle
without a release bump, skip.

---

## Self-Review

**Spec coverage:**
- Three labeled groups (Where it runs / Style / Context) → Task 1 Step 2. ✓
- Off-state explainer → Task 1 Steps 1–2. ✓
- Prompt promoted to Style → Task 1 Step 3. ✓
- Note context chars beside its toggle → Task 1 Step 4. ✓
- Advanced slimmed to Limits / Generation / Diagnostics (Skip gates + Context limits folded) →
  Task 1 Step 5 (+ unchanged Generation/Diagnostics). ✓
- "Style" naming + Preset-row tooltip retained → Task 1 Steps 2–3 (renderStylePicker unchanged keeps
  `STYLE_PICKER_TOOLTIP`). ✓
- Routing label de-duplicated → Task 2. ✓
- All conditionals preserved (Mode, note-chars, prior-utterances, cap warning, min-words/temperature
  override-disable) → carried verbatim in Steps 4–5; Mode/Generation/Diagnostics untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected
output. ✓

**Type consistency:** New helpers (`renderPromptEditor`, `renderNoteContextChars`,
`renderLimitsSection`) use the same `(parent: HTMLElement, settings: PluginSettings)` signature and
the same `addTextAreaSetting` / `addNumberSetting` / `createSettingGroup` / `activePresetOverride`
APIs already defined in the file. `refresh()` references only methods that exist after Task 1. ✓
