#!/usr/bin/env node
// Render usage/download insights for this plugin from data GitHub and the
// Obsidian community registry already collect server-side — no client-side
// telemetry, no code shipped in main.js. Three sources, three different
// shapes:
//   - Release asset download_count (gh api, cumulative, all-time, no auth
//     beyond a normal token) — install proxy + platform/acceleration split.
//   - Traffic API (gh api, rolling 14-day window, needs push/administration
//     access — the default GITHUB_TOKEN in Actions can't read it) — the only
//     source of unique visitor/cloner counts.
//   - Obsidian community-plugin-stats.json (public, unauthenticated) — total
//     + per-version registry downloads, independent of GitHub asset counts.
//
// See docs/specs/download-stats.md for the full rationale, report shape, and
// the snapshot schema. Snapshot history lives on the dedicated stats-history
// branch (stats/history.jsonl there), never on main.
//
// CLI: node scripts/download-stats.mjs [--snapshot] [--json]
//   --snapshot  record a normalized snapshot in the history file
//   --json      print the raw collected data instead of the markdown report
// Optional env: GITHUB_REPOSITORY (skips the `gh repo view` lookup, as set by
//               Actions), GH_TOKEN (passed through to `gh` for auth),
//               STATS_HISTORY_PATH (history file location; the weekly workflow
//               points this at its checkout of the stats-history branch).

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

import { compareCalverVersions } from './lib/calver.mjs';
import { computeDelta, normalizeSnapshot } from './lib/download-stats-data.mjs';

const OBSIDIAN_STATS_URL =
  'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json';
const HISTORY_BRANCH = 'stats-history';
const HISTORY_PATH_IN_BRANCH = 'stats/history.jsonl';
const HISTORY_PATH = process.env.STATS_HISTORY_PATH ?? HISTORY_PATH_IN_BRANCH;

export function parseArgs(argv) {
  const args = { help: false, json: false, snapshot: false };
  for (const arg of argv) {
    switch (arg) {
      case '--snapshot':
        args.snapshot = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
  }
  return args;
}

function resolveRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const result = spawnSync(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(`gh repo view failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

function fetchReleases(repo) {
  // --paginate alone emits one JSON array per page back-to-back, which
  // JSON.parse rejects past 100 releases; --slurp wraps the pages in an outer
  // array instead, flattened below.
  const result = spawnSync(
    'gh',
    ['api', '-X', 'GET', `repos/${repo}/releases`, '-f', 'per_page=100', '--paginate', '--slurp'],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`gh api releases failed (${result.status}): ${result.stderr}`);
  }
  const raw = JSON.parse(result.stdout).flat();
  return raw.map((release) => ({
    tag: release.tag_name,
    publishedAt: release.published_at,
    assets: Object.fromEntries(release.assets.map((asset) => [asset.name, asset.download_count])),
  }));
}

function fetchRepoMeta(repo) {
  const result = spawnSync('gh', ['api', '-X', 'GET', `repos/${repo}`], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`gh api repo failed (${result.status}): ${result.stderr}`);
  }
  const data = JSON.parse(result.stdout);
  return {
    stars: data.stargazers_count,
    forks: data.forks_count,
    // `watchers_count` is a GitHub API legacy alias for stargazers_count, not
    // actual watchers. `subscribers_count` is the real "people watching" count.
    watchers: data.subscribers_count,
  };
}

function fetchTrafficEndpoint(repo, path) {
  const result = spawnSync('gh', ['api', '-X', 'GET', `repos/${repo}/traffic/${path}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    // Missing push/administration access is the expected cause, but surface
    // gh's actual stderr so rate limits or network failures aren't misread as
    // a credential problem.
    const reason = result.stderr?.trim() || `exit status ${result.status}`;
    console.warn(`warning: traffic/${path} unavailable: ${reason}`);
    return null;
  }
  return JSON.parse(result.stdout);
}

function fetchTraffic(repo) {
  const views = fetchTrafficEndpoint(repo, 'views');
  const clones = fetchTrafficEndpoint(repo, 'clones');
  const referrers = fetchTrafficEndpoint(repo, 'popular/referrers');
  return {
    views: views ? { count: views.count, uniques: views.uniques } : null,
    clones: clones ? { count: clones.count, uniques: clones.uniques } : null,
    referrers,
  };
}

async function fetchObsidianRegistry(pluginId) {
  const response = await fetch(OBSIDIAN_STATS_URL);
  if (!response.ok) {
    throw new Error(`Obsidian registry fetch failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const entry = data[pluginId];
  if (!entry) {
    throw new Error(`Plugin id "${pluginId}" not found in ${OBSIDIAN_STATS_URL}`);
  }
  const { downloads, updated: _updated, ...byVersion } = entry;
  return { total: downloads, byVersion };
}

function parseHistoryLines(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

// History lives on the stats-history branch, not main. CI checks that branch
// out and points STATS_HISTORY_PATH at it; locally the file normally doesn't
// exist, so fall back to reading the branch ref directly — this keeps the
// delta section working after a plain `git fetch`.
async function readHistory(path) {
  try {
    return parseHistoryLines(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const result = spawnSync('git', ['show', `origin/${HISTORY_BRANCH}:${HISTORY_PATH_IN_BRANCH}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return [];
  return parseHistoryLines(result.stdout);
}

// Write the full history rather than appending the new entry: when the prior
// entries came from the branch fallback above, an append-only write would
// create a local file holding just one line, which would then shadow the real
// branch history on the next run. In CI the file already holds every prior
// line, so this degenerates to the same one-line-added diff an append gives.
async function writeHistory(path, entries) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

function formatSigned(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function buildReport({ current, referrers, delta }) {
  const lines = [];
  lines.push('# Download & usage stats', '');
  lines.push(`Captured: ${current.capturedAt}`, '');

  lines.push('## Overview', '');
  lines.push(
    `- \`main.js\` downloads (install proxy, all releases): **${current.releaseAssets.mainJsTotal}**`,
  );
  lines.push(`- Obsidian registry downloads: **${current.obsidianRegistry.total}**`);
  lines.push(
    `- Stars: ${current.repo.stars} · Forks: ${current.repo.forks} · Watchers: ${current.repo.watchers}`,
  );
  lines.push('');

  if (delta.hasPrevious) {
    lines.push('## Since last snapshot', '');
    lines.push(`- ${delta.daysSincePrevious.toFixed(1)} days since previous snapshot`);
    lines.push(`- main.js downloads gained: **${formatSigned(delta.mainJsDownloadsGained)}**`);
    lines.push(
      `- Obsidian registry downloads gained: **${formatSigned(delta.registryDownloadsGained)}**`,
    );
    lines.push('');
  }

  lines.push('## Releases (asset download counts)', '');
  lines.push('| Release | Published | main.js | manifest.json |', '| --- | --- | --- | --- |');
  for (const release of current.releaseAssets.byRelease) {
    lines.push(
      `| ${release.tag} | ${release.publishedAt.slice(0, 10)} | ${release.assets['main.js'] ?? 0} | ${release.assets['manifest.json'] ?? 0} |`,
    );
  }
  lines.push('');

  lines.push('## Platform / acceleration split (sidecar downloads, all releases)', '');
  const platformEntries = Object.entries(current.platformSplit).sort((a, b) => b[1] - a[1]);
  lines.push('| Platform | Downloads |', '| --- | --- |');
  for (const [key, count] of platformEntries) {
    lines.push(`| ${key} | ${count} |`);
  }
  lines.push('');

  lines.push('## Obsidian community registry', '');
  lines.push(`Total: **${current.obsidianRegistry.total}**`, '');
  const versionEntries = Object.entries(current.obsidianRegistry.byVersion).sort((a, b) =>
    compareCalverVersions(b[0], a[0]),
  );
  lines.push('| Version | Downloads |', '| --- | --- |');
  for (const [version, count] of versionEntries) {
    lines.push(`| ${version} | ${count} |`);
  }
  lines.push('');

  lines.push('## Traffic (rolling 14-day window)', '');
  if (current.traffic) {
    lines.push(`- Views: ${current.traffic.views.count} (${current.traffic.views.uniques} unique)`);
    lines.push(
      `- Clones: ${current.traffic.clones.count} (${current.traffic.clones.uniques} unique)`,
    );
    if (referrers && referrers.length > 0) {
      lines.push('', '| Referrer | Views | Unique |', '| --- | --- | --- |');
      for (const ref of referrers) {
        lines.push(`| ${ref.referrer} | ${ref.count} | ${ref.uniques} |`);
      }
    }
  } else {
    lines.push(
      '_Unavailable — the credential in use lacks push/administration access to this repo. ' +
        'See docs/specs/download-stats.md for the STATS_TRAFFIC_TOKEN setup._',
    );
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/download-stats.mjs [--snapshot] [--json]');
    return;
  }

  const repo = resolveRepo();
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));

  const releases = fetchReleases(repo);
  const repoMeta = fetchRepoMeta(repo);
  const traffic = fetchTraffic(repo);
  const obsidianRegistry = await fetchObsidianRegistry(manifest.id);

  const history = await readHistory(HISTORY_PATH);
  const previous = history.at(-1) ?? null;

  const current = normalizeSnapshot({
    capturedAt: new Date().toISOString(),
    repo: repoMeta,
    releases,
    obsidianRegistry,
    traffic:
      traffic.views && traffic.clones ? { views: traffic.views, clones: traffic.clones } : null,
  });

  const delta = computeDelta(previous, current);

  if (args.json) {
    console.log(JSON.stringify({ ...current, referrers: traffic.referrers }, null, 2));
  } else {
    console.log(buildReport({ current, delta, referrers: traffic.referrers }));
  }

  if (args.snapshot) {
    await writeHistory(HISTORY_PATH, [...history, current]);
    console.error(`Recorded snapshot ${history.length + 1} in ${HISTORY_PATH}`);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
