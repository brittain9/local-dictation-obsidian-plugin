#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const sourceDir = resolve(requiredArg(args, 'source-dir'));
const bergamotDir = resolve(requiredArg(args, 'bergamot-dir'));
const hyMtDir = resolve(requiredArg(args, 'hy-mt-dir'));
const outputDir = resolve(requiredArg(args, 'output-dir'));
const sampleNames = (await readdir(sourceDir)).filter((name) => name.endsWith('.md')).sort();

await mkdir(join(outputDir, 'bergamot'), { recursive: true });
await mkdir(join(outputDir, 'hy-mt'), { recursive: true });

const rows = [];
for (const sampleName of sampleNames) {
  const stem = basename(sampleName, '.md');
  const sourceMarkdown = await readFile(join(sourceDir, sampleName), 'utf8');
  const bergamot = await loadBenchmark(join(bergamotDir, `${stem}.json`));
  const hyMt = await loadBenchmark(join(hyMtDir, `${stem}.json`));
  bergamot.topologyMatches = markdownTopologyMatches(sourceMarkdown, bergamot.text);
  hyMt.topologyMatches = markdownTopologyMatches(sourceMarkdown, hyMt.text);
  await writeFile(join(outputDir, 'bergamot', sampleName), normalizeSample(bergamot.text));
  await writeFile(join(outputDir, 'hy-mt', sampleName), normalizeSample(hyMt.text));
  rows.push(
    `| ${stem} | [source](../source/${sampleName}) | ` +
      `[Bergamot](bergamot/${sampleName})${resultLabels(bergamot)} | ` +
      `[HY-MT](hy-mt/${sampleName})${resultLabels(hyMt)} |`,
  );
}

const readme = `# Translation model note outputs

These are complete English-to-Dutch outputs from the current PR-head Markdown
pipeline. Bergamot uses the actual installed Firefox Translations pack.
HY-MT uses the official Tencent prompt and recommended decoding
(\`temperature=0.7\`, \`top_k=20\`, \`top_p=0.6\`,
\`repeat_penalty=1.05\`), fixed seed 42, and synthetic-URL protected markers.
“Topology changed” means that heading levels, list shape, blockquotes, fenced
blocks, task items, or table row/column shape differ from the source. It does
not judge translation quality. Trailing whitespace is normalized in the
committed samples.

MADLAD outputs are absent because its requested GGUF failed the llama.cpp smoke
test before generation, its one permitted fallback produced invalid output, and
the user directed the run to skip it.

| Sample | English source | Bergamot | HY-MT2 1.8B Q4_K_M |
| --- | --- | --- | --- |
${rows.join('\n')}
`;
await writeFile(join(outputDir, 'README.md'), readme);

async function loadBenchmark(path) {
  const result = JSON.parse(await readFile(path, 'utf8'));
  if (result.rebuildError) {
    throw new Error(`${path}: ${result.rebuildError}`);
  }
  const rebuilt = result.translatedMarkdown;
  const text = typeof rebuilt === 'string' ? rebuilt : rebuilt?.text;
  const sourceUnitsKept =
    result.sourceUnitsKept ?? (typeof rebuilt === 'object' ? rebuilt?.sourceUnitsKept : 0);
  if (typeof text !== 'string') {
    throw new Error(`${path}: no rebuilt Markdown output`);
  }
  return { sourceUnitsKept, text };
}

function resultLabels(result) {
  const labels = [];
  if (result.sourceUnitsKept !== 0) {
    labels.push(
      `${result.sourceUnitsKept} source unit${result.sourceUnitsKept === 1 ? '' : 's'} kept`,
    );
  }
  if (!result.topologyMatches) labels.push('topology changed');
  return labels.length === 0 ? '' : ` (${labels.join('; ')})`;
}

function markdownTopologyMatches(source, translation) {
  return JSON.stringify(markdownTopology(source)) === JSON.stringify(markdownTopology(translation));
}

function markdownTopology(markdown) {
  const lines = markdown.split(/\r?\n/u);
  return {
    tablePipes: lines
      .filter((line) => line.trimStart().startsWith('|'))
      .map((line) => line.match(/\|/gu)?.length ?? 0),
    headingLevels: lines
      .filter((line) => /^#{1,6}\s/u.test(line))
      .map((line) => line.match(/^#+/u)?.[0].length ?? 0),
    blockquotes: lines.filter((line) => /^>/u.test(line)).length,
    unorderedListIndents: lines
      .filter((line) => /^\s*-\s/u.test(line))
      .map((line) => line.match(/^\s*/u)?.[0].length ?? 0),
    orderedListItems: lines.filter((line) => /^\s*\d+\.\s/u.test(line)).length,
    fencedLines: lines.filter((line) => /^```/u.test(line)).length,
    taskItems: lines.filter((line) => /^\s*-\s\[[ xX]\]/u.test(line)).length,
  };
}

function normalizeSample(markdown) {
  return `${markdown.replace(/[ \t]+$/gmu, '').trimEnd()}\n`;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith('--')) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function requiredArg(values, key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}
