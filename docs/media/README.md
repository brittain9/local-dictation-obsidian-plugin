# Product media

## Brand assets

`hero-light.png` and `hero-dark.png` are the README banner (2048x768). The README selects between them with a `<picture>` element keyed on `prefers-color-scheme`, so the light asset is also the fallback wherever `<picture>` is unsupported.

The light and dark banners are separately designed exports. Replace both assets together whenever the logo changes, preserve their matching dimensions, and losslessly optimize the PNGs before committing them.

## Product screenshot checklist

1. Create a new disposable vault and isolated Obsidian profile. Do not reuse a personal vault or profile.
2. Install the current release artifacts; do not substitute a mocked or generated interface.
3. Use synthetic audio and note text. Keep API keys, usernames, account details, filesystem paths, notifications, and unrelated desktop content out of frame.
4. Capture the app surface directly. Do not take a full-desktop screenshot and crop it later.
5. Inspect every image at original resolution, including sidebars, title bars, status bars, and modal backgrounds.
6. Optimize PNGs without visible quality loss, and update the README alt text and captions with the capture.
