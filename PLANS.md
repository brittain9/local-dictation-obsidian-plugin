# Unify download UX (closes #74 and #54)

## Context

Today, the sidecar install lives entirely inside `SidecarInstallModal`: the
modal owns the `AbortController`, and `onClose()` aborts the download — so an
accidental dismiss kills a multi-megabyte fetch. Progress only renders inside
the modal, so there is no persistent surface to monitor or cancel from.

Model installs already follow the right pattern: a long-lived plugin-owned
`ModelInstallManager` owns active install state, the manage-models modal and
the inline settings section both subscribe, and closing the modal does NOT
abort. The Rust sidecar runs the model download, so the lifecycle is naturally
decoupled from the UI.

This plan unifies sidecar install with the model pattern (closes #74) and
addresses the rest of #54: a prominent install card on the settings page when
sidecar is missing, and gating the rarely-used Sidecar path override behind
Developer mode.

The intended outcome:
- Closing the install modal never kills the download.
- Both download surfaces (model + sidecar) follow the same shape, so a future
  "thing to download" can copy the established pattern.
- A user who lands on the settings page without a sidecar sees one obvious
  CTA at the top.
- The Advanced section drops noise that the typical user can't act on.

CUDA library path was already Linux-gated; no change needed there.

## Branch

`feat/unify-download-ux` from `main`.

## File-by-file changes

### 1. NEW — `src/sidecar/sidecar-install-manager.ts`

Mirrors `ModelInstallManager` shape. Long-lived, plugin-owned.

```ts
type SidecarInstallPhase = 'installing' | 'canceling';

interface ActiveSidecarInstall {
  variant: SidecarInstallVariant;       // 'cpu' | 'cuda'
  intent: InstallIntent;                // 'first-run' | 'install' | 'reinstall'
  copy: InstallCopy;                    // for display + success notice
  progress: {
    phase: 'download' | 'verify' | 'extract';
    bytesDownloaded: number;
    totalBytes: number | null;
  };
  phase: SidecarInstallPhase;
  lastError: string | null;
}

interface SidecarInstallManagerState {
  activeInstall: ActiveSidecarInstall | null;
}
```

Public API: `subscribe(listener)`, `getState()`, `install(opts)`, `cancel()`,
`dispose()`.

`install(opts)`:
- Throws if `activeInstall !== null`.
- Sets initial active state, creates `AbortController`, notifies.
- Spawns `void this.runInstall(opts, controller.signal)` — fire-and-forget.
- Returns after kickoff (so the modal can transition to in-progress state).

`runInstall(opts, signal)`:
- Calls `installSidecar({ ...opts, signal, onProgress: (p) => updateProgress(p) })`.
- On success: invokes `opts.onInstalled()`, fires `notice(opts.copy.successNotice)`,
  clears `activeInstall`, notifies.
- On failure (non-abort): sets `lastError`, fires error notice, clears
  `activeInstall`, notifies.
- On abort: fires `notice('Sidecar install cancelled.')`, clears
  `activeInstall`, notifies.

`cancel()`:
- No-op unless `phase === 'installing'`.
- Sets `phase: 'canceling'`, notifies.
- Calls `controller.abort()` (synchronous; in-process). No `cancelStuck` state
  needed — the model manager needed it because cancel goes over IPC; the
  sidecar AbortController acts immediately.

`dispose()`: aborts in-flight install, clears listeners.

Constructor deps: `{ notice: (msg: string) => void; logger?: PluginLogger }`.

`install(opts)` parameter shape:
```ts
{ variant, intent, copy, version, pluginDirectory,
  beforeReplace?: () => Promise<void>, onInstalled: () => Promise<void> }
```

Per-install callbacks (not constructor-level) because CUDA install also persists
`accelerationPreference='auto'` via `onInstalled`, while CPU does not.

Helper (also in this file):
```ts
function buildSidecarProgressState(active: ActiveSidecarInstall): InstallProgressState
```
Maps sidecar `progress.phase` → a non-null `message` string ("Downloading",
"Verifying checksum…", "Extracting archive…") and supplies a plausible `state`
value (e.g. `'downloading'`). The progress renderer uses `message` first and
falls back to `state` only when `message` is null, so this works without
touching the existing renderer.

### 2. `src/setup/sidecar-install-modal.ts` — slim down + live progress mode

Remove: `abortController`, `installInProgress`, all of `progressLabelEl` /
`progressBarEl` / `statusEl`, `updateProgress`, `setProgressPercent`,
`setStatus`. Drop `installSidecar` import.

Constructor now takes `manager: SidecarInstallManager` instead of the install
plumbing. Still takes `variant`, `intent`, `copy`, `version`, `pluginDirectory`,
`beforeReplace`, `onInstalled` — these are forwarded to `manager.install(...)`.

`onOpen()`: subscribe to manager. Render the modal contents based on current
state. `onClose()`: unsubscribe. **Never abort.**

Render states (the modal re-renders content on subscription ticks; in-place
progress updates use `updateInstallProgressElement` for low-churn ticks):

| State | Body | Primary | Secondary |
|---|---|---|---|
| Pre-install (no active) | Body text + asset + version | `copy.primaryButtonText` → `manager.install(...)` | "Later" → close |
| In-progress | Inline `createInstallProgressElement` | "Downloading…" disabled | "Close" → close, no abort |
| Failed (lastError captured locally before activeInstall clears) | Error message | "Retry download" → kick off again | "Close" |

On terminal events: success → modal auto-closes (Notice fires from manager).
Cancellation → modal auto-closes (Notice fires from manager). Failure → modal
stays open with Retry. Catch the kickoff promise to show a Notice if
`manager.install()` itself rejects (e.g. concurrent install).

### 3. `src/setup/first-run-setup-modal.ts` — passthrough manager

Add `manager: SidecarInstallManager` to `FirstRunSetupOptions`. Pass it into
the `SidecarInstallModal` constructor.

### 4. NEW — `src/settings/install-progress-row.ts` — small shared helper

Two consumers (model + sidecar settings sections). Justified shared helper.

```ts
export interface ActiveInstallCardOptions {
  name: string;                       // e.g. "Installing: tiny.en"
  progressState: InstallProgressState;
  isCancelling: boolean;
  onCancel: () => void;
}

export function renderActiveInstallCard(
  container: HTMLElement,
  opts: ActiveInstallCardOptions,
): { progressEl: HTMLDivElement }
```

Builds a `Setting` row: `name` in name slot, `createInstallProgressElement` in
desc slot, single button "Cancel" / "Cancelling…" (disabled when cancelling)
calling `onCancel`. Returns `progressEl` so callers can update it in place
between renders.

### 5. `src/models/model-settings-section.ts` — use shared helper + add Cancel

Replace lines ~104-124 (the inline "Installing: X" Setting construction) with
`renderActiveInstallCard(container, { name: 'Installing: ' + displayName,
progressState, isCancelling, onCancel: () => void manager.cancel() })`. Store
the returned `progressEl` for the existing in-place fast-update path in
`handleStateChange`.

### 6. `src/settings/settings-tab.ts` — three changes

**a. Subscribe to sidecar manager + inline card.**
Add `sidecarInstallManager: SidecarInstallManager` to `SettingsTabDependencies`.
In `renderSidecarSection`, after the existing rows, if
`manager.getState().activeInstall !== null`, append an inline card via
`renderActiveInstallCard(...)`. Subscribe to manager state changes; track the
dispose function in a new `disposeSidecarSection` field, cleared in
`tearDown()`. Pass `manager` to `openInstallModal` / `openCudaInstallModal`.

**b. Banner install card at the top when sidecar missing (issue #54).**
At the very top of `display()`, before the Model section: detect whether the
sidecar is installed by reading both manifests
(`readInstallManifest(variantDirectoryPath(pluginDirectory, 'cpu'|'cuda'))`).
If both are null, render a `setting-group` with a single Setting row:
- name: "Sidecar required"
- desc: "Local Dictation needs the speech-to-text sidecar to work. Install it
  to enable dictation."
- primary button (CTA): "Install sidecar" → opens the CPU install modal (same
  path as the existing Sidecar section button).
The banner subscribes to the sidecar manager too, so when an install becomes
active, the banner can show inline progress (reusing
`renderActiveInstallCard`) and disappears on completion. Use the existing
`disposeSidecarSection` subscription so banner + sidecar section share
re-render triggers, or add a sibling subscription with separate dispose.

Implementation: extract a small helper
`renderMissingSidecarBanner(container, deps): () => void` co-located with the
settings tab (private method). It returns a disposer.

**c. Gate dev-only sidecar fields behind Developer mode (issue #54).**
In `renderSidecarSection`, wrap each of these in
`if (this.dependencies.getSettings().developerMode) { ... }`:
- `sidecarPathOverride` (text)
- `sidecarStartupTimeoutSeconds` (positive int)
- `sidecarRequestTimeoutSeconds` (positive int)

`cudaLibraryPath` stays as-is (Linux-only — useful for Flatpak end users).

In the Developer mode toggle's `addToggleSetting`, add a follow-up that calls
`this.display()` after persisting, so the gated fields appear/disappear
immediately when the toggle flips. Easiest path: inline the toggle (not via
`addToggleSetting`) in the Advanced section so the change handler can call
both `persistOne` and `this.display()`.

### 7. `src/main.ts` — instantiate, wire, dispose

After existing managers in `onload`:

```ts
this.sidecarInstallManager = new SidecarInstallManager({
  logger: this.logger,
  notice: (message) => { new Notice(message); },
});
```

Pass into:
- `LocalSttSettingTab` deps.
- `openFirstRunSetupModal` options (add `manager` field).

`onunload`: `this.sidecarInstallManager?.dispose()` (aborts any in-flight install).

## Edge cases handled

- **Modal closed mid-install**: download keeps running on the manager.
  Reopening the modal renders live progress immediately because the modal
  subscribes to current state.
- **Plugin unloaded mid-install**: `dispose()` aborts the AbortController.
  `installSidecar`'s catch block already cleans the staging dir.
- **Concurrent install**: `install()` throws; modal click handler shows Notice.
- **Cancel after completion**: `cancel()` checks `phase === 'installing'`;
  no-op otherwise.
- **CUDA `accelerationPreference` side effect**: still fires via the
  per-install `onInstalled` callback that the manager invokes on success.
- **Windows DLL handle on sidecar replace**: still fires via `beforeReplace`
  callback, invoked inside `installSidecar` before the rename.
- **Banner during install**: banner shows progress while installing; remains
  visible until the install completes and the manifest exists.
- **Developer mode toggle**: re-renders settings so the gated dev fields
  (path override + both timeouts) appear/disappear without requiring a
  settings-tab close/reopen.

## Critical files

- `src/sidecar/sidecar-install-manager.ts` (new)
- `src/setup/sidecar-install-modal.ts`
- `src/setup/first-run-setup-modal.ts`
- `src/settings/install-progress-row.ts` (new)
- `src/settings/settings-tab.ts`
- `src/models/model-settings-section.ts`
- `src/main.ts`

## Reused functions (no changes)

- `installSidecar` — `src/sidecar/sidecar-installer.ts`
- `createInstallProgressElement` / `updateInstallProgressElement` —
  `src/models/model-install-progress.ts`
- `getInstallCopy` — `src/setup/sidecar-install-copy.ts`
- `formatErrorMessage` — `src/shared/format-utils.ts`
- `readInstallManifest` / `variantDirectoryPath` —
  `src/sidecar/sidecar-installer.ts`
- `ModelInstallManager.cancel()` (consumed from new model card Cancel button)

## Verification

1. **Build & types**: `npm run typecheck` and `npm run build` — no errors.
2. **Lint** (if present in package.json) — clean.
3. **Manual UI test (desktop Obsidian, dev vault)**:
   - Delete `bin/cpu` and `bin/cuda` directories, restart plugin →
     first-run modal opens AND the settings page shows the banner. Click
     Download in modal. Confirm: progress bar appears in the modal AND in the
     banner / Sidecar section. Close modal. Confirm settings still updates and
     the download continues to completion. Success Notice fires. Sidecar
     restarts. Banner disappears.
   - Trigger CUDA install from settings (with NVIDIA driver present). Same flow.
     Confirm `accelerationPreference` flips to `'auto'` after success.
   - Trigger a CPU reinstall, then click Cancel from the settings card while
     in-progress. Confirm the download aborts (staging dir cleaned, no
     leftover archive in `bin/.cpu-staging/`), Notice
     "Sidecar install cancelled." fires.
   - Open Manage Models modal, start an install, close the manage-models modal,
     then click Cancel on the Settings → Model "Installing: X" card. Confirm
     the model install actually cancels.
   - Toggle Developer mode off → Sidecar path override, startup timeout, and
     request timeout all disappear. Toggle on → they reappear. Confirm
     `cudaLibraryPath` (Linux only) remains unaffected by this gating.
4. **Regression checks**:
   - Sidecar install/uninstall buttons in settings still behave when no install
     is active.
   - `isDictationBusy()` guard still prevents installs during active dictation.
   - When sidecar IS installed, the banner does NOT appear.
   - `developerMode = true` users still see the path override and timeouts;
     existing values in `data.json` continue to take effect regardless of UI
     visibility.

## Distillation after merge

Per AGENTS.md: this PLANS.md is temporary. After merge:
- Add a one-paragraph entry to `docs/decisions.md` if a load-bearing
  architectural shape was confirmed (e.g. "long-lived install manager owns
  download lifecycle; UI subscribes").
- Delete this file.
