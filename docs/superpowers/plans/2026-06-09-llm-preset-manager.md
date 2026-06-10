# LLM Preset Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prompt-textarea/Custom-state preset UX with a ref-only preset model, a drill-in manager modal, per-field overrides, and additive (add-above/add-below) batch output.

**Architecture:** Presets become the single unit of transform behavior (`prompt` + optional `timing` + `output` + per-field `overrides`), referenced from settings by `llmPostprocessActivePresetRef` alone — `llmPostprocessPrompt` is removed and migrated into a user preset when customized. The session snapshot resolves the active preset once at session start; the batch path branches replace vs. insert-adjacent. All CRUD happens in a new drill-in modal modeled on Manage models.

**Tech Stack:** TypeScript (Obsidian plugin API), esbuild, vitest, biome + eslint. Code must pass `npm run typecheck` with TS 6 but also eslint-plugin-obsidianmd which parses with TS 5.4 — avoid TS 5.7+ syntax. Spec: `docs/superpowers/specs/2026-06-09-llm-preset-redesign-design.md`.

---

## File structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/llm/presets.ts` | Rewrite | `LlmPreset` type, built-in lineup, ref parse/format, entry listing/resolution, behavior line, effective-override resolution |
| `src/settings/plugin-settings.ts` | Modify | Drop `llmPostprocessPrompt`, ref always-valid, user-preset read with legacy migration, reset semantics |
| `src/session/session.ts` | Modify | New `insertAdjacentToSessionRange(block, placement)` |
| `src/dictation/dictation-session-controller.ts` | Modify | Snapshot resolves preset (prompt/output/effective overrides/forced mode); batch path branches additive vs replace |
| `src/ui/preset-draft.ts` | Create | Pure draft model + `validatePresetDraft` (no Obsidian imports, unit-testable) |
| `src/ui/preset-manager-modal.ts` | Create | Drill-in modal: list view + editor view, CRUD persistence |
| `src/ui/local-dictation-view.ts` | Modify | Slim panel: preset dropdown + Manage button, always-visible Mode, override annotations; delete prompt/Custom machinery |
| `src/ui/save-style-modal.ts` | Delete | Superseded by manager modal |
| `styles.css` | Modify | Preset-manager row/error styles; drop `.local-stt-preset-delete` |
| `test/presets.test.ts` | Rewrite | New model behavior |
| `test/plugin-settings.test.ts` | Modify | Migration + reset tests |
| `test/session.test.ts` | Modify | Insert-adjacent tests |
| `test/dictation-session-controller.test.ts` | Modify | Snapshot resolution + additive batch tests |
| `test/preset-draft.test.ts` | Create | Validation rules |
| `test/fixtures/llm.ts` | Modify | Add `createUserPreset` fixture helper |

Dependency order: Task 1 → Task 2 → (Task 3, Task 4) → Task 5 → Task 6 → Task 7 → Task 8.

---

### Task 1: Preset model rework (`src/llm/presets.ts`)

**Files:**
- Modify: `src/llm/presets.ts` (full rewrite of types/built-ins; keep ref helpers)
- Test: `test/presets.test.ts` (rewrite)
- Modify: `test/fixtures/llm.ts` (add preset fixture)

- [ ] **Step 1: Add preset fixture to `test/fixtures/llm.ts`**

```ts
import type { LlmPreset } from '../../src/llm/presets';

export function createUserPreset(overrides: Partial<LlmPreset> = {}): LlmPreset {
  return {
    id: 'user-preset-1',
    label: 'My transform',
    output: 'replace',
    prompt: 'Rewrite the text.',
    ...overrides,
  };
}
```

- [ ] **Step 2: Rewrite `test/presets.test.ts` (failing first)**

```ts
import { describe, expect, it } from 'vitest';

import {
  describePresetBehavior,
  getLlmBuiltinPreset,
  LLM_BUILTIN_PRESETS,
  listPresetEntries,
  resolveActivePresetEntry,
  resolveEffectiveLlmGlobals,
  resolvePresetEntry,
} from '../src/llm/presets';
import { createUserPreset } from './fixtures/llm';

const GLOBALS = { minWords: 4, temperature: 0.2, useNoteContext: false };

describe('LLM presets', () => {
  it('ships the approved built-in lineup', () => {
    expect(LLM_BUILTIN_PRESETS.map((preset) => preset.id)).toEqual([
      'clean-up',
      'professional-writing',
      'tldr',
      'markdown-formatting',
      'brain-dump',
      'action-items',
    ]);
  });

  it('tldr and action-items are batch-only additive presets', () => {
    const tldr = getLlmBuiltinPreset('tldr');
    expect(tldr.timing).toBe('batch');
    expect(tldr.output).toBe('add_above');
    expect(tldr.prompt).not.toMatch(/transcript with light cleanup/i);

    const actionItems = getLlmBuiltinPreset('action-items');
    expect(actionItems.timing).toBe('batch');
    expect(actionItems.output).toBe('add_below');
  });

  it('clean-up and professional-writing stay timing-agnostic replace presets', () => {
    for (const id of ['clean-up', 'professional-writing'] as const) {
      const preset = getLlmBuiltinPreset(id);
      expect(preset.timing).toBeUndefined();
      expect(preset.output).toBe('replace');
    }
  });

  it('listPresetEntries returns built-ins then user presets with refs', () => {
    const entries = listPresetEntries([createUserPreset({ id: 'abc' })]);
    expect(entries[0]).toMatchObject({ isBuiltin: true, ref: 'builtin:clean-up' });
    expect(entries.at(-1)).toMatchObject({ isBuiltin: false, ref: 'user:abc' });
  });

  it('resolvePresetEntry returns null for unknown refs (including removed voice-commands)', () => {
    expect(resolvePresetEntry('builtin:voice-commands', [])).toBeNull();
    expect(resolvePresetEntry('user:missing', [])).toBeNull();
    expect(resolvePresetEntry(null, [])).toBeNull();
  });

  it('resolveActivePresetEntry falls back to clean-up', () => {
    expect(resolveActivePresetEntry('builtin:voice-commands', []).ref).toBe('builtin:clean-up');
    expect(resolveActivePresetEntry('user:abc', [createUserPreset({ id: 'abc' })]).ref).toBe(
      'user:abc',
    );
  });

  it('resolveEffectiveLlmGlobals applies per-field overrides', () => {
    const preset = createUserPreset({
      overrides: { temperature: 0.9, useNoteContext: true },
    });
    expect(resolveEffectiveLlmGlobals(GLOBALS, preset)).toEqual({
      minWords: 4,
      temperature: 0.9,
      useNoteContext: true,
    });
    expect(resolveEffectiveLlmGlobals(GLOBALS, createUserPreset())).toEqual(GLOBALS);
  });

  it('describePresetBehavior summarizes timing, output, and overrides', () => {
    expect(describePresetBehavior(getLlmBuiltinPreset('tldr'))).toBe(
      'Runs once on stop · adds new content above the transcript',
    );
    expect(
      describePresetBehavior(createUserPreset({ overrides: { minWords: 0, temperature: 1 } })),
    ).toBe('Runs in either mode · rewrites the dictated text · overrides min words, temperature');
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run test/presets.test.ts` → FAIL (missing exports).

- [ ] **Step 4: Rewrite `src/llm/presets.ts`**

Keep: `LLM_POSTPROCESS_MODES`, `LlmPostprocessMode`, `isLlmPostprocessMode`, `LlmStyleRef`, `formatStyleRef`, `parseStyleRef`, `getLlmBuiltinPreset`, `DEFAULT_LLM_BUILTIN_PRESET_ID`, prompts for clean-up / professional-writing / markdown-formatting / brain-dump.

Remove: `LlmUserPreset`, `LlmStyleOption`, `listStyleOptions`, `resolveStyleOption`, `findMatchingStyleRef`, `isLlmPresetMode`/`LlmPresetMode`, voice-commands.

Add:

```ts
export type LlmPresetTiming = Exclude<LlmPostprocessMode, 'off'>;

export function isLlmPresetTiming(value: unknown): value is LlmPresetTiming {
  return value === 'per_utterance' || value === 'batch';
}

export const LLM_PRESET_OUTPUTS = ['replace', 'add_above', 'add_below'] as const;

export type LlmPresetOutput = (typeof LLM_PRESET_OUTPUTS)[number];

export function isLlmPresetOutput(value: unknown): value is LlmPresetOutput {
  return typeof value === 'string' && (LLM_PRESET_OUTPUTS as readonly string[]).includes(value);
}

export interface LlmPresetOverrides {
  minWords?: number;
  temperature?: number;
  useNoteContext?: boolean;
}

export interface LlmPreset {
  id: string;
  label: string;
  description?: string;
  prompt: string;
  // undefined = either; presets with add_* output are always 'batch'.
  timing?: LlmPresetTiming;
  output: LlmPresetOutput;
  overrides?: LlmPresetOverrides;
}

export type LlmBuiltinPresetId =
  | 'clean-up'
  | 'professional-writing'
  | 'tldr'
  | 'markdown-formatting'
  | 'brain-dump'
  | 'action-items';

export interface LlmPresetEntry {
  isBuiltin: boolean;
  preset: LlmPreset;
  ref: string;
}
```

New prompts (TLDR no longer re-emits the transcript):

```ts
const TLDR_PROMPT =
  "Write a TLDR summary of the dictated transcript: a 'TLDR' heading followed by 1-3 short bullets covering the key points. Return only the heading and bullets — do not repeat the transcript, no preamble, no commentary.";

const ACTION_ITEMS_PROMPT =
  "Extract action items from the dictated transcript. Output an 'Action items' heading followed by a Markdown checklist of concrete tasks, naming an owner when the speaker mentions one. If the transcript contains no action items, return nothing. Return only the heading and checklist — do not repeat the transcript, no preamble, no commentary.";
```

Built-in lineup (`id` typed `LlmBuiltinPresetId`, `as const satisfies readonly (LlmPreset & { id: LlmBuiltinPresetId })[]`), in order: clean-up (`output: 'replace'`, no timing), professional-writing (same), tldr (`timing: 'batch'`, `output: 'add_above'`, description "Add a short TLDR summary above your untouched transcript."), markdown-formatting (`timing: 'batch'`, `output: 'replace'`), brain-dump (`timing: 'batch'`, `output: 'replace'`), action-items (`timing: 'batch'`, `output: 'add_below'`, description "Add an action-item checklist below your untouched transcript."). Keep existing descriptions for the carried-over presets but strip the "Batch only."/"Designed for batch…" trailing sentences (the behavior line/Mode row covers that now).

New functions:

```ts
export function listPresetEntries(userPresets: readonly LlmPreset[]): LlmPresetEntry[] {
  return [
    ...LLM_BUILTIN_PRESETS.map((preset) => ({
      isBuiltin: true,
      preset,
      ref: formatStyleRef({ kind: 'builtin', id: preset.id }),
    })),
    ...userPresets.map((preset) => ({
      isBuiltin: false,
      preset,
      ref: formatStyleRef({ kind: 'user', id: preset.id }),
    })),
  ];
}

export function resolvePresetEntry(
  ref: string | null,
  userPresets: readonly LlmPreset[],
): LlmPresetEntry | null {
  if (ref === null) {
    return null;
  }
  return listPresetEntries(userPresets).find((entry) => entry.ref === ref) ?? null;
}

export function resolveActivePresetEntry(
  ref: string | null,
  userPresets: readonly LlmPreset[],
): LlmPresetEntry {
  const resolved = resolvePresetEntry(ref, userPresets);
  if (resolved !== null) {
    return resolved;
  }
  return {
    isBuiltin: true,
    preset: getLlmBuiltinPreset(DEFAULT_LLM_BUILTIN_PRESET_ID),
    ref: formatStyleRef({ kind: 'builtin', id: DEFAULT_LLM_BUILTIN_PRESET_ID }),
  };
}

export interface LlmTransformGlobals {
  minWords: number;
  temperature: number;
  useNoteContext: boolean;
}

// The extension point for future per-preset overrides: add an optional field
// to LlmPresetOverrides and resolve it here; absent fields inherit globals.
export function resolveEffectiveLlmGlobals(
  globals: LlmTransformGlobals,
  preset: LlmPreset,
): LlmTransformGlobals {
  return {
    minWords: preset.overrides?.minWords ?? globals.minWords,
    temperature: preset.overrides?.temperature ?? globals.temperature,
    useNoteContext: preset.overrides?.useNoteContext ?? globals.useNoteContext,
  };
}

export function describePresetTiming(timing: LlmPresetTiming | undefined): string {
  if (timing === 'per_utterance') {
    return 'Runs after each phrase';
  }
  if (timing === 'batch') {
    return 'Runs once on stop';
  }
  return 'Runs in either mode';
}

export function describePresetBehavior(preset: LlmPreset): string {
  const output =
    preset.output === 'add_above'
      ? 'adds new content above the transcript'
      : preset.output === 'add_below'
        ? 'adds new content below the transcript'
        : 'rewrites the dictated text';
  const overridden: string[] = [];
  if (preset.overrides?.minWords !== undefined) overridden.push('min words');
  if (preset.overrides?.temperature !== undefined) overridden.push('temperature');
  if (preset.overrides?.useNoteContext !== undefined) overridden.push('note context');
  const parts = [describePresetTiming(preset.timing), output];
  if (overridden.length > 0) {
    parts.push(`overrides ${overridden.join(', ')}`);
  }
  return parts.join(' · ');
}
```

`parseStyleRef` keeps validating builtin ids against `LLM_BUILTIN_PRESETS`, so `builtin:voice-commands` now parses to `null` (→ fallback).

- [ ] **Step 5: Run** `npx vitest run test/presets.test.ts` → PASS. (Other suites now fail to compile — expected until Tasks 2/4/6/7.)

- [ ] **Step 6: Commit** — `git add src/llm/presets.ts test/presets.test.ts test/fixtures/llm.ts && git commit -m "feat(llm): rework preset model with timing, output, and overrides"`

---

### Task 2: Ref-only settings + migration (`src/settings/plugin-settings.ts`)

**Files:**
- Modify: `src/settings/plugin-settings.ts`
- Test: `test/plugin-settings.test.ts`

- [ ] **Step 1: Update tests (failing first)** — in `test/plugin-settings.test.ts`: delete assertions that `llmPostprocessPrompt` round-trips (lines ~43–63, 103–167 prompt cases, 322–362 ref/prompt sync cases, 509–529 reset prompt cases) and add:

```ts
describe('llm preset migration', () => {
  it('drops a legacy prompt that matches the active preset', () => {
    const settings = resolvePluginSettings({
      llmPostprocessActivePresetRef: 'builtin:professional-writing',
      llmPostprocessPrompt: getLlmBuiltinPreset('professional-writing').prompt,
    });
    expect(settings.llmPostprocessActivePresetRef).toBe('builtin:professional-writing');
    expect(settings.llmPostprocessUserPresets).toHaveLength(0);
    expect('llmPostprocessPrompt' in settings).toBe(false);
  });

  it('re-points the ref when a legacy prompt matches another preset', () => {
    const settings = resolvePluginSettings({
      llmPostprocessActivePresetRef: 'builtin:clean-up',
      llmPostprocessPrompt: getLlmBuiltinPreset('professional-writing').prompt,
    });
    expect(settings.llmPostprocessActivePresetRef).toBe('builtin:professional-writing');
  });

  it('converts a custom legacy prompt into a "My preset" user preset', () => {
    const settings = resolvePluginSettings({ llmPostprocessPrompt: 'fully custom prompt' });
    const created = settings.llmPostprocessUserPresets[0];
    expect(created).toMatchObject({ label: 'My preset', output: 'replace', prompt: 'fully custom prompt' });
    expect(settings.llmPostprocessActivePresetRef).toBe(`user:${created?.id}`);
  });

  it('falls back to clean-up for unknown refs, including removed voice-commands', () => {
    expect(
      resolvePluginSettings({ llmPostprocessActivePresetRef: 'builtin:voice-commands' })
        .llmPostprocessActivePresetRef,
    ).toBe('builtin:clean-up');
    expect(
      resolvePluginSettings({ llmPostprocessActivePresetRef: null }).llmPostprocessActivePresetRef,
    ).toBe('builtin:clean-up');
  });

  it('migrates legacy user-preset fields into the new shape', () => {
    const settings = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'a', label: 'Old', prompt: 'p', mode: 'batch', minWords: 2, temperature: 0.7 },
      ],
    });
    expect(settings.llmPostprocessUserPresets[0]).toEqual({
      id: 'a',
      label: 'Old',
      output: 'replace',
      overrides: { minWords: 2, temperature: 0.7 },
      prompt: 'p',
      timing: 'batch',
    });
  });

  it('drops user presets without a prompt and forces batch timing for additive presets', () => {
    const settings = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'empty', label: 'No prompt', prompt: '   ' },
        { id: 'add', label: 'Adder', prompt: 'p', output: 'add_above', timing: 'per_utterance' },
      ],
    });
    expect(settings.llmPostprocessUserPresets).toHaveLength(1);
    expect(settings.llmPostprocessUserPresets[0]).toMatchObject({ id: 'add', timing: 'batch' });
  });
});
```

Update the reset test: `resetLlmPostprocessDefaults` now sets `llmPostprocessMode: 'per_utterance'`, `llmPostprocessActivePresetRef: 'builtin:clean-up'`, keeps `llmPostprocessUserPresets` untouched, and has no prompt field.

- [ ] **Step 2: Run** `npx vitest run test/plugin-settings.test.ts` → FAIL.

- [ ] **Step 3: Implement in `plugin-settings.ts`**

- Imports: replace removed exports with `isLlmPresetOutput`, `isLlmPresetTiming`, `LLM_BUILTIN_PRESETS`, `listPresetEntries`, `resolveActivePresetEntry`, `resolvePresetEntry`, `type LlmPreset`, `type LlmPresetOverrides`; add `import { randomUUID } from 'node:crypto';`.
- `PluginSettings`: `llmPostprocessActivePresetRef: string;` (no null), delete `llmPostprocessPrompt`. `llmPostprocessUserPresets: LlmPreset[]`. Delete `DEFAULT_LLM_POSTPROCESS_PROMPT` and `readPrompt`.
- In `resolvePluginSettings`:

```ts
const storedUserPresets = readUserPresets(raw.llmPostprocessUserPresets);
const { activeRef, userPresets } = migrateLlmPresetState({
  legacyPrompt: raw.llmPostprocessPrompt,
  storedRef: raw.llmPostprocessActivePresetRef,
  userPresets: storedUserPresets,
});
```

…and use `llmPostprocessActivePresetRef: activeRef`, `llmPostprocessUserPresets: userPresets` in the returned object (prompt line deleted).

```ts
// Tolerant reads (schemaVersion stays 1): unknown refs fall back to the default
// preset, and a customized legacy llmPostprocessPrompt becomes a user preset so
// pre-redesign custom prompts survive the removal of the prompt setting.
function migrateLlmPresetState(args: {
  legacyPrompt: unknown;
  storedRef: unknown;
  userPresets: LlmPreset[];
}): { activeRef: string; userPresets: LlmPreset[] } {
  const storedRef = typeof args.storedRef === 'string' ? args.storedRef : null;
  const resolvedRef = resolvePresetEntry(storedRef, args.userPresets)?.ref ?? null;
  const fallbackRef = resolveActivePresetEntry(null, args.userPresets).ref;
  const prompt = typeof args.legacyPrompt === 'string' ? args.legacyPrompt.trim() : '';

  if (prompt.length === 0) {
    return { activeRef: resolvedRef ?? fallbackRef, userPresets: args.userPresets };
  }
  if (resolvedRef !== null) {
    const active = resolveActivePresetEntry(resolvedRef, args.userPresets);
    if (active.preset.prompt === prompt) {
      return { activeRef: resolvedRef, userPresets: args.userPresets };
    }
  }
  const matching = listPresetEntries(args.userPresets).find(
    (entry) => entry.preset.prompt === prompt,
  );
  if (matching !== undefined) {
    return { activeRef: matching.ref, userPresets: args.userPresets };
  }
  if (args.userPresets.length >= LLM_USER_PRESET_MAX_COUNT) {
    return { activeRef: resolvedRef ?? fallbackRef, userPresets: args.userPresets };
  }
  const labels = new Set(
    [...LLM_BUILTIN_PRESETS, ...args.userPresets].map((preset) => preset.label.toLowerCase()),
  );
  let label = 'My preset';
  for (let n = 2; labels.has(label.toLowerCase()); n += 1) {
    label = `My preset ${n}`;
  }
  const migrated: LlmPreset = { id: randomUUID(), label, output: 'replace', prompt };
  return {
    activeRef: `user:${migrated.id}`,
    userPresets: [...args.userPresets, migrated],
  };
}
```

- `readUserPresets` body (per-entry, after the existing id/label checks):

```ts
const prompt = typeof entry.prompt === 'string' && entry.prompt.trim().length > 0 ? entry.prompt : null;
if (prompt === null) {
  continue;
}
const description = typeof entry.description === 'string' ? entry.description.trim() : '';
const output = isLlmPresetOutput(entry.output) ? entry.output : 'replace';
const legacyTiming = isLlmPresetTiming(entry.timing)
  ? entry.timing
  : isLlmPresetTiming(entry.mode)
    ? entry.mode
    : undefined;
const timing = output === 'replace' ? legacyTiming : 'batch';
const overridesRaw = isRecord(entry.overrides) ? entry.overrides : {};
const minWords = readOptionalClampedInteger(overridesRaw.minWords ?? entry.minWords, 0, 50);
const temperature = readOptionalClampedNumber(overridesRaw.temperature ?? entry.temperature, 0, 2);
const useNoteContext =
  typeof overridesRaw.useNoteContext === 'boolean' ? overridesRaw.useNoteContext : undefined;
const overrides: LlmPresetOverrides = {
  ...(minWords !== undefined ? { minWords } : {}),
  ...(temperature !== undefined ? { temperature } : {}),
  ...(useNoteContext !== undefined ? { useNoteContext } : {}),
};

accepted.push({
  ...(description.length > 0
    ? { description: description.slice(0, LLM_USER_PRESET_MAX_DESCRIPTION_CHARS) }
    : {}),
  id,
  label: label.slice(0, LLM_USER_PRESET_MAX_LABEL_CHARS),
  output,
  ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
  prompt,
  ...(timing !== undefined ? { timing } : {}),
});
```

- Delete the old `readActivePresetRef`.
- `resetLlmPostprocessDefaults`: remove the prompt line; set `llmPostprocessMode: 'per_utterance'` with a comment that reset keeps the transform on (the button is only reachable while it's on); keep the rest.
- `DEFAULT_PLUGIN_SETTINGS.llmPostprocessActivePresetRef` stays `DEFAULT_LLM_ACTIVE_PRESET_REF` (now typed `string`).

- [ ] **Step 4: Run** `npx vitest run test/plugin-settings.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/settings/plugin-settings.ts test/plugin-settings.test.ts && git commit -m "feat(settings): ref-only preset model with legacy prompt migration"`

---

### Task 3: Session insert-adjacent (`src/session/session.ts`)

**Files:**
- Modify: `src/session/session.ts` (next to `replaceSessionRangeWithCleaned`, ~line 207)
- Test: `test/session.test.ts`

- [ ] **Step 1: Write failing tests** — reuse the existing fake-surface harness in `test/session.test.ts` (the suite already covers `replaceSessionRangeWithCleaned`; mirror its setup for accepting an utterance and asserting on `rewriteRegion` calls):

```ts
it('insertAdjacentToSessionRange prepends above the untouched session range', () => {
  // setup: session with one accepted final utterance whose projected text is 'hello world'
  const inserted = session.insertAdjacentToSessionRange('TLDR\n- point', 'above');
  expect(inserted).toBe(true);
  // assert the fake surface's rewriteRegion received `TLDR\n- point\n\nhello world`
});

it('insertAdjacentToSessionRange appends below the session range', () => {
  const inserted = session.insertAdjacentToSessionRange('Action items', 'below');
  expect(inserted).toBe(true);
  // assert replacement === `hello world\n\nAction items`
});

it('insertAdjacentToSessionRange returns false with no session entries', () => {
  expect(emptySession.insertAdjacentToSessionRange('x', 'above')).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run test/session.test.ts` → FAIL (method missing).

- [ ] **Step 3: Implement** — insert after `replaceSessionRangeWithCleaned`:

```ts
insertAdjacentToSessionRange(blockText: string, placement: 'above' | 'below'): boolean {
  if (this.surface === null || this.rawSessionEntries.length === 0) {
    return false;
  }

  const range = this.resolveSessionRange();
  if (range === null) {
    return false;
  }

  const current = this.surface.readRange(range);
  if (current === null) {
    return false;
  }

  // Additive presets leave the dictated text untouched: rewrite the region to
  // itself with the generated block stitched above or below it, reusing the
  // same edit-tolerant region rewrite as the batch replace path.
  const replacement =
    placement === 'above' ? `${blockText}\n\n${current}` : `${current}\n\n${blockText}`;

  const result = this.surface.rewriteRegion(
    range,
    replacement,
    this.rawSessionEntries.map((entry) => ({ utteranceId: entry.utteranceId })),
  );

  return result.kind === 'rewritten';
}
```

- [ ] **Step 4: Run** `npx vitest run test/session.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/session/session.ts test/session.test.ts && git commit -m "feat(session): insert generated block adjacent to the session range"`

---

### Task 4: Controller snapshot + additive batch (`src/dictation/dictation-session-controller.ts`)

**Files:**
- Modify: `src/dictation/dictation-session-controller.ts` (snapshot ~55–76, batch ~880–900, snapshot factory ~1017–1069)
- Test: `test/dictation-session-controller.test.ts`

- [ ] **Step 1: Write failing tests** — using the suite's existing session-start + fake-router harness:

```ts
it('snapshot resolves the active preset prompt, overrides, and forced mode', async () => {
  // settings: llmPostprocessMode 'per_utterance', active ref 'user:a' where the
  // user preset pins timing 'batch', overrides temperature 1.1, prompt 'P!'
  // start a session, stop it, and assert the router cleanup call received
  // prompt 'P!' and temperature 1.1 (batch ran despite stored per_utterance mode).
});

it('additive batch inserts instead of replacing and ignores empty output', async () => {
  // active preset output 'add_above'; fake router returns 'TLDR\n- a'.
  // assert session text gained the block above the transcript and the raw
  // transcript text is still present. Second case: router returns '   ' →
  // no insertion, no error notice, session disposed normally.
});
```

Model assertions on how the existing batch tests in this file observe `replaceSessionRangeWithCleaned` (fake `Session` or editor fixture — follow the file's existing pattern).

- [ ] **Step 2: Run** `npx vitest run test/dictation-session-controller.test.ts` → FAIL.

- [ ] **Step 3: Implement**

- Imports: drop `resolveStyleOption`; add `resolveActivePresetEntry`, `resolveEffectiveLlmGlobals`, `type LlmPresetOutput`.
- `ActiveSessionSnapshot`: add `llmPostprocessOutput: LlmPresetOutput;` (keep `llmPostprocessPrompt` as `string`, now sourced from the preset — change its type annotation to `string` since `PluginSettings['llmPostprocessPrompt']` no longer exists).
- Replace `resolveActiveGenerationDefaults` and rework `createSessionSnapshot`:

```ts
const activePreset = resolveActivePresetEntry(
  settings.llmPostprocessActivePresetRef,
  settings.llmPostprocessUserPresets,
).preset;
const effective = resolveEffectiveLlmGlobals(
  {
    minWords: settings.llmPostprocessSkipMinWords,
    temperature: settings.llmPostprocessTemperature,
    useNoteContext: settings.useLlmNoteContext,
  },
  activePreset,
);
// A preset with pinned timing forces the effective mode without overwriting
// the stored user choice.
const llmPostprocessMode: LlmPostprocessMode =
  settings.llmPostprocessMode === 'off'
    ? 'off'
    : (activePreset.timing ?? settings.llmPostprocessMode);
const noteContextChars = effective.useNoteContext ? settings.llmPostprocessNoteContextChars : 0;
```

…and in the returned object: `llmPostprocessMode`, `llmPostprocessOutput: activePreset.output`, `llmPostprocessPrompt: activePreset.prompt`, `llmPostprocessSkipMinWords: effective.minWords`, `llmPostprocessTemperature: effective.temperature`.

- In `runBatchCleanup`, replace the success block (after `clearSessionProcessingMark()`):

```ts
const trimmed = result.text.trim();
if (entry.snapshot.llmPostprocessOutput === 'replace') {
  if (trimmed.length === 0) {
    throw new ProviderError('Provider returned empty cleaned text.', 'invalid_response');
  }
  const replaced = entry.session.replaceSessionRangeWithCleaned(trimmed, {
    rawTextForCallout: transcriptText,
    showRawBelow: entry.snapshot.llmPostprocessShowRawBelow,
  });
  if (!replaced) {
    this.dependencies.logger?.warn(
      'llm',
      'batch cleanup replacement skipped; session range no longer available',
    );
  } else {
    this.dependencies.logger?.debug('llm', 'batch cleanup complete', { chars: trimmed.length });
  }
} else if (trimmed.length === 0) {
  // Additive presets may legitimately find nothing to add (e.g. no action items).
  this.dependencies.logger?.debug('llm', 'additive batch returned empty output; nothing inserted');
} else {
  const placement = entry.snapshot.llmPostprocessOutput === 'add_above' ? 'above' : 'below';
  const inserted = entry.session.insertAdjacentToSessionRange(trimmed, placement);
  if (!inserted) {
    this.dependencies.logger?.warn(
      'llm',
      'additive batch insert skipped; session range no longer available',
    );
  } else {
    this.dependencies.logger?.debug('llm', 'additive batch insert complete', {
      chars: trimmed.length,
      placement,
    });
  }
}
this.dependencies.onLlmCleanupSuccess?.();
this.disposeLocalSession(sessionId);
```

("Show raw beneath LLM output" is naturally ignored on the additive path — the raw text is the note content itself.)

- [ ] **Step 4: Run** `npx vitest run test/dictation-session-controller.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/dictation/dictation-session-controller.ts test/dictation-session-controller.test.ts && git commit -m "feat(llm): resolve presets into session snapshots and support additive batch output"`

---

### Task 5: Draft model + validation (`src/ui/preset-draft.ts`)

**Files:**
- Create: `src/ui/preset-draft.ts` (pure, no Obsidian imports)
- Test: `test/preset-draft.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { getLlmBuiltinPreset } from '../src/llm/presets';
import { draftFromPreset, emptyPresetDraft, validatePresetDraft } from '../src/ui/preset-draft';

const NO_LABELS: string[] = [];

describe('preset draft validation', () => {
  it('accepts a minimal valid draft and omits inherited overrides', () => {
    const result = validatePresetDraft(
      { ...emptyPresetDraft(), label: 'Mine', prompt: 'Do the thing.' },
      NO_LABELS,
    );
    expect(result).toEqual({
      kind: 'ok',
      preset: { label: 'Mine', output: 'replace', prompt: 'Do the thing.' },
    });
  });

  it('rejects empty or duplicate names (case-insensitive) and empty prompts', () => {
    const base = { ...emptyPresetDraft(), label: 'Mine', prompt: 'p' };
    expect(validatePresetDraft({ ...base, label: '  ' }, NO_LABELS).kind).toBe('error');
    expect(validatePresetDraft(base, ['mine']).kind).toBe('error');
    expect(validatePresetDraft({ ...base, prompt: '' }, NO_LABELS).kind).toBe('error');
  });

  it('parses override fields and rejects out-of-range values', () => {
    const base = { ...emptyPresetDraft(), label: 'Mine', prompt: 'p' };
    const ok = validatePresetDraft(
      { ...base, minWords: '3', temperature: '0.7', useNoteContext: 'on' },
      NO_LABELS,
    );
    expect(ok).toMatchObject({
      kind: 'ok',
      preset: { overrides: { minWords: 3, temperature: 0.7, useNoteContext: true } },
    });
    expect(validatePresetDraft({ ...base, minWords: '99' }, NO_LABELS).kind).toBe('error');
    expect(validatePresetDraft({ ...base, temperature: 'abc' }, NO_LABELS).kind).toBe('error');
  });

  it('forces batch timing for additive output', () => {
    const result = validatePresetDraft(
      { ...emptyPresetDraft(), label: 'Adder', output: 'add_below', prompt: 'p', timing: 'either' },
      NO_LABELS,
    );
    expect(result).toMatchObject({ kind: 'ok', preset: { output: 'add_below', timing: 'batch' } });
  });

  it('draftFromPreset round-trips a built-in for duplication', () => {
    const draft = draftFromPreset(getLlmBuiltinPreset('tldr'));
    expect(draft).toMatchObject({ output: 'add_above', prompt: getLlmBuiltinPreset('tldr').prompt, timing: 'batch' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/preset-draft.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/ui/preset-draft.ts`**

```ts
import type { LlmPreset, LlmPresetOutput, LlmPresetOverrides, LlmPresetTiming } from '../llm/presets';
import {
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
} from '../settings/plugin-settings';

export interface LlmPresetDraft {
  description: string;
  label: string;
  // Raw input strings so the editor can hold partially typed values;
  // empty string means "inherit the global setting".
  minWords: string;
  output: LlmPresetOutput;
  prompt: string;
  temperature: string;
  timing: 'either' | LlmPresetTiming;
  useNoteContext: 'inherit' | 'on' | 'off';
}

export type PresetDraftResult =
  | { kind: 'ok'; preset: Omit<LlmPreset, 'id'> }
  | { kind: 'error'; message: string };

export function emptyPresetDraft(): LlmPresetDraft {
  return {
    description: '',
    label: '',
    minWords: '',
    output: 'replace',
    prompt: '',
    temperature: '',
    timing: 'either',
    useNoteContext: 'inherit',
  };
}

export function draftFromPreset(preset: LlmPreset): LlmPresetDraft {
  return {
    description: preset.description ?? '',
    label: preset.label,
    minWords: preset.overrides?.minWords !== undefined ? String(preset.overrides.minWords) : '',
    output: preset.output,
    prompt: preset.prompt,
    temperature:
      preset.overrides?.temperature !== undefined ? String(preset.overrides.temperature) : '',
    timing: preset.timing ?? 'either',
    useNoteContext:
      preset.overrides?.useNoteContext === undefined
        ? 'inherit'
        : preset.overrides.useNoteContext
          ? 'on'
          : 'off',
  };
}

// `existingLabels` must exclude the preset being edited.
export function validatePresetDraft(
  draft: LlmPresetDraft,
  existingLabels: readonly string[],
): PresetDraftResult {
  const label = draft.label.trim().slice(0, LLM_USER_PRESET_MAX_LABEL_CHARS);
  if (label.length === 0) {
    return { kind: 'error', message: 'Enter a name for this preset.' };
  }
  if (existingLabels.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
    return { kind: 'error', message: 'A preset with that name already exists.' };
  }
  if (draft.prompt.trim().length === 0) {
    return { kind: 'error', message: 'Enter a prompt for this preset.' };
  }

  const minWords = parseOptionalInteger(draft.minWords, 0, 50);
  if (minWords === 'invalid') {
    return { kind: 'error', message: 'Min words must be a whole number between 0 and 50.' };
  }
  const temperature = parseOptionalNumber(draft.temperature, 0, 2);
  if (temperature === 'invalid') {
    return { kind: 'error', message: 'Temperature must be a number between 0 and 2.' };
  }

  const timing: LlmPresetTiming | undefined =
    draft.output !== 'replace' ? 'batch' : draft.timing === 'either' ? undefined : draft.timing;
  const overrides: LlmPresetOverrides = {
    ...(minWords !== undefined ? { minWords } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(draft.useNoteContext !== 'inherit' ? { useNoteContext: draft.useNoteContext === 'on' } : {}),
  };
  const description = draft.description.trim().slice(0, LLM_USER_PRESET_MAX_DESCRIPTION_CHARS);

  return {
    kind: 'ok',
    preset: {
      ...(description.length > 0 ? { description } : {}),
      label,
      output: draft.output,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      prompt: draft.prompt,
      ...(timing !== undefined ? { timing } : {}),
    },
  };
}

function parseOptionalInteger(
  value: string,
  min: number,
  max: number,
): number | undefined | 'invalid' {
  if (value.trim() === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return 'invalid';
  return parsed;
}

function parseOptionalNumber(
  value: string,
  min: number,
  max: number,
): number | undefined | 'invalid' {
  if (value.trim() === '') return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return 'invalid';
  return parsed;
}
```

- [ ] **Step 4: Run** `npx vitest run test/preset-draft.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/ui/preset-draft.ts test/preset-draft.test.ts && git commit -m "feat(ui): add preset draft model with pure validation"`

---

### Task 6: Preset manager modal (`src/ui/preset-manager-modal.ts`)

**Files:**
- Create: `src/ui/preset-manager-modal.ts`
- Modify: `styles.css` (replace `.local-stt-preset-delete` block ~line 497 with manager styles)

No vitest coverage for the modal itself (validation is covered by Task 5; DOM wiring is exercised manually in Task 8). Keep all persistence in small private methods so logic stays inspectable.

- [ ] **Step 1: Implement the modal**

```ts
import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import {
  describePresetBehavior,
  describePresetTiming,
  formatStyleRef,
  type LlmPreset,
  type LlmPresetEntry,
  listPresetEntries,
  resolveActivePresetEntry,
} from '../llm/presets';
import {
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
  type PluginSettings,
} from '../settings/plugin-settings';
import { ConfirmModal } from './confirm-modal';
import {
  draftFromPreset,
  emptyPresetDraft,
  type LlmPresetDraft,
  validatePresetDraft,
} from './preset-draft';

interface PresetManagerModalDependencies {
  getSettings: () => PluginSettings;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

type EditorState =
  | { kind: 'create'; draft: LlmPresetDraft }
  | { kind: 'edit'; draft: LlmPresetDraft; presetId: string }
  | { kind: 'view'; preset: LlmPreset };

export class PresetManagerModal extends Modal {
  private editor: EditorState | null = null;

  constructor(
    app: App,
    private readonly deps: PresetManagerModalDependencies,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass('local-stt-preset-manager');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.editor = null;
  }

  private render(): void {
    this.contentEl.empty();
    if (this.editor === null) {
      this.titleEl.setText('Manage presets');
      this.renderList();
    } else {
      this.titleEl.setText(
        this.editor.kind === 'create'
          ? 'New preset'
          : this.editor.kind === 'edit'
            ? 'Edit preset'
            : this.editor.preset.label,
      );
      this.renderEditor(this.editor);
    }
  }

  // ----------------------------------------------------------------- list

  private renderList(): void {
    const settings = this.deps.getSettings();
    const activeRef = resolveActivePresetEntry(
      settings.llmPostprocessActivePresetRef,
      settings.llmPostprocessUserPresets,
    ).ref;
    const reachedMaxCount =
      settings.llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT;

    new Setting(this.contentEl)
      .setName('Presets')
      .setDesc('The active preset is marked. Built-in presets are read-only — duplicate one to customize it.')
      .addButton((button) => {
        button.setCta().setButtonText('New preset');
        if (reachedMaxCount) {
          button.setDisabled(true);
          button.setTooltip(`You can save up to ${LLM_USER_PRESET_MAX_COUNT} presets. Delete one first.`);
          return;
        }
        button.onClick(() => {
          this.editor = { kind: 'create', draft: emptyPresetDraft() };
          this.render();
        });
      });

    const entries = listPresetEntries(settings.llmPostprocessUserPresets);
    this.renderListSection(
      'Built-in',
      entries.filter((entry) => entry.isBuiltin),
      activeRef,
      reachedMaxCount,
    );
    const userEntries = entries.filter((entry) => !entry.isBuiltin);
    if (userEntries.length > 0) {
      this.renderListSection('Your presets', userEntries, activeRef, reachedMaxCount);
    }
  }

  private renderListSection(
    heading: string,
    entries: LlmPresetEntry[],
    activeRef: string,
    reachedMaxCount: boolean,
  ): void {
    new Setting(this.contentEl).setName(heading).setHeading();
    for (const entry of entries) {
      const { preset } = entry;
      const isActive = entry.ref === activeRef;
      const setting = new Setting(this.contentEl)
        .setName(isActive ? `${preset.label} ✓` : preset.label)
        .setDesc(preset.description ?? describePresetBehavior(preset));
      setting.settingEl.addClass('local-stt-preset-row');

      setting.addExtraButton((button) => {
        button
          .setIcon(entry.isBuiltin ? 'eye' : 'pencil')
          .setTooltip(entry.isBuiltin ? 'View preset' : 'Edit preset')
          .onClick(() => {
            this.openEntry(entry);
          });
      });
      setting.addExtraButton((button) => {
        button.setIcon('copy').setTooltip('Duplicate preset');
        if (reachedMaxCount) {
          button.setDisabled(true);
          return;
        }
        button.onClick(() => {
          const draft = draftFromPreset(preset);
          draft.label = `${preset.label} (copy)`.slice(0, LLM_USER_PRESET_MAX_LABEL_CHARS);
          this.editor = { kind: 'create', draft };
          this.render();
        });
      });
      if (!entry.isBuiltin) {
        setting.addExtraButton((button) => {
          button
            .setIcon('trash-2')
            .setTooltip(`Delete preset "${preset.label}"`)
            .onClick(() => {
              this.confirmDelete(preset);
            });
        });
      }

      setting.settingEl.addEventListener('click', (event) => {
        if (event.target instanceof HTMLElement && event.target.closest('button') !== null) {
          return;
        }
        this.openEntry(entry);
      });
    }
  }

  private openEntry(entry: LlmPresetEntry): void {
    this.editor = entry.isBuiltin
      ? { kind: 'view', preset: entry.preset }
      : { kind: 'edit', draft: draftFromPreset(entry.preset), presetId: entry.preset.id };
    this.render();
  }

  // --------------------------------------------------------------- editor

  private renderEditor(editor: EditorState): void {
    const readonly = editor.kind === 'view';
    const draft = editor.kind === 'view' ? draftFromPreset(editor.preset) : editor.draft;

    new Setting(this.contentEl).addButton((button) => {
      button.setIcon('arrow-left').setTooltip('Back to all presets');
      button.onClick(() => {
        this.editor = null;
        this.render();
      });
    });

    new Setting(this.contentEl).setName('Name').addText((text) => {
      text.setPlaceholder('e.g. Meeting notes');
      text.setValue(draft.label);
      text.setDisabled(readonly);
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_LABEL_CHARS;
      text.onChange((value) => {
        draft.label = value;
      });
    });

    new Setting(this.contentEl).setName('Description (optional)').addTextArea((text) => {
      text.setPlaceholder('When to use this preset');
      text.setValue(draft.description);
      text.setDisabled(readonly);
      text.inputEl.rows = 2;
      text.inputEl.maxLength = LLM_USER_PRESET_MAX_DESCRIPTION_CHARS;
      text.onChange((value) => {
        draft.description = value;
      });
    });

    const prompt = new Setting(this.contentEl)
      .setName('Prompt')
      .setDesc('Sent to the model as the system prompt.');
    prompt.settingEl.addClass('local-stt-preset-editor__prompt');
    prompt.addTextArea((text) => {
      text.setValue(draft.prompt);
      text.setDisabled(readonly);
      text.inputEl.rows = 8;
      text.onChange((value) => {
        draft.prompt = value;
      });
    });

    let timingDropdown: ReturnType<Setting['addDropdown']> | null = null;
    new Setting(this.contentEl)
      .setName('Timing')
      .setDesc('When the transform runs. "Either" follows the panel Mode setting.')
      .addDropdown((dropdown) => {
        dropdown.addOption('either', 'Either (follow Mode)');
        dropdown.addOption('per_utterance', 'After each phrase');
        dropdown.addOption('batch', 'Once on stop');
        dropdown.setValue(draft.timing);
        dropdown.setDisabled(readonly || draft.output !== 'replace');
        dropdown.onChange((value) => {
          draft.timing = value === 'per_utterance' || value === 'batch' ? value : 'either';
        });
        timingDropdown = dropdown;
      });

    new Setting(this.contentEl)
      .setName('Output')
      .setDesc('Replace rewrites your dictated text. Add keeps it untouched and inserts new content.')
      .addDropdown((dropdown) => {
        dropdown.addOption('replace', 'Replace text');
        dropdown.addOption('add_above', 'Add above transcript');
        dropdown.addOption('add_below', 'Add below transcript');
        dropdown.setValue(draft.output);
        dropdown.setDisabled(readonly);
        dropdown.onChange((value) => {
          draft.output =
            value === 'add_above' || value === 'add_below' ? value : 'replace';
          if (draft.output !== 'replace') {
            draft.timing = 'batch';
          }
          timingDropdown?.setValue(draft.output === 'replace' ? draft.timing : 'batch');
          timingDropdown?.setDisabled(readonly || draft.output !== 'replace');
        });
      });

    new Setting(this.contentEl)
      .setName('Overrides')
      .setHeading()
      .setDesc('Leave a field blank to use the global setting.');

    new Setting(this.contentEl).setName('Min words').addText((text) => {
      text.inputEl.type = 'number';
      text.inputEl.min = '0';
      text.inputEl.max = '50';
      text.setPlaceholder('Inherit');
      text.setValue(draft.minWords);
      text.setDisabled(readonly);
      text.onChange((value) => {
        draft.minWords = value;
      });
    });

    new Setting(this.contentEl).setName('Temperature').addText((text) => {
      text.inputEl.type = 'number';
      text.inputEl.min = '0';
      text.inputEl.max = '2';
      text.inputEl.step = '0.05';
      text.setPlaceholder('Inherit');
      text.setValue(draft.temperature);
      text.setDisabled(readonly);
      text.onChange((value) => {
        draft.temperature = value;
      });
    });

    new Setting(this.contentEl).setName('Use note as LLM context').addDropdown((dropdown) => {
      dropdown.addOption('inherit', 'Inherit');
      dropdown.addOption('on', 'On');
      dropdown.addOption('off', 'Off');
      dropdown.setValue(draft.useNoteContext);
      dropdown.setDisabled(readonly);
      dropdown.onChange((value) => {
        draft.useNoteContext = value === 'on' || value === 'off' ? value : 'inherit';
      });
    });

    const errorEl = this.contentEl.createEl('p', {
      cls: 'local-stt-preset-editor__error local-stt-hidden',
    });
    errorEl.setAttribute('role', 'alert');
    errorEl.setAttribute('aria-live', 'polite');

    const buttons = new Setting(this.contentEl);
    if (readonly) {
      const reachedMaxCount =
        this.deps.getSettings().llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT;
      buttons.addButton((button) => {
        button.setCta().setButtonText('Duplicate');
        if (reachedMaxCount) {
          button.setDisabled(true);
          button.setTooltip(`You can save up to ${LLM_USER_PRESET_MAX_COUNT} presets. Delete one first.`);
          return;
        }
        button.onClick(() => {
          const copy = draftFromPreset((editor as { kind: 'view'; preset: LlmPreset }).preset);
          copy.label = `${copy.label} (copy)`.slice(0, LLM_USER_PRESET_MAX_LABEL_CHARS);
          this.editor = { kind: 'create', draft: copy };
          this.render();
        });
      });
      return;
    }

    buttons
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.editor = null;
          this.render();
        });
      })
      .addButton((button) => {
        button
          .setCta()
          .setButtonText('Save')
          .onClick(() => {
            void this.handleSave(editor, draft, errorEl);
          });
      });
  }

  // ---------------------------------------------------------- persistence

  private async handleSave(
    editor: EditorState,
    draft: LlmPresetDraft,
    errorEl: HTMLElement,
  ): Promise<void> {
    const settings = this.deps.getSettings();
    const editedId = editor.kind === 'edit' ? editor.presetId : null;
    const existingLabels = listPresetEntries(settings.llmPostprocessUserPresets)
      .filter((entry) => entry.preset.id !== editedId)
      .map((entry) => entry.preset.label);

    const result = validatePresetDraft(draft, existingLabels);
    if (result.kind === 'error') {
      errorEl.setText(result.message);
      errorEl.removeClass('local-stt-hidden');
      return;
    }

    if (editedId !== null) {
      await this.deps.saveSettings({
        ...settings,
        llmPostprocessUserPresets: settings.llmPostprocessUserPresets.map((preset) =>
          preset.id === editedId ? { ...result.preset, id: editedId } : preset,
        ),
      });
    } else {
      if (settings.llmPostprocessUserPresets.length >= LLM_USER_PRESET_MAX_COUNT) {
        errorEl.setText(
          `You can save up to ${LLM_USER_PRESET_MAX_COUNT} presets. Delete one before saving a new preset.`,
        );
        errorEl.removeClass('local-stt-hidden');
        return;
      }
      await this.deps.saveSettings({
        ...settings,
        llmPostprocessUserPresets: [
          ...settings.llmPostprocessUserPresets,
          { ...result.preset, id: crypto.randomUUID() },
        ],
      });
    }
    this.editor = null;
    this.render();
  }

  private confirmDelete(preset: LlmPreset): void {
    new ConfirmModal(this.app, {
      title: 'Delete preset',
      message: `Delete preset "${preset.label}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        const settings = this.deps.getSettings();
        const ref = formatStyleRef({ kind: 'user', id: preset.id });
        const wasActive = settings.llmPostprocessActivePresetRef === ref;
        await this.deps.saveSettings({
          ...settings,
          llmPostprocessActivePresetRef: wasActive
            ? resolveActivePresetEntry(null, []).ref
            : settings.llmPostprocessActivePresetRef,
          llmPostprocessUserPresets: settings.llmPostprocessUserPresets.filter(
            (entry) => entry.id !== preset.id,
          ),
        });
        if (wasActive) {
          new Notice(`"${preset.label}" was active — switched to Clean up.`);
        }
        this.render();
      },
    }).open();
  }
}
```

Adjust during implementation: `timingDropdown` typing (`DropdownComponent | null`, imported from obsidian); `randomUUID` import from `node:crypto` to match the codebase (not `crypto.randomUUID`); use `describePresetTiming` if a pinned-timing note is needed in the view state. Match `ConfirmModal`'s actual option names from `src/ui/confirm-modal.ts`.

- [ ] **Step 2: styles.css** — replace the `.local-stt-preset-delete:hover` block (~line 497):

```css
.local-stt-preset-manager .local-stt-preset-row {
  cursor: pointer;
}

.local-stt-preset-editor__prompt textarea {
  width: 100%;
}

.local-stt-preset-editor__error {
  color: var(--text-error);
  margin: var(--size-2-2) 0;
}
```

- [ ] **Step 3: Verify it compiles** — `npm run typecheck` → modal file clean (panel errors remain until Task 7).

- [ ] **Step 4: Commit** — `git add src/ui/preset-manager-modal.ts styles.css && git commit -m "feat(ui): add drill-in preset manager modal"`

---

### Task 7: Slim the panel (`src/ui/local-dictation-view.ts`) and delete the save modal

**Files:**
- Modify: `src/ui/local-dictation-view.ts`
- Delete: `src/ui/save-style-modal.ts`

- [ ] **Step 1: Delete machinery** in `local-dictation-view.ts`:
- `renderPromptEditor`, `addTextAreaSetting`, `schedulePromptSave`, `flushPendingPromptSave`, `savePrompt`, `trackPromptBlurRender`, fields `promptSaveTimerId`/`pendingPromptValue`, `PROMPT_SAVE_DEBOUNCE_MS`, `CUSTOM_STYLE_VALUE`.
- `openSaveStyleModal`, `saveCurrentAsUserStyle`, `confirmDeleteUserStyle`, `deleteUserStyle`, `applyStyleByRef` (replaced below), the `SaveStyleModal` import.
- In `onClose`, drop the `flushPendingPromptSave()` call.
- Rename `promptBlurRenderPending` → `deferredRenderPending` and `renderAfterPromptBlurWhenIdle` → `renderWhenIdle` (the deferral still serves number inputs and routing controls); keep `trackInputFocus` and `scheduleRender` semantics otherwise.
- Delete `src/ui/save-style-modal.ts`.

- [ ] **Step 2: New preset row** (replaces `renderStylePicker`):

```ts
private renderPresetPicker(parent: HTMLElement, settings: PluginSettings): void {
  const entries = listPresetEntries(settings.llmPostprocessUserPresets);
  const active = resolveActivePresetEntry(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );

  const setting = new Setting(parent)
    .setName('Preset')
    .setDesc(active.preset.description ?? describePresetBehavior(active.preset))
    .addDropdown((dropdown) => {
      for (const entry of entries) {
        dropdown.addOption(entry.ref, formatPresetOptionLabel(entry.preset));
      }
      dropdown.setValue(active.ref);
      dropdown.onChange(async (value) => {
        await this.saveField('llmPostprocessActivePresetRef', value);
      });
    });
  appendInfoTooltip(setting, STYLE_PICKER_TOOLTIP);

  setting.addExtraButton((button) => {
    button.setIcon('sliders-horizontal');
    button.setTooltip('Manage presets');
    button.onClick(() => {
      new PresetManagerModal(this.app, {
        getSettings: () => this.dependencies.getSettings(),
        saveSettings: async (next) => {
          await this.persistSettings(next);
        },
      }).open();
    });
  });
}
```

with helpers at the bottom of the file (replacing `describeMode`/`formatStyleOptionLabel`/`activePresetOverride`):

```ts
function formatPresetOptionLabel(preset: LlmPreset): string {
  if (preset.timing === 'per_utterance') {
    return `${preset.label} (after each phrase)`;
  }
  if (preset.timing === 'batch') {
    return `${preset.label} (on stop)`;
  }
  return preset.label;
}

function activePresetOverride(
  settings: PluginSettings,
  field: keyof LlmPresetOverrides,
): { label: string; value: number | boolean } | null {
  const { preset } = resolveActivePresetEntry(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );
  const value = preset.overrides?.[field];
  if (value === undefined) {
    return null;
  }
  return { label: preset.label, value };
}
```

New tooltip copy:

```ts
const STYLE_PICKER_TOOLTIP =
  'A preset bundles a transform prompt with optional timing, output behavior, and setting overrides. Use Manage presets to view a prompt or create, edit, duplicate, and delete presets.';
```

- [ ] **Step 3: Always-visible Mode row** (replaces `renderCleanupMode`):

```ts
private renderCleanupMode(parent: HTMLElement, settings: PluginSettings): void {
  if (settings.llmPostprocessMode === 'off') {
    return;
  }
  const { preset } = resolveActivePresetEntry(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );
  const pinned = preset.timing;

  new Setting(parent)
    .setName('Mode')
    .setDesc(
      pinned !== undefined
        ? `Set by ${preset.label} — ${describePresetTiming(pinned).toLowerCase()}.`
        : 'Run after each phrase, or all at once when you stop.',
    )
    .addDropdown((dropdown) => {
      for (const option of CLEANUP_MODE_OPTIONS) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(pinned ?? settings.llmPostprocessMode);
      dropdown.setDisabled(pinned !== undefined);
      dropdown.onChange(async (value) => {
        if (!isLlmPresetTiming(value)) {
          return;
        }
        this.lastEnabledMode = value;
        await this.saveField('llmPostprocessMode', value);
      });
    });
}
```

`resolveModeOnEnable` simplifies to `return this.lastEnabledMode;` (effective forcing happens in the snapshot; the stored mode stays the user's choice). In `refresh()`, only track `lastEnabledMode` when no pin is active is unnecessary — keep the existing assignment.

- [ ] **Step 4: Override annotations** — min words (`renderLimitsSection`) and temperature (`renderGenerationSection`) keep the disabled+desc pattern but the copy becomes `Set by preset "${override.label}". Edit the preset to change.`; `renderUseNoteContextToggle` gains the same treatment:

```ts
private renderUseNoteContextToggle(parent: HTMLElement, settings: PluginSettings): void {
  const override = activePresetOverride(settings, 'useNoteContext');
  const setting = new Setting(parent)
    .setName('Use note as LLM context')
    .setDesc(
      override !== null
        ? `Set by preset "${override.label}". Edit the preset to change.`
        : 'Include the open note above the cursor in the LLM prompt.',
    )
    .addToggle((toggle) => {
      toggle.setValue(override !== null ? override.value === true : settings.useLlmNoteContext);
      toggle.setDisabled(override !== null);
      toggle.onChange(async (value) => {
        await this.saveField('useLlmNoteContext', value);
      });
    });
  appendInfoTooltip(setting, 'Experimental: results vary with note length and model.');
}
```

`renderNoteContextChars` gates on the effective value: `const effectiveNoteContext = activePresetOverride(settings, 'useNoteContext')?.value === true || (activePresetOverride(settings, 'useNoteContext') === null && settings.useLlmNoteContext);` — extract a tiny local helper to avoid the double call.

- [ ] **Step 5: Reset copy** — both the setting desc and `ConfirmModal` message become: `Restore the default preset, mode, context, skip gates, and generation values? Your saved presets and selected provider model are kept.` (statement form without `?` for the setting desc).

- [ ] **Step 6: Imports** — final import list from `../llm/presets`: `describePresetBehavior`, `describePresetTiming`, `isLlmPresetTiming`, `listPresetEntries`, `resolveActivePresetEntry`, `type LlmPreset`, `type LlmPresetOverrides`, `type LlmPresetTiming` (for `lastEnabledMode`/`CLEANUP_MODE_OPTIONS` typing — replace old `LlmPresetMode` references). Add `import { PresetManagerModal } from './preset-manager-modal';`. Drop `randomUUID` if now unused.

- [ ] **Step 7: Verify** — `npm run typecheck && npx vitest run` → PASS; `npm run lint && npm run lint:obsidian` → clean.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(ui): slim LLM panel to preset picker plus manager modal"`

---

### Task 8: Sweep, docs, full gate

**Files:**
- Modify: `docs/system-architecture.md` (preset mentions, if stale)
- Verify: whole repo

- [ ] **Step 1: Dead-reference grep** — `rg -n "findMatchingStyleRef|SaveStyleModal|llmPostprocessPrompt|voice-commands|LlmUserPreset|LlmStyleOption|listStyleOptions|resolveStyleOption|isLlmPresetMode" src test docs styles.css` → only spec/plan/release-notes hits remain (release notes are historical — leave them).

- [ ] **Step 2: Update `docs/system-architecture.md`** if it describes the prompt setting or preset behavior — align wording with the ref-only model (search for "preset" and "prompt").

- [ ] **Step 3: Full gate** — `npm run check:frontend` (typecheck + biome + eslint + vitest + build) → PASS.

- [ ] **Step 4: Manual smoke (dev vault)** — `npm run install:dev`, then in Obsidian: pick TLDR → Mode row locks to "Once on stop"; dictate, stop → summary inserted above untouched transcript; create/edit/duplicate/delete presets in the manager; delete the active preset → falls back to Clean up with notice; Reset LLM defaults keeps user presets. (CPU sidecar is the expected path on this machine.)

- [ ] **Step 5: Commit + PR** — commit any doc tweaks; open PR to `main` titled `feat: preset manager with additive output and per-preset overrides`.

---

## Self-review notes

- Spec coverage: data model + migration → Tasks 1–2; insert/runtime → Tasks 3–4; manager modal → Tasks 5–6; panel/Mode/annotations/reset copy → Task 7; lineup → Task 1; out-of-scope items untouched. ✓
- The snapshot's `llmPostprocessMode` now carries the *effective* mode, so `shouldRunBatchCleanup`/`shouldRunProviderPerUtteranceCleanup` need no changes. ✓
- `llmPostprocessActivePresetRef` tightens `string | null` → `string`; Tasks 2/6/7 update every consumer; the controller passes it straight to `resolveActivePresetEntry` which accepts the tightened type. ✓
- Type names consistent across tasks: `LlmPreset`, `LlmPresetEntry`, `LlmPresetTiming`, `LlmPresetOutput`, `LlmPresetOverrides`, `listPresetEntries`, `resolvePresetEntry`, `resolveActivePresetEntry`, `resolveEffectiveLlmGlobals`, `describePresetBehavior`, `describePresetTiming`, `validatePresetDraft`, `draftFromPreset`, `emptyPresetDraft`, `insertAdjacentToSessionRange`, `PresetManagerModal`. ✓
