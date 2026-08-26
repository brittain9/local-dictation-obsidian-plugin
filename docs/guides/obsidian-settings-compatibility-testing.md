# Obsidian settings compatibility testing

Use this smoke matrix before releasing a settings change. Static checks prevent
production code from drifting above the supported API floor, but they do not
prove how a specific Obsidian binary renders the page.

## Versions

| Obsidian | Why it is required | Settings window modes |
| --- | --- | --- |
| 1.11.5 | Exact `minAppVersion` | Main window, plus separate window if the toggle is available |
| 1.12.7 | Final pre-1.13 baseline | Main window, plus separate window if the toggle is available |
| 1.13.4 | Current 1.13 settings renderer that exposed the empty-page regression | Main window and separate window |

If a newer desktop release is live, add it without removing 1.13.4 until the
compatibility fix has shipped. Confirm the current target in Obsidian's
[official desktop release feed](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json).

## Prepare one build

Build once, then use the exact same `main.js`, `manifest.json`, and `styles.css`
for every matrix row. Do not compare different plugin commits.

```bash
npm ci
npm run check:frontend
npm run install:dev -- --vault /Users/alex/Documents/test-vault --sidecars --enable
```

Record the tested commit and artifact hashes. Fully quit Obsidian before
switching app versions or settings-window modes. Keep a backup of the test vault
and do not open a production vault with a downgraded Obsidian binary.

## Smoke procedure

Repeat these checks for every applicable version and window mode:

1. Open **Settings → Speech Kit**. Confirm the full page appears immediately,
   including Model, Capture, Transcript output, Read aloud, Translation, LLM
   transformation, and Advanced sections. A page containing only the Speech Kit
   title is a failure.
2. Change **Listening mode**, close Settings, reopen it, and confirm the choice
   persisted. Restore the original value.
3. Open Smart paragraphs, Speaker labels, and Timestamp options. Change one
   field in each, close the modal, and confirm the parent settings page remains
   populated and usable. Restore the original values.
4. Use **Detect microphones**. Confirm the permission flow and device dropdown
   belong to the visible Settings window and that closing Settings stops later
   device-change updates.
5. Use the Read aloud shortcut button. Confirm Obsidian opens Hotkeys, filters
   to the Speech Kit command, and does not report the fallback warning.
6. Move **Speed** with the keyboard and pointer. Confirm the current numeric
   value is visible while adjusting and persists after reopening Settings.
7. Focus a control that causes a necessary page refresh, such as **Enable LLM
   features** or **Developer mode**. Confirm focus returns to the same control
   after the dependent rows update.
8. Start an async settings action, close Settings before it finishes, and
   confirm the page does not reopen or recreate device/model subscriptions.
   Reopen Settings and confirm the persisted result appears then.
9. Open **Manage presets**. Confirm clicking a preset's information area and
   pressing Enter or Space opens it. Confirm edit, duplicate, and delete buttons
   perform only their own action.
10. Reload Obsidian and reopen Speech Kit settings. Confirm the page is still
    complete and the representative saved values remain correct.

On Obsidian 1.13.4 and newer, also search Settings for `Speech Kit`. The plugin
tab name should be discoverable. Per-control global search is intentionally not
promised while Speech Kit retains one imperative renderer across all supported
versions.

## Evidence record

Copy this table into the release PR or release issue. A blank or assumed result
does not count as runtime evidence.

| Obsidian | Window mode | Platform | Result | Notes/evidence |
| --- | --- | --- | --- | --- |
| 1.11.5 | Main |  | Not run |  |
| 1.11.5 | Separate or N/A |  | Not run |  |
| 1.12.7 | Main |  | Not run |  |
| 1.12.7 | Separate or N/A |  | Not run |  |
| 1.13.4 | Main |  | Not run |  |
| 1.13.4 | Separate |  | Not run |  |

The 1.11.5 row is a release gate. The floor typecheck is valuable regression
evidence, but it is not a substitute for that exact runtime smoke test.
