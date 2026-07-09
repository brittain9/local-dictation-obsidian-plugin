import { describe, expect, it } from 'vitest';

import { buildReport, parseArgs } from '../scripts/download-stats.mjs';
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

describe('parseArgs', () => {
  it('parses the supported flags', () => {
    expect(parseArgs([])).toEqual({ help: false, json: false, snapshot: false });
    expect(parseArgs(['--snapshot', '--json'])).toEqual({
      help: false,
      json: true,
      snapshot: true,
    });
    expect(parseArgs(['-h'])).toEqual({ help: true, json: false, snapshot: false });
  });

  it('rejects unknown arguments instead of silently ignoring them', () => {
    expect(() => parseArgs(['--snapshots'])).toThrow(/Unknown argument: --snapshots/);
  });
});

describe('buildReport', () => {
  const previous = normalizeSnapshot({
    capturedAt: '2026-07-01T00:00:00.000Z',
    repo: { forks: 0, stars: 3, watchers: 0 },
    releases: [{ assets: { 'main.js': 80 }, publishedAt: '2026-07-09T02:50:34Z', tag: '2026.7.3' }],
    obsidianRegistry: { byVersion: { '2026.7.2': 40 }, total: 400 },
    traffic: null,
  });
  const current = normalizeSnapshot({
    capturedAt: '2026-07-08T00:00:00.000Z',
    repo: { forks: 0, stars: 3, watchers: 0 },
    releases: [
      {
        assets: {
          'main.js': 103,
          'manifest.json': 110,
          'sidecar-linux-x86_64-cpu.tar.gz': 7,
          'sidecar-macos-arm64.tar.gz': 3,
        },
        publishedAt: '2026-07-09T02:50:34Z',
        tag: '2026.7.3',
      },
    ],
    obsidianRegistry: { byVersion: { '2026.7.10': 5, '2026.7.2': 55 }, total: 488 },
    traffic: { clones: { count: 1321, uniques: 258 }, views: { count: 110, uniques: 44 } },
  });

  it('renders delta, traffic, and referrer sections when all data is available', () => {
    const report = buildReport({
      current,
      delta: computeDelta(previous, current),
      referrers: [{ count: 30, referrer: 'obsidian.md', uniques: 12 }],
    });
    expect(report).toContain('## Since last snapshot');
    expect(report).toContain('main.js downloads gained: **+23**');
    expect(report).toContain('| 2026.7.3 | 2026-07-09 | 103 | 110 |');
    expect(report).toContain('- Views: 110 (44 unique)');
    expect(report).toContain('| obsidian.md | 30 | 12 |');
    // Registry versions must sort numerically (2026.7.10 above 2026.7.2), not
    // lexicographically.
    expect(report.indexOf('| 2026.7.10 | 5 |')).toBeLessThan(report.indexOf('| 2026.7.2 | 55 |'));
  });

  it('omits the delta section without history and marks traffic unavailable without credentials', () => {
    const withoutTraffic = { ...current, traffic: null };
    const report = buildReport({
      current: withoutTraffic,
      delta: computeDelta(null, withoutTraffic),
      referrers: null,
    });
    expect(report).not.toContain('## Since last snapshot');
    expect(report).toContain('_Unavailable');
  });
});
