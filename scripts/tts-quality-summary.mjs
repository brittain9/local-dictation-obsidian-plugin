import { readFile } from 'node:fs/promises';

const reportPath = process.argv[2];
if (reportPath === undefined) {
  throw new Error('usage: node scripts/tts-quality-summary.mjs REPORT.jsonl');
}

const rows = (await readFile(reportPath, 'utf8'))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (rows.length === 0 || rows.some((row) => row.schemaVersion !== 1)) {
  throw new Error('TTS quality report is empty or uses an unsupported schema version.');
}

const speedOne = rows.filter((row) => row.speed === 1);
const lines = [
  '## Pocket TTS multilingual certification',
  '',
  '| Language | Model | First audio | Raw RTF | WER | Result |',
  '| --- | --- | ---: | ---: | ---: | --- |',
  ...speedOne.map(
    (row) =>
      `| ${row.language} | \`${row.modelId}\` | ${row.firstAudioLatencySeconds.toFixed(2)}s | ${row.realTimeFactor.toFixed(2)}x | ${row.wer.toFixed(3)} | ${row.passed ? 'Pass' : 'Fail'} |`,
  ),
  '',
  'The JSONL artifact also records 0.75x and 2x duration checks plus report-only 3x benchmark data.',
  '',
].join('\n');

process.stdout.write(lines);
