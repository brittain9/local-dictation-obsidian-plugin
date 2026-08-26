// Obsidian plugins execute in Electron's renderer, where `window` is the global
// object. Per the Obsidian guideline (obsidianmd/prefer-window-timers) the source
// calls window.setTimeout / window.clearTimeout instead of the bare globals.
// vitest runs the suite under `environment: 'node'`, which has no `window`, so we
// alias it to the Node global — window.setTimeout/clearTimeout/navigator then
// resolve to their Node equivalents and the timer-driven code paths run unchanged.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window: typeof globalThis }).window = globalThis;
}
