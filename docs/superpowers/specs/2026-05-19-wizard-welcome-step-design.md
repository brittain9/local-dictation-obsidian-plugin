# Setup wizard — welcome-flavored Step 1

**Status:** Draft
**Date:** 2026-05-19

## Context

Today, the first-run setup wizard (`src/setup/setup-wizard-modal.ts`) opens directly into a utilitarian "Install the speech engine" screen. It works, but it feels like a chore rather than an introduction. Popular community plugins (Excalidraw, etc.) use the first modal to greet the user and frame what they're about to do.

We want a warmer first impression that doubles as a brief product pitch and a setup preview, without adding a fourth wizard step or any new clicks.

## Decision summary

- **No new step.** Keep the wizard at 3 steps / 3 progress dots. Welcome content is folded into Step 1's not-yet-installed branch.
- **Pitch-style copy.** Lead with what the user can *do* ("dictate notes hands-free"), then privacy, then the 2-step setup preview, then a one-liner about how they'll use it after setup.
- **Platform-conditional GPU note.** macOS gets no GPU mention (Metal is automatic). Windows/Linux get a single muted footnote line about the optional CUDA build.
- **Resume path unchanged.** If the wizard reopens with the sidecar already installed, Step 1 still renders the existing "Speech engine ready" copy and Next button. The welcome framing is for first impressions only.

## Scope

Single file: `src/setup/setup-wizard-modal.ts`, only the `!this.sidecarReady` branch of `renderSidecarStep()` (lines ~125–137 in the current file). No CSS changes; the existing `.local-stt-wizard-step__muted` class is reused for the footnote.

Out of scope: any change to Step 2 (model picker), Step 3 (ready), the progress dots, the sidecar install modal, settings, or copy when the sidecar is already installed.

## Content

### Step title
`Welcome to Local Dictation` (replaces `Install the speech engine`)

### Body — all platforms
```
Dictate notes hands-free, right inside Obsidian — fully on your machine. No account, no cloud, no telemetry.

A quick 2-minute setup:
  1. Download the speech engine
  2. Pick a transcription model

Then hit the mic in the ribbon (or your own hotkey) and start talking.
```

Rendered as: one intro paragraph, an `<ol>` for the two steps, then one closing paragraph.

### Muted footnote — Windows / Linux only
```
Starts with the CPU build. NVIDIA GPU? You can install the CUDA-accelerated build later from Settings.
```

Rendered as a `<p>` with class `local-stt-wizard-step__muted` (same class the current footnote uses). Omitted entirely on macOS.

### Buttons
Unchanged: `Cancel` (closes modal), `Download engine` (opens the existing `SidecarInstallModal` via `openSidecarInstall()`). No button copy or behavior changes.

## What gets dropped

The existing not-yet-installed branch's two paragraphs are replaced wholesale:
- The macOS-specific "needs a one-time download… audio never leaves your Mac" sentence — superseded by the pitch's "fully on your machine. No account, no cloud, no telemetry."
- The cross-platform fallback variant of the same sentence — same.
- The current muted footnote ("Includes Metal acceleration…" / "CPU build first. You can install CUDA…") — Metal note drops entirely on macOS; CUDA note rephrased into the new Windows/Linux footnote above.

## Verification

1. `npm run build` succeeds.
2. `npm run install:dev` into `C:\Users\alex\Documents\stt-test-vault`; in Obsidian, disable & re-enable the plugin (or clear setup state) to trigger the first-run wizard.
3. On Windows, confirm Step 1 shows the new welcome title, pitch body, 2-step list, closing line, and the CUDA footnote in muted styling. Cancel and Download engine buttons still work.
4. Close the wizard after the sidecar is installed, reopen it (settings → re-run setup): Step 1 should show the unchanged "Speech engine ready" copy with a Next button.
5. Manual review on macOS (if available) or via code inspection: confirm `Platform.isMacOS` branch suppresses the CUDA footnote.
6. Step 2 and Step 3 visually unchanged.

## Files

- `src/setup/setup-wizard-modal.ts` — only file modified.
