# Product media

The README screenshots are captures of the real plugin in a disposable Obsidian vault. Their note text and audio are synthetic; they do not come from a maintainer's working vault.

## Brand assets

`hero.png` and `hero-dark.png` are the README banner (1200x520). The README selects between them with a `<picture>` element keyed on `prefers-color-scheme`, so the light asset is also the fallback wherever `<picture>` is unsupported.

The dark asset is derived from the light one rather than exported separately. Negating inverts lightness and hue together, so a 180 degree hue rotation restores the original hues, and lifting the black point keeps the background reading as a surface instead of a hole:

```sh
magick hero.png -negate -modulate 100,100,200 +level 8%,100% -strip hero-dark.png
pngquant --quality 80-98 --speed 1 --strip --force --output hero-dark.png -- hero-dark.png
```

Replace both assets together whenever the logo changes. If a designed dark export exists, prefer it over the derived one.

## Capture environment

- Obsidian 1.12.7 with an isolated Electron user-data directory.
- The published 2026.7.3 plugin bundle and Linux CPU sidecar, enabled as the only community plugin. The plugin was still named Local Dictation at that release.
- Locally installed catalog models, with Moonshine Medium selected for the live capture.
- A disposable vault containing only `Live dictation demo.md` and `Meeting notes.md`.
- Chromium DevTools Protocol `Page.captureScreenshot`, which captures the Obsidian app surface rather than the desktop.

The live-dictation image used a WAV generated from synthetic text with `espeak-ng`. Obsidian was launched with Chromium's `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, and `--use-file-for-fake-audio-capture` flags, so the real microphone and system audio were never opened. Moonshine Medium produced the visible provisional text through the normal plugin session path.

The meeting note is synthetic content rendered by Obsidian. It is designed to make system-audio source selection, timestamps, speaker labels, and post-meeting action items legible without presenting it as a benchmark transcript.

## Refresh checklist

1. Create a new disposable vault and isolated Obsidian profile. Do not reuse a personal vault or profile.
2. Install the release artifacts being documented; do not substitute a mocked or generated interface.
3. Use synthetic audio and note text. Keep API keys, usernames, account details, filesystem paths, notifications, and unrelated desktop content out of frame.
4. Capture the app surface directly. Do not take a full-desktop screenshot and crop it later.
5. Inspect every image at original resolution, including sidebars, title bars, status bars, and modal backgrounds.
6. Keep PNGs below 500 KB when the visual meaning is unchanged, and update the README alt text and captions with the capture.
