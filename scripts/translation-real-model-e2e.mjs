import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';

import { bundleBergamotWorker } from './bundle-bergamot-worker.mjs';

const MODEL_TRIPLE = {
  runtimeId: 'bergamot_wasm',
  familyId: 'firefox_translations',
  modelId: 'firefox_translations_release_2026_07',
};
const SOURCE_LANGUAGE = process.env.TRANSLATION_SOURCE_LANGUAGE?.trim() || 'en';
const TARGET_LANGUAGE =
  process.argv[2]?.trim() || process.env.TRANSLATION_TARGET_LANGUAGE?.trim() || 'es';
const TEST_MARKDOWN = `**Fast Translations**: Delivers quick language conversion.
Please press **Ctrl+S** to save your work before closing.
A sentence with **bold text** in the middle of the clause continues here.
The meeting starts at nine tomorrow morning.
Keep \`npm run check\`, [[Local Dictation]], #release, and $x + y$ unchanged.
Read [the specification](https://example.com/spec).
<mark data-kind='result'>Hello world</mark> continues with <kbd>Ctrl+S</kbd>.

| Tool | Status |
| --- | --- |
| [[Nemotron]] | Ready |
`;
const SOURCE_PROSE = [
  'Fast Translations',
  'Delivers quick language conversion',
  'Please press',
  'to save your work before closing',
  'A sentence with',
  'bold text',
  'in the middle of the clause continues here',
  'The meeting starts at nine tomorrow morning',
  'Keep ',
  ' unchanged',
  'Read ',
  'the specification',
  'Hello world',
  'continues with',
  'Tool',
  'Status',
  'Ready',
];
// Per-target proof that the output is really in the target language rather than
// an echo of the English source.
const SEMANTIC_CHECKS = {
  es: (text) => {
    const lowered = text.toLocaleLowerCase('es');
    return lowered.includes('mañana') && lowered.includes('nueve');
  },
  ja: (text) => /[\u3040-\u30ff\u4e00-\u9fff]/u.test(text),
};

const catalog = JSON.parse(await readFile('native/catalog.json', 'utf8'));
const catalogModel = catalog.models.find(
  (model) =>
    model.runtimeId === MODEL_TRIPLE.runtimeId &&
    model.familyId === MODEL_TRIPLE.familyId &&
    model.modelId === MODEL_TRIPLE.modelId,
);
if (catalogModel === undefined) {
  throw new Error('The pinned Firefox Translations model is missing from native/catalog.json.');
}

const installDir =
  process.env.LOCAL_DICTATION_TRANSLATION_MODEL_DIR?.trim() ||
  join(defaultModelStore(), MODEL_TRIPLE.runtimeId, MODEL_TRIPLE.familyId, MODEL_TRIPLE.modelId);
const metadata = JSON.parse(await readFile(join(installDir, 'install.json'), 'utf8'));
for (const [key, value] of Object.entries(MODEL_TRIPLE)) {
  if (metadata[key] !== value) {
    throw new Error(`Installed translation metadata has unexpected ${key}: ${metadata[key]}`);
  }
}

const [
  { rebuildTranslatedMarkdown, segmentMarkdownForTranslation, translatableTexts },
  { resolveTranslationPairArtifacts },
  { translationRegressionFailures },
] = await Promise.all([
  loadTypeScriptModule('src/translation/markdown-segmentation.ts'),
  loadTypeScriptModule('src/translation/translation-artifacts.ts'),
  loadTypeScriptModule('scripts/translation-e2e-validation.ts'),
]);
const segments = segmentMarkdownForTranslation(TEST_MARKDOWN);
const texts = translatableTexts(segments);
// The plugin resolves the same artifacts through this helper, so the smoke run
// exercises the real selection logic rather than a copy of it.
const artifacts = resolveTranslationPairArtifacts(catalogModel, SOURCE_LANGUAGE, TARGET_LANGUAGE);
for (const artifact of [
  artifacts.runtime,
  artifacts.runtimeGlue,
  artifacts.model,
  artifacts.lexicon,
  ...artifacts.vocabularies,
]) {
  requireInstalled(artifact);
}

const startedReading = performance.now();
const [glueSource, workerSource, wasmBinary, modelBytes, lexiconBytes, ...vocabularyBytes] =
  await Promise.all([
    readFile(join(installDir, artifacts.runtimeGlue.filename), 'utf8'),
    bundleBergamotWorker({ minify: true }),
    readBytes(join(installDir, artifacts.runtime.filename)),
    readBytes(join(installDir, artifacts.model.filename)),
    readBytes(join(installDir, artifacts.lexicon.filename)),
    ...artifacts.vocabularies.map((artifact) => readBytes(join(installDir, artifact.filename))),
  ]);
const readMs = performance.now() - startedReading;
const request = {
  type: 'translate',
  requestId: crypto.randomUUID(),
  sourceLanguage: SOURCE_LANGUAGE,
  targetLanguage: TARGET_LANGUAGE,
  texts,
  wasmBinary,
  model: modelBytes,
  lexicon: lexiconBytes,
  vocabularies: vocabularyBytes,
};
const bridge = `
const { parentPort } = require('node:worker_threads');
globalThis.postMessage = (message) => parentPort.postMessage(message);
globalThis.self = globalThis;
parentPort.on('message', (data) => globalThis.onmessage({ data }));
`;
const worker = new Worker(`${bridge}\n${glueSource}\n${workerSource}`, { eval: true });
const startedInference = performance.now();

try {
  const result = await runTranslation(worker, request);
  let rebuilt;
  try {
    rebuilt = rebuildTranslatedMarkdown(segments, result.translations);
  } catch (error) {
    throw new Error(
      `Failed to rebuild translated Markdown from ${JSON.stringify(result.translations)}`,
      { cause: error },
    );
  }
  if (rebuilt.sourceUnitsKept > 0) {
    throw new Error(
      `${rebuilt.sourceUnitsKept} unit(s) lost their protected Markdown and stayed in the source language.`,
    );
  }
  const translatedMarkdown = rebuilt.text;
  const lines = translatedMarkdown.split('\n');
  const regressionFailures = translationRegressionFailures(TARGET_LANGUAGE, translatedMarkdown);
  const sourceResidue = SOURCE_PROSE.filter((phrase) =>
    translatedMarkdown.toLocaleLowerCase('en').includes(phrase.toLocaleLowerCase('en')),
  );
  if (
    result.translations.length !== texts.length ||
    SEMANTIC_CHECKS[TARGET_LANGUAGE]?.(translatedMarkdown) === false ||
    regressionFailures.length > 0 ||
    rebuilt.sourceUnitsKept !== 0 ||
    sourceResidue.length > 0 ||
    /[\uE000-\uF8FF]|https:\/\/\d+\.invalid/u.test(translatedMarkdown) ||
    !/^\*\*[^*\n]+\*\*/u.test(lines[0] ?? '') ||
    !/\*\*Ctrl\s*\+\s*S\*\*/u.test(lines[1] ?? '') ||
    !/\*\*[^*\n]+\*\*/u.test(lines[2] ?? '') ||
    !translatedMarkdown.includes('`npm run check`') ||
    !translatedMarkdown.includes('[[Local Dictation]]') ||
    !translatedMarkdown.includes('#release') ||
    !translatedMarkdown.includes('$x + y$') ||
    !translatedMarkdown.includes('(https://example.com/spec)') ||
    !translatedMarkdown.includes("<mark data-kind='result'>") ||
    !translatedMarkdown.includes('</mark>') ||
    !translatedMarkdown.includes('<kbd>Ctrl+S</kbd>') ||
    !lines.some((line) => /^\| [^|]+ \| [^|]+ \|$/u.test(line)) ||
    !lines.includes('| --- | --- |') ||
    !lines.some((line) => /^\| \[\[Nemotron\]\] \| [^|]+ \|$/u.test(line))
  ) {
    throw new Error(
      `Translation smoke output failed semantic checks: ${JSON.stringify({
        sourceResidue,
        regressionFailures,
        translatedMarkdown,
      })}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      installDir,
      readMs: Math.round(readMs),
      readyMs: Math.round(result.readyMs),
      inferenceMs: Math.round(performance.now() - startedInference),
      sourceUnitsKept: rebuilt.sourceUnitsKept,
      translatedMarkdown,
    })}\n`,
  );
} finally {
  await worker.terminate();
}

function requireInstalled(artifact) {
  if (
    !metadata.artifacts.some(
      (installed) =>
        installed.artifactId === artifact.artifactId &&
        installed.filename === artifact.filename &&
        installed.sha256 === artifact.sha256,
    )
  ) {
    throw new Error(
      `The managed installation does not match catalog artifact ${artifact.artifactId}.`,
    );
  }
}

function runTranslation(worker, request) {
  return new Promise((resolvePromise, reject) => {
    let readyMs = null;
    const fail = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => {
      fail(new Error('Real-model translation timed out after 30 seconds.'));
    }, 30_000);
    worker.once('error', fail);
    worker.on('message', (response) => {
      if (response.requestId !== request.requestId) return;
      if (response.type === 'ready') {
        readyMs = performance.now() - startedInference;
        return;
      }
      clearTimeout(timeout);
      if (response.type === 'error') {
        fail(new Error(response.message));
        return;
      }
      if (response.type === 'complete') {
        resolvePromise({
          readyMs: readyMs ?? performance.now() - startedInference,
          translations: response.translations,
        });
      }
    });
    worker.postMessage(request, [
      request.wasmBinary,
      request.model,
      request.lexicon,
      ...request.vocabularies,
    ]);
  });
}

function defaultModelStore() {
  if (process.env.LOCAL_DICTATION_MODEL_STORE?.trim()) {
    return resolve(process.env.LOCAL_DICTATION_MODEL_STORE.trim());
  }
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'obsidian-local-stt', 'models');
    case 'linux':
      return join(
        process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share'),
        'obsidian-local-stt',
        'models',
      );
    case 'win32': {
      const localAppData = process.env.LOCALAPPDATA?.trim();
      if (!localAppData) {
        throw new Error('Set LOCAL_DICTATION_TRANSLATION_MODEL_DIR to the installed model path.');
      }
      return join(localAppData, 'obsidian-local-stt', 'data', 'models');
    }
    default:
      throw new Error('Set LOCAL_DICTATION_TRANSLATION_MODEL_DIR to the installed model path.');
  }
}

async function readBytes(path) {
  const bytes = await readFile(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function loadTypeScriptModule(entryPoint) {
  const result = await build({
    bundle: true,
    entryPoints: [entryPoint],
    format: 'esm',
    logLevel: 'silent',
    minify: true,
    platform: 'node',
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  const source = result.outputFiles[0]?.text;
  if (source === undefined) {
    throw new Error(`Failed to bundle ${entryPoint}.`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
