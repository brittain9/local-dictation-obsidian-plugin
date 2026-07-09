// Pure helpers for scripts/download-stats.mjs, split out so the asset-name
// classification and delta math are unit-testable without hitting the GitHub
// or Obsidian registry APIs.

const SIDECAR_ASSET_PATTERN = /^sidecar-([a-z]+)-([a-z0-9_]+?)(?:-(cpu|cuda))?\.tar\.gz$/;

// Classify a release asset filename into its platform/arch/acceleration, or
// null for non-sidecar assets (main.js, manifest.json, styles.css, checksums.txt).
export function classifySidecarAsset(name) {
  const match = SIDECAR_ASSET_PATTERN.exec(name);
  if (!match) return null;
  const [, os, arch, accel] = match;
  return { os, arch, accel: accel ?? null };
}

// Collapse (os, arch, accel) into the platformSplit key used in reports and
// snapshots: accelerated variants collapse arch away (linux-cpu, linux-cuda);
// unaccelerated variants keep arch (macos-arm64) since that's the only axis
// that distinguishes them.
export function platformSplitKey({ os, arch, accel }) {
  return accel ? `${os}-${accel}` : `${os}-${arch}`;
}

// releases: array of { assets: Record<assetName, downloadCount> }
export function aggregatePlatformSplit(releases) {
  const totals = {};
  for (const release of releases) {
    for (const [name, count] of Object.entries(release.assets)) {
      const classified = classifySidecarAsset(name);
      if (!classified) continue;
      const key = platformSplitKey(classified);
      totals[key] = (totals[key] ?? 0) + count;
    }
  }
  return totals;
}

// main.js is the install/update proxy: manifest.json is polled by Obsidian
// and BRAT on every update check regardless of whether the user installs, so
// it overcounts relative to actual installs.
export function sumMainJsDownloads(releases) {
  return releases.reduce((sum, release) => sum + (release.assets['main.js'] ?? 0), 0);
}

export function normalizeSnapshot({ capturedAt, repo, releases, obsidianRegistry, traffic }) {
  return {
    schemaVersion: 1,
    capturedAt,
    repo,
    releaseAssets: {
      mainJsTotal: sumMainJsDownloads(releases),
      byRelease: releases.map((release) => ({
        tag: release.tag,
        publishedAt: release.publishedAt,
        assets: release.assets,
      })),
    },
    platformSplit: aggregatePlatformSplit(releases),
    obsidianRegistry,
    traffic,
  };
}

// Cumulative counters (main.js downloads, registry downloads) support a
// meaningful delta. Traffic is a rolling 14-day window, not a cumulative
// counter, so it is intentionally excluded here — subtracting two
// overlapping windows doesn't produce a "new visits" number.
export function computeDelta(previous, current) {
  if (!previous) {
    return {
      hasPrevious: false,
      daysSincePrevious: null,
      mainJsDownloadsGained: null,
      registryDownloadsGained: null,
    };
  }
  const daysSincePrevious =
    (Date.parse(current.capturedAt) - Date.parse(previous.capturedAt)) / (24 * 60 * 60 * 1000);
  return {
    hasPrevious: true,
    daysSincePrevious,
    mainJsDownloadsGained: current.releaseAssets.mainJsTotal - previous.releaseAssets.mainJsTotal,
    registryDownloadsGained: current.obsidianRegistry.total - previous.obsidianRegistry.total,
  };
}

// Obsidian's community-plugin-stats.json keys releases by calver version
// string (e.g. "2026.7.10") in insertion order, not chronological order, and
// the MICRO segment isn't zero-padded — a plain string sort would rank
// "2026.7.10" before "2026.7.2". Compare numerically per segment instead.
export function compareCalverVersions(a, b) {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
