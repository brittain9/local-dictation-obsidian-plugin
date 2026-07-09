import { describe, expect, it } from 'vitest';

import {
  aggregatePlatformSplit,
  classifySidecarAsset,
  compareCalverVersions,
  computeDelta,
  normalizeSnapshot,
  sumMainJsDownloads,
} from '../scripts/lib/download-stats-data.mjs';

describe('classifySidecarAsset', () => {
  it('classifies every sidecar archive this repo actually ships', () => {
    expect(classifySidecarAsset('sidecar-linux-x86_64-cpu.tar.gz')).toEqual({
      os: 'linux',
      arch: 'x86_64',
      accel: 'cpu',
    });
    expect(classifySidecarAsset('sidecar-linux-x86_64-cuda.tar.gz')).toEqual({
      os: 'linux',
      arch: 'x86_64',
      accel: 'cuda',
    });
    expect(classifySidecarAsset('sidecar-windows-x86_64-cpu.tar.gz')).toEqual({
      os: 'windows',
      arch: 'x86_64',
      accel: 'cpu',
    });
    expect(classifySidecarAsset('sidecar-windows-x86_64-cuda.tar.gz')).toEqual({
      os: 'windows',
      arch: 'x86_64',
      accel: 'cuda',
    });
    expect(classifySidecarAsset('sidecar-macos-arm64.tar.gz')).toEqual({
      os: 'macos',
      arch: 'arm64',
      accel: null,
    });
  });

  it('returns null for non-sidecar release assets', () => {
    expect(classifySidecarAsset('main.js')).toBeNull();
    expect(classifySidecarAsset('manifest.json')).toBeNull();
    expect(classifySidecarAsset('styles.css')).toBeNull();
    expect(classifySidecarAsset('checksums.txt')).toBeNull();
  });
});

describe('aggregatePlatformSplit and sumMainJsDownloads', () => {
  const releases = [
    {
      assets: {
        'main.js': 20,
        'manifest.json': 22,
        'sidecar-linux-x86_64-cpu.tar.gz': 7,
        'sidecar-macos-arm64.tar.gz': 0,
      },
    },
    {
      assets: {
        'main.js': 83,
        'manifest.json': 85,
        'sidecar-linux-x86_64-cpu.tar.gz': 16,
        'sidecar-macos-arm64.tar.gz': 14,
      },
    },
  ];

  it('sums sidecar downloads per platform key across releases', () => {
    expect(aggregatePlatformSplit(releases)).toEqual({
      'linux-cpu': 23,
      'macos-arm64': 14,
    });
  });

  it('sums main.js downloads across releases, ignoring other assets', () => {
    expect(sumMainJsDownloads(releases)).toBe(103);
  });

  it('treats a release missing main.js as zero rather than throwing', () => {
    expect(sumMainJsDownloads([{ assets: { 'manifest.json': 5 } }])).toBe(0);
  });
});

describe('compareCalverVersions', () => {
  it('sorts the unpadded MICRO segment numerically, not lexicographically', () => {
    // A plain string sort ranks "2026.7.10" before "2026.7.2" (character '1' <
    // '2'), which is chronologically backwards — this is exactly the bug the
    // Obsidian registry's non-zero-padded version keys can trigger.
    const versions = ['2026.7.2', '2026.7.10', '2026.6.9'];
    expect([...versions].sort(compareCalverVersions)).toEqual([
      '2026.6.9',
      '2026.7.2',
      '2026.7.10',
    ]);
  });

  it('treats equal versions as equal', () => {
    expect(compareCalverVersions('2026.7.2', '2026.7.2')).toBe(0);
  });
});

describe('computeDelta', () => {
  const previous = normalizeSnapshot({
    capturedAt: '2026-07-01T00:00:00.000Z',
    repo: { forks: 1, stars: 10, watchers: 2 },
    releases: [
      { assets: { 'main.js': 80 }, publishedAt: '2026-06-01T00:00:00.000Z', tag: '2026.6.1' },
    ],
    obsidianRegistry: { byVersion: { '2026.6.1': 400 }, total: 400 },
    traffic: null,
  });
  const current = normalizeSnapshot({
    capturedAt: '2026-07-08T00:00:00.000Z',
    repo: { forks: 1, stars: 12, watchers: 2 },
    releases: [
      { assets: { 'main.js': 103 }, publishedAt: '2026-06-01T00:00:00.000Z', tag: '2026.6.1' },
    ],
    obsidianRegistry: { byVersion: { '2026.6.1': 488 }, total: 488 },
    traffic: null,
  });

  it('reports no previous data on the first-ever snapshot', () => {
    expect(computeDelta(null, current)).toEqual({
      daysSincePrevious: null,
      hasPrevious: false,
      mainJsDownloadsGained: null,
      registryDownloadsGained: null,
    });
  });

  it('computes gained downloads and elapsed days between two snapshots', () => {
    expect(computeDelta(previous, current)).toEqual({
      daysSincePrevious: 7,
      hasPrevious: true,
      mainJsDownloadsGained: 23,
      registryDownloadsGained: 88,
    });
  });
});
