#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

import {
  buildQualityReport,
  parseQualityMeasurements,
  renderQualityReportMarkdown,
} from './lib/transcription-quality-report.mjs';

export function parseArgs(argv) {
  const args = { outputDir: 'artifacts/transcription-quality', renderOnly: null };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case '--output-dir':
        index += 1;
        args.outputDir = argv[index];
        break;
      case '--render-only':
        index += 1;
        args.renderOnly = argv[index];
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  if (!args.outputDir || (argv.includes('--render-only') && !args.renderOnly)) {
    throw new Error('--output-dir and --render-only require a path.');
  }
  return args;
}

async function jsonlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await jsonlFiles(path)));
    if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files.sort();
}

async function render(inputDirectory, outputDirectory) {
  const files = await jsonlFiles(inputDirectory);
  const measurements = [];
  for (const file of files) {
    measurements.push(...parseQualityMeasurements(await readFile(file, 'utf8'), basename(file)));
  }
  const report = buildQualityReport(measurements, {
    commitSha: process.env.GITHUB_HEAD_SHA ?? process.env.GITHUB_SHA ?? null,
    generatedAt: new Date().toISOString(),
    runner: process.env.RUNNER_DESCRIPTION ?? `${process.platform}-${process.arch}`,
  });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, 'transcription-quality.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    join(outputDirectory, 'transcription-quality.md'),
    renderQualityReportMarkdown(report),
  );
  return report;
}

function runSuite(script, reportPath) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, ['run', script], {
    env: { ...process.env, STT_QUALITY_REPORT_PATH: reportPath },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit status ${result.status}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      'Usage: node scripts/transcription-quality-report.mjs [--output-dir <dir>] [--render-only <measurement-dir>]',
    );
    return;
  }
  const outputDirectory = resolve(args.outputDir);
  if (args.renderOnly !== null) {
    await render(resolve(args.renderOnly), outputDirectory);
    return;
  }

  await rm(outputDirectory, { force: true, recursive: true });
  const measurementDirectory = join(outputDirectory, 'measurements');
  await mkdir(measurementDirectory, { recursive: true });
  for (const [script, filename] of [
    ['test:sidecar:e2e', 'whisper-english.jsonl'],
    ['test:sidecar:nemotron:e2e', 'nemotron-english.jsonl'],
    ['test:sidecar:multilingual:e2e', 'multilingual.jsonl'],
  ]) {
    runSuite(script, join(measurementDirectory, filename));
  }
  await render(measurementDirectory, outputDirectory);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
