# Obsidian settings compatibility and UX

Status: Accepted for implementation

## Summary

Speech Kit supports Obsidian 1.11.5 and newer. Obsidian 1.13 redesigned Settings,
made a separate settings window the default, and introduced an opt-in declarative
settings API. Speech Kit briefly used that API as a host for its full imperative
page. Obsidian 1.13.4 reconciled the framework-owned row after the custom render,
leaving users with a title and no controls. PR #350 restored the imperative page
by returning no declarative definitions.

This project keeps that compatibility posture and addresses the adjacent risks
found during the follow-up audit:

1. The declared 1.11.5 floor is not enforced against production API usage.
2. Some settings code uses globals from the main window even when Settings is in
   another window.
3. Async refreshes can rebuild a settings tab after it has been hidden.
4. Whole-page refreshes can discard keyboard focus.
5. The read-aloud speed slider gives weaker feedback on pre-1.13 versions.
6. Preset rows combine a cross-window-unsafe click check with incomplete keyboard
   semantics.

The goal is one settings implementation that remains correct from Obsidian 1.11.5
through the current release, with explicit evidence preventing future API drift.

## Product decisions

### Keep the imperative settings page

`LocalSttSettingTab.getSettingDefinitions()` must continue returning an empty
array. `display()` remains the single settings renderer on every supported
version.

This intentionally gives up per-control global settings search for now. A
declarative migration below Obsidian 1.13 would require two renderers, and
Obsidian's migration guide warns that they can drift. Speech Kit's settings also
depend on device enumeration, model/install subscriptions, sidecar state, custom
modals, and effects that are not a small declarative conversion.

### Keep the 1.11.5 minimum

Nothing in this project raises `minAppVersion`. Existing 1.11 and 1.12 users must
continue receiving current releases.

### Do not migrate to `SettingGroup.listEl` yet

The public `SettingGroup` class exists at the support floor, but the published
`obsidian@1.11.4` declarations closest to that floor do not expose `listEl`.
Replacing the current helper with `listEl` is not accepted without exact 1.11.5
runtime evidence. A future refactor may use the older `addSetting()` surface or
proceed after the minimum version changes.

### Do not add version-string branches

Compatibility must come from stable browser/Obsidian APIs, structural feature
checks, or the existing `requireApiVersion` helper. Code must not compare version
strings manually.

## Requirements

### R1. Enforce the supported API floor

Add an independently installed alias of the closest published Obsidian API
package at or below the app floor, currently `obsidian@1.11.4`.

Add a production-only TypeScript configuration that resolves `obsidian` to that
package and excludes tests. The floor check may augment only the intentional
adapter surface:

- `Plugin.settings`, which Speech Kit owns on older hosts;
- `PluginSettingTab.getSettingDefinitions()`, which older hosts ignore.

The source method must return `never[]` so the empty result is explicit and is a
valid override for both the floor shim and current definitions. No runtime export
introduced after the floor may be allowlisted.

The floor typecheck must run inside `check:frontend` and CI.

### R2. Prove both settings lifecycle paths

Tests must cover:

- a non-empty declarative definition suppressing the imperative page in the
  Obsidian 1.13 reconciliation model;
- Speech Kit returning no definitions and rendering `display()`;
- a legacy host with no `update()` method refreshing through `display()`;
- a current host refreshing through `update()`;
- a hidden settings tab ignoring late refresh requests.

The tests may use a narrow harness around the lifecycle logic instead of
constructing the complete production settings dependency graph.

### R3. Use the rendered window for settings behavior

The microphone picker must capture `parent.win` once and use it for:

- `navigator.mediaDevices`;
- permission requests and device enumeration;
- device-change subscription and cleanup;
- debounce timers and cleanup.

Hotkey settings search must construct its `input` event from the search input's
own window. A missing owner window remains a handled failure, not a crash.

Tests must use distinct fake main and owner windows so falling back to a global
cannot pass accidentally.

### R4. Do not refresh hidden pages

`LocalSttSettingTab` must track whether it is displayed. `display()` marks the tab
visible before rendering. `hide()` marks it hidden before tearing down owned
subscriptions.

`refreshSettingsTab()` must return without rendering when hidden. The next
`display()` reads current persisted settings.

Modal-backed settings must not refresh the entire parent page after every saved
field when the parent shows no value derived from those fields. Persistence stays
immediate; the unnecessary `onSave` refresh wiring is removed.

### R5. Preserve focus across required refreshes

Before a visible full-page refresh, capture the focused control when it belongs
to a `.setting-item` inside the Speech Kit container:

- the trimmed `.setting-item-name` text;
- the focused control's index among the row's focusable controls.

After synchronous `update()` or legacy `display()`, find the row with the same
name and focus the corresponding control. The algorithm must not use global DOM
constructors, so it remains safe across windows.

If the row no longer exists, the name is blank, or the control index is invalid,
restoration is skipped without throwing.

### R6. Improve supported-version accessibility

Enable `SliderComponent.setDynamicTooltip()` for read-aloud speed. This restores
visible value feedback on Obsidian 1.11 and 1.12 while remaining valid on newer
versions.

Preset rows must not attach a click listener to the whole setting row and then
filter action-button clicks with `instanceof HTMLElement`. Instead, make the
setting information area the explicit open target:

- mouse click opens the preset;
- `Enter` and `Space` open it;
- it has a focus target and button semantics;
- edit, duplicate, and delete controls remain independent.

### R7. Document runtime verification

Add a repeatable manual settings smoke matrix covering:

| Version | Purpose |
| --- | --- |
| Obsidian 1.11.5 | Exact declared minimum |
| Obsidian 1.12.7 | Final pre-1.13 baseline |
| Current Obsidian release | Current settings behavior |

The current release must be tested with "Open settings in new window" both on
and off. The checklist covers initial render, representative persistence,
modal-backed settings, microphone detection, hotkey navigation, dynamic refresh,
focus, reload, and closing Settings during an in-flight save.

The release guide must link to this matrix. Manual results remain release
evidence, not something CI pretends to prove.

## Design

### Floor typecheck

Add:

- `obsidian-floor` as an npm alias for `obsidian@1.11.4`;
- `tsconfig.obsidian-floor.json`;
- `compat/obsidian-floor.d.ts`, included only by the floor configuration;
- `typecheck:obsidian-floor` in `package.json` and `check:frontend`.

The normal typecheck continues using the latest published Obsidian definitions.
The floor configuration uses the same strict compiler options and production
source, changing only module resolution and its narrow compatibility augmentation.

### Lifecycle seam

Extract the refresh decision into a small settings lifecycle module if doing so
allows direct tests without exposing production internals. The module owns:

- visible/hidden state;
- current-versus-legacy refresh selection;
- focus capture and restoration.

It must not own business settings, persistence, or Obsidian version policy.

### Focus identity

Use the user-visible setting name plus focusable-control index instead of DOM
paths. Structural refreshes can add or remove neighboring rows, while the
identity of the initiating setting remains stable in the active locale.

Duplicate names are not expected in the current page. If duplicates are added
later, callers should introduce an explicit stable key instead of expanding this
project into a general virtual-DOM identity system.

### Window ownership

Use `HTMLElement.win`, which Obsidian documents for pop-out support and which is
available below the current minimum. Event construction uses the input element's
owner window for the same reason.

## Validation

Automated gates:

1. Targeted tests for the new lifecycle, focus, window ownership, hotkey event,
   slider, and preset-row behavior.
2. `npm run typecheck`.
3. `npm run typecheck:obsidian-floor`.
4. `npm run lint`.
5. `npm run lint:obsidian`.
6. `npm test`.
7. `npm run build:frontend`.

Manual gates before release:

1. Complete the documented three-version matrix.
2. On the current release, repeat the matrix with both settings-window modes.
3. Confirm global search finds the Speech Kit tab name but does not promise
   per-control results while the imperative renderer is retained.

## Simplification pass

After implementation:

1. Remove duplicated window and lifecycle branching.
2. Delete parent-refresh callbacks that no longer affect visible summaries.
3. Keep the compatibility augmentation limited to the two intentional members.
4. Reject general abstractions that have only one caller.
5. Ensure comments explain compatibility invariants rather than restating code.

## Review gates

The final review must independently check:

- repository standards and code smells;
- every requirement in this specification;
- behavior at both the declared floor and current API surface;
- cross-window correctness without global-constructor assumptions;
- cleanup, hidden-tab behavior, and keyboard focus;
- absence of declarative-renderer or minimum-version scope creep.

Any actionable finding must be fixed and the relevant validation rerun before the
pull request is marked ready.

## Out of scope

- Raising `minAppVersion`.
- Full or partial declarative settings definitions.
- Per-control global settings search.
- A drop-in `SettingGroup.listEl` migration.
- Automated GUI control of old Obsidian binaries in CI.
- Redesigning Speech Kit's information architecture or visual language.
