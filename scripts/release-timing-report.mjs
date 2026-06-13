#!/usr/bin/env node
// Render a human-readable timing breakdown for a release run.
//
// GitHub's jobs REST API already records started_at/completed_at for every job
// AND every step, so no per-job instrumentation or timing-artifact plumbing is
// needed: this fetches the run's jobs and renders markdown to the run's job
// summary (GITHUB_STEP_SUMMARY) plus a release-report.md artifact. cargo
// --timings HTML stays as the per-crate deep dive; this is the at-a-glance layer
// for judging "acceptable" vs "too slow" after a release.
//
// Required env: GITHUB_REPOSITORY, GITHUB_RUN_ID (and GH_TOKEN for the API call).
// Optional env: GITHUB_STEP_SUMMARY (Actions sets it), REPORT_OUTPUT (default
//               release-report.md). The job calling this excludes itself from
//               the report since its own timing is still in flight.

import { spawnSync } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { requiredEnv } from './lib/required-env.mjs';

const repo = requiredEnv('GITHUB_REPOSITORY');
const runId = requiredEnv('GITHUB_RUN_ID');
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const outputPath = process.env.REPORT_OUTPUT ?? 'release-report.md';
const selfJob = process.env.GITHUB_JOB ?? 'release-report';

// Steps that are pure runner bookkeeping rather than build work. Keeping them in
// the per-step tables only adds noise; the per-job total still includes them.
const NOISE_STEPS = new Set(['Set up job', 'Complete job', 'Checkout']);

const jobs = fetchJobs(repo, runId).filter((job) => job.name !== selfJob);

const report = buildReport(jobs);

if (summaryPath) {
  await appendFile(summaryPath, report);
}
await writeFile(outputPath, report);
console.log(`Wrote release timing report (${jobs.length} jobs) to ${outputPath}`);

function fetchJobs(repository, id) {
  // per_page=100 covers this workflow's job count many times over; avoids the
  // object-vs-array merge pitfalls of `gh api --paginate` on this endpoint.
  const result = spawnSync(
    'gh',
    ['api', '-X', 'GET', `/repos/${repository}/actions/runs/${id}/jobs`, '-f', 'per_page=100'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`gh api jobs failed (${result.status}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  const list = Array.isArray(parsed.jobs) ? parsed.jobs : [];
  if (typeof parsed.total_count === 'number' && parsed.total_count > list.length) {
    console.warn(
      `warning: run has ${parsed.total_count} jobs but only ${list.length} fetched; report is partial`,
    );
  }
  return list;
}

function buildReport(jobList) {
  const ranked = jobList
    .map((job) => ({
      name: job.name,
      conclusion: job.conclusion ?? job.status ?? 'unknown',
      seconds: durationSeconds(job.started_at, job.completed_at),
      steps: (job.steps ?? [])
        .map((step) => ({
          name: step.name,
          conclusion: step.conclusion ?? step.status ?? 'unknown',
          seconds: durationSeconds(step.started_at, step.completed_at),
        }))
        .filter((step) => step.seconds !== null),
    }))
    .sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0));

  const lines = [];
  lines.push('## Release timing', '');

  const wall = wallClockSeconds(jobList);
  const billed = ranked.reduce((sum, job) => sum + (job.seconds ?? 0), 0);
  lines.push(
    `Wall clock: **${formatDuration(wall)}** · summed job time: **${formatDuration(billed)}**`,
    '',
  );

  lines.push('### Jobs (slowest first)', '');
  lines.push('| Job | Result | Duration |', '| --- | --- | --- |');
  for (const job of ranked) {
    lines.push(`| ${job.name} | ${statusIcon(job.conclusion)} | ${formatDuration(job.seconds)} |`);
  }
  lines.push('');

  const slowest = ranked
    .flatMap((job) =>
      job.steps.map((step) => ({ job: job.name, name: step.name, seconds: step.seconds })),
    )
    .filter((step) => !NOISE_STEPS.has(step.name))
    .sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0))
    .slice(0, 8);

  if (slowest.length > 0) {
    lines.push('### Slowest steps across the run', '');
    lines.push('| Step | Job | Duration |', '| --- | --- | --- |');
    for (const step of slowest) {
      lines.push(`| ${step.name} | ${step.job} | ${formatDuration(step.seconds)} |`);
    }
    lines.push('');
  }

  // Per-step breakdown for the heavy native legs so the toolkit-install vs
  // native-build vs package/upload split is visible at a glance.
  const heavyJobs = ranked.filter((job) =>
    job.steps.some((step) => /CUDA|Build sidecar/i.test(step.name)),
  );
  for (const job of heavyJobs) {
    lines.push(`### ${job.name} — step breakdown`, '');
    lines.push('| Step | Result | Duration |', '| --- | --- | --- |');
    for (const step of job.steps.filter((step) => !NOISE_STEPS.has(step.name))) {
      lines.push(
        `| ${step.name} | ${statusIcon(step.conclusion)} | ${formatDuration(step.seconds)} |`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function durationSeconds(start, end) {
  if (!start || !end) {
    return null;
  }
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

function wallClockSeconds(jobList) {
  const starts = jobList.map((job) => Date.parse(job.started_at)).filter(Number.isFinite);
  const ends = jobList.map((job) => Date.parse(job.completed_at)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) {
    return null;
  }
  return Math.round((Math.max(...ends) - Math.min(...starts)) / 1000);
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) {
    return '—';
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  if (m > 0) {
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  return `${s}s`;
}

function statusIcon(conclusion) {
  switch (conclusion) {
    case 'success':
      return '✅';
    case 'failure':
      return '❌';
    case 'cancelled':
      return '⚪';
    case 'skipped':
      return '⏭️';
    default:
      return conclusion;
  }
}
