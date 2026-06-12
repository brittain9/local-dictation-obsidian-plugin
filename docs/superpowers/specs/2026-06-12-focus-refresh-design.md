# Focus Refresh Design

## Goal

Make externally edited Local Dictation presets and locally changed Ollama models appear while Obsidian remains running, without polling, file watchers, broad settings reloads, or noticeable UI latency.

## Current Behavior And Root Cause

The plugin reads `data.json` once during `onload()` and keeps the resolved settings in memory. UI saves persist the complete in-memory settings object.

Consequences:

- Presets added directly to `data.json` are invisible until the plugin reloads.
- A later UI save can overwrite an externally added preset because the save starts from stale in-memory settings.
- The focus handler retries Ollama only after an unhealthy load. If Ollama is healthy and a model is added or removed externally, its cached model list remains stale.

## Design Principles

- Keep disk-settings ownership in the plugin class.
- Keep provider discovery ownership in `LlmRoutingControls`.
- Refresh only state known to change outside the running plugin.
- Reuse existing settings normalization and provider-loading behavior.
- Do not create a general settings synchronization framework for a preset-specific need.
- Do not poll or install a filesystem watcher.

## Preset Synchronization

Define a small `LlmPresetState` value containing:

- `activePresetRef`
- `userPresets`

Add a plugin-level asynchronous operation that reads persisted settings and synchronizes only:

- `llmPostprocessUserPresets`
- `llmPostprocessActivePresetRef`

The operation must:

1. Call Obsidian's `loadData()`.
2. Normalize the stored data with `resolvePluginSettings()`.
3. Compare the normalized preset fields with current in-memory values.
4. Replace only those fields when they differ.
5. Request a deferred-safe refresh of open Local Dictation sidebars only after a change.
6. Leave every unrelated in-memory setting untouched.
7. Log malformed or failed reads and preserve current state.

External preset edits are authoritative. Additions, modifications, renames, deletions, and active-preset changes are applied after normalization. If an external deletion invalidates the active preset reference, existing resolution behavior falls back to Clean up.

The comparison should use a focused preset-state equality helper instead of serializing the complete settings object.

## Concurrency And Persistence

Maintain one in-flight preset-sync promise in the plugin:

- simultaneous callers share the same promise
- the promise is cleared after success or failure
- no second disk read starts while one is active

Preset state must have a dedicated plugin-level mutation operation. It waits for any active synchronization, applies a callback to the latest in-memory `LlmPresetState`, normalizes the result, and persists it with the current non-preset settings.

All ordinary settings saves preserve the plugin's current preset state, regardless of preset fields present in a caller's whole settings object. This makes the ownership rule explicit: only the dedicated preset mutation operation can change presets.

Use the dedicated mutation operation for:

- selecting the active preset
- creating, editing, duplicating, or deleting a preset
- resetting the active preset through Reset LLM defaults

The preset manager must synchronize before validating or saving so validation uses the latest labels and preset count. Internal synchronization and mutation calls share the same serialized operation chain. This prevents a click immediately after window focus from saving stale presets over a fresh external edit.

Existing non-preset settings do not trigger a disk read and remain on the ordinary persistence path.

## Focus Behavior

When the Local Dictation sidebar's window regains focus:

1. Start preset synchronization.
2. Force-refresh active local provider model discovery.
3. Retry an active remote provider only when its prior state is unhealthy or unloaded.

Focus refreshes must be:

- background and silent
- deduplicated while in flight
- protected by a one-second monotonic cooldown so a burst of focus events does not repeat work

The cooldown applies to the combined focus-refresh trigger, not normal explicit refresh buttons.

Preset synchronization must request the sidebar's existing focus-safe render scheduling rather than forcing an immediate rebuild. If a sidebar text input is focused, rendering waits until that input blurs so model names, API keys, thresholds, and number fields are not interrupted.

## Preset Manager Behavior

Clicking **Manage presets** must await preset synchronization before opening the modal. This is a deliberate fallback when no focus event occurred or the external edit happened while Obsidian remained focused. The button may show its normal pressed state during the short read; no loading UI is required.

The existing preset dropdown does not need an interaction-specific disk read because the focus path updates it and the manager path provides explicit recovery. Adding reads to native dropdown click handling would complicate rendering and event ordering for little benefit.

## Provider Refresh Behavior

Refine `LlmRoutingControls` so callers can distinguish:

- normal refresh: retry only unloaded or unhealthy providers
- focus refresh: force the active Ollama model list to reload, while retaining retry-only behavior for OpenRouter

The existing in-flight guard remains authoritative. The explicit refresh button continues to bypass the focus cooldown and perform a normal user-requested model refresh.

No focus-triggered refresh is added for:

- OpenRouter's successfully loaded remote catalog
- managed speech-model catalog or installed-model inventory
- sidecar health, capabilities, or process state
- general plugin settings

Those operations have different ownership, potentially higher cost, and no demonstrated stale-state problem in this workflow.

## Failure Handling

- Preset read failure: log a warning, preserve current settings, keep the current UI.
- Invalid persisted values: rely on `resolvePluginSettings()` normalization; valid presets survive and invalid entries are discarded according to existing rules.
- Preset mutation after a failed synchronization: continue from current in-memory preset state so the UI remains usable.
- Ollama refresh failure: preserve existing silent background behavior and show the derived unavailable state on rerender.
- Modal pre-open refresh failure: still open the manager using current in-memory settings.

## Performance

Each accepted focus refresh performs:

- one small local `data.json` read
- one localhost Ollama model-list request when local routing is active
- an OpenRouter retry only when its state is unloaded or unhealthy

There is no polling, file watcher, sidecar restart, transcription work, or model inference. In-flight deduplication and the cooldown bound repeated work.

## Testing

Add focused tests for:

1. preset synchronization imports external additions without changing unrelated settings
2. external edits and deletions replace current preset state
3. unchanged preset state does not refresh sidebars
4. concurrent preset-sync calls share one disk read
5. failed reads preserve current settings
6. ordinary settings saves preserve current preset state
7. dedicated preset mutations wait for active synchronization and use the latest state
8. Manage presets waits for synchronization before opening
9. focus refresh forces a second Ollama model-list request after a successful first load
10. focus refresh does not refetch a healthy OpenRouter catalog
11. focus cooldown and provider in-flight guards suppress duplicate work
12. a preset-triggered sidebar refresh defers while an input remains focused

Run TypeScript type checking, linting, frontend tests, and the frontend production build.
