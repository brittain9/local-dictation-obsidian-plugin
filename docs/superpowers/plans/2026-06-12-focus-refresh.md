# Focus Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize externally edited presets and locally changed Ollama models when Obsidian regains focus, without broad settings reloads, polling, or stale preset overwrites.

**Architecture:** Add a focused preset-state store that owns normalization, equality, serialized disk synchronization, and preset mutations. The plugin remains the owner of persisted settings and exposes narrow preset operations to the sidebar and preset manager. A small focus-refresh coordinator handles the one-second cooldown and in-flight deduplication, while `LlmRoutingControls` keeps provider-specific refresh policy.

**Tech Stack:** TypeScript 6, Obsidian plugin API, Vitest 4, Biome, ESLint, esbuild

---

### Task 1: Preset State Store

**Files:**
- Create: `src/settings/llm-preset-state.ts`
- Create: `test/llm-preset-state.test.ts`
- Reference: `src/settings/plugin-settings.ts`

- [ ] **Step 1: Write failing tests for focused preset-state helpers**

Test this public API:

```ts
export interface LlmPresetState {
  activePresetRef: string;
  userPresets: LlmPreset[];
}

export function readLlmPresetState(settings: PluginSettings): LlmPresetState;
export function withLlmPresetState(
  settings: PluginSettings,
  state: LlmPresetState,
): PluginSettings;
export function areLlmPresetStatesEqual(
  left: LlmPresetState,
  right: LlmPresetState,
): boolean;
```

Cover equal values, prompt/override changes, order changes, active-ref changes, and applying a preset state without changing unrelated settings.

- [ ] **Step 2: Run the helper tests and verify RED**

Run:

```powershell
npx vitest run test/llm-preset-state.test.ts
```

Expected: FAIL because `src/settings/llm-preset-state.ts` does not exist.

- [ ] **Step 3: Implement the focused preset-state helpers**

Use direct field comparison. Compare preset arrays in order and compare every persisted preset field:

```ts
id
label
description
prompt
timing
output
overrides.minWords
overrides.temperature
overrides.useNoteContext
```

Do not stringify complete plugin settings.

- [ ] **Step 4: Write failing tests for serialized synchronization and mutation**

Add `LlmPresetStateStore` with injected dependencies:

```ts
interface LlmPresetStateStoreDependencies {
  getSettings: () => PluginSettings;
  loadData: () => Promise<unknown>;
  commit: (settings: PluginSettings, options: { persist: boolean }) => Promise<void>;
  onExternalChange: () => void;
  warn: (message: string, error: unknown) => void;
}

export class LlmPresetStateStore {
  synchronize(): Promise<void>;
  mutate(
    mutation: (state: Readonly<LlmPresetState>) => LlmPresetState,
  ): Promise<void>;
  preserveCurrentState(nextSettings: PluginSettings): PluginSettings;
}
```

Tests must prove:

- external additions, edits, deletions, and active-ref changes are imported
- unrelated in-memory settings remain unchanged
- unchanged state does not commit or notify
- concurrent `synchronize()` calls share one `loadData()` call
- failed `loadData()` preserves state and logs a warning
- `mutate()` reloads first, then applies its callback to the latest state
- invalid external preset data is normalized by `resolvePluginSettings()`
- `preserveCurrentState()` prevents stale whole-settings objects from replacing presets

- [ ] **Step 5: Run the store tests and verify RED**

Run:

```powershell
npx vitest run test/llm-preset-state.test.ts
```

Expected: FAIL because `LlmPresetStateStore` is not implemented.

- [ ] **Step 6: Implement the minimal serialized store**

Requirements:

- one `syncInFlight` promise deduplicates simultaneous reads
- one private promise chain serializes synchronization and mutation
- synchronization commits with `persist: false`
- mutation synchronizes from disk, normalizes the callback result, then commits with `persist: true`
- failures are caught inside synchronization so UI callers remain usable
- the operation chain must recover after rejection

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run:

```powershell
npx vitest run test/llm-preset-state.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/settings/llm-preset-state.ts test/llm-preset-state.test.ts
git commit -m "feat(settings): add synchronized preset state store"
```

### Task 2: Plugin And Preset UI Integration

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/local-dictation-view.ts`
- Modify: `src/ui/preset-manager-modal.ts`
- Modify: `src/settings/plugin-settings.ts`
- Modify: `test/plugin-settings.test.ts`

- [ ] **Step 1: Write failing tests for reset semantics**

Change `resetLlmPostprocessDefaults()` so it resets non-preset LLM values but does not own `llmPostprocessActivePresetRef`. Add a test proving the active preset and user presets are preserved.

- [ ] **Step 2: Run the reset test and verify RED**

Run:

```powershell
npx vitest run test/plugin-settings.test.ts
```

Expected: FAIL because reset currently changes the active preset.

- [ ] **Step 3: Implement preset-slice ownership in the plugin**

Construct `LlmPresetStateStore` after initial `loadData()`. Its `commit` dependency must:

- update `this.settings`
- call `saveData()` only when `persist` is true
- request deferred-safe sidebar rendering after external change

Change ordinary `updateSettings(nextSettings)` to call:

```ts
this.presetStateStore.preserveCurrentState(nextSettings)
```

before normalization and persistence.

Expose narrow callbacks to `LocalDictationView`:

```ts
synchronizePresets: () => Promise<void>;
mutatePresetState: (
  mutation: (state: Readonly<LlmPresetState>) => LlmPresetState,
) => Promise<void>;
```

- [ ] **Step 4: Replace direct preset writes in the sidebar**

Use `mutatePresetState()` for:

- preset dropdown selection
- resetting the active preset to `builtin:clean-up`

Keep ordinary setting persistence for mode, context, limits, and temperature. Reset flow:

1. mutate active preset to Clean up
2. persist `resetLlmPostprocessDefaults()` for non-preset defaults

Add a public `requestRefresh()` method that delegates to the existing deferred `scheduleRender()` path.

- [ ] **Step 5: Replace preset-manager whole-settings saves**

Change modal dependencies to:

```ts
interface PresetManagerModalDependencies {
  getSettings: () => PluginSettings;
  mutatePresetState: (
    mutation: (state: Readonly<LlmPresetState>) => LlmPresetState,
  ) => Promise<void>;
  synchronizePresets: () => Promise<void>;
}
```

Create, edit, duplicate, and delete operations must mutate only `LlmPresetState`. Synchronize immediately before validation/save so duplicate labels and the 25-preset limit use current disk state.

Clicking **Manage presets** must:

```ts
await synchronizePresets();
new PresetManagerModal(...).open();
```

If synchronization fails internally, the modal still opens with current memory.

- [ ] **Step 6: Run focused settings and preset tests**

Run:

```powershell
npx vitest run test/plugin-settings.test.ts test/preset-draft.test.ts test/presets.test.ts test/llm-preset-state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/main.ts src/ui/local-dictation-view.ts src/ui/preset-manager-modal.ts src/settings/plugin-settings.ts test/plugin-settings.test.ts
git commit -m "feat(llm): synchronize external preset changes"
```

### Task 3: Focus Refresh Coordinator

**Files:**
- Create: `src/ui/focus-refresh-controller.ts`
- Create: `test/focus-refresh-controller.test.ts`
- Modify: `src/ui/local-dictation-view.ts`

- [ ] **Step 1: Write failing coordinator tests**

Define:

```ts
interface FocusRefreshControllerDependencies {
  now: () => number;
  refreshPresets: () => Promise<void>;
  refreshProviders: () => Promise<void>;
}

export class FocusRefreshController {
  request(): void;
}
```

Tests must prove:

- first request starts both refreshes
- requests during an in-flight refresh are ignored
- requests inside 1,000 ms after completion are ignored
- a request at or after 1,000 ms starts both again
- rejection from either dependency does not create an unhandled rejection and future requests still work

- [ ] **Step 2: Run the coordinator tests and verify RED**

Run:

```powershell
npx vitest run test/focus-refresh-controller.test.ts
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement the minimal coordinator**

Use:

```ts
const FOCUS_REFRESH_COOLDOWN_MS = 1_000;
```

Track `inFlight` and `lastStartedAt`. Start preset and provider refreshes together with `Promise.allSettled()`. Do not add timers or polling.

- [ ] **Step 4: Integrate the coordinator with sidebar focus**

Create one coordinator per `LocalDictationView`. The existing window `focus` handler calls `request()`. Keep initial provider warming in `onOpen()`.

Dispose requires no timer cleanup because the coordinator owns no timers.

- [ ] **Step 5: Run coordinator tests and verify GREEN**

Run:

```powershell
npx vitest run test/focus-refresh-controller.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/ui/focus-refresh-controller.ts test/focus-refresh-controller.test.ts src/ui/local-dictation-view.ts
git commit -m "feat(ui): coordinate external state refresh on focus"
```

### Task 4: Provider Refresh Policy

**Files:**
- Modify: `src/ui/llm-routing-controls.ts`
- Modify: `test/llm-routing-controls.test.ts`

- [ ] **Step 1: Write failing provider-policy tests**

Extend `refreshActiveProviders()`:

```ts
refreshActiveProviders(options?: { forceLocal?: boolean }): Promise<void>;
```

Tests must prove:

- normal refresh still does not refetch a healthy Ollama catalog
- `{ forceLocal: true }` refetches healthy Ollama
- `{ forceLocal: true }` does not refetch healthy OpenRouter
- failed providers retry
- concurrent refresh calls still produce one provider request per provider

- [ ] **Step 2: Run the routing tests and verify RED**

Run:

```powershell
npx vitest run test/llm-routing-controls.test.ts
```

Expected: FAIL because `refreshActiveProviders()` does not support forced local refresh and returns `void`.

- [ ] **Step 3: Implement provider-specific refresh policy**

Make `recheckModels()` and `refreshActiveProviders()` return promises. For active providers:

- Ollama + `forceLocal`: call `refreshModels('ollama', { silent: true })`
- Ollama normal: retry only unloaded/unhealthy
- OpenRouter: always retry only unloaded/unhealthy

Retain `modelsRefreshInFlight` as the provider-level deduplication guard.

- [ ] **Step 4: Run routing tests and verify GREEN**

Run:

```powershell
npx vitest run test/llm-routing-controls.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/ui/llm-routing-controls.ts test/llm-routing-controls.test.ts
git commit -m "feat(llm): refresh local model catalog on focus"
```

### Task 5: Full Verification And Review

**Files:**
- Modify only files required by findings from verification or code review.

- [ ] **Step 1: Run formatting and static checks**

Run:

```powershell
npm run typecheck
npm run lint
npm run lint:obsidian
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the full frontend test suite**

Run:

```powershell
npm test
```

Expected: all test files and tests pass.

- [ ] **Step 3: Build the production frontend**

Run:

```powershell
npm run build:frontend
```

Expected: production build exits 0.

- [ ] **Step 4: Review the complete diff**

Confirm:

- no general settings reload on focus
- no watcher or polling
- ordinary settings writes preserve current presets
- preset mutations synchronize first
- sidebar rerenders defer around focused inputs
- only Ollama is force-refreshed after healthy loads
- failures remain background and non-destructive

- [ ] **Step 5: Run final verification after review fixes**

Run:

```powershell
npm run check:frontend
```

Expected: typecheck, Biome, ESLint, all tests, and production frontend build pass.

- [ ] **Step 6: Commit verification fixes if any**

```powershell
git add <only-files-changed-by-review>
git commit -m "fix: address focus refresh review findings"
```
