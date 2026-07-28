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
const SOURCE_LANGUAGE = 'en';
const TARGET_LANGUAGE = 'es';
const TEST_MARKDOWN = `The meeting starts at nine tomorrow morning.
Keep \`npm run check\`, [[Local Dictation]], #release, and $x + y$ unchanged.
Read [the specification](https://example.com/spec).

| Tool | Status |
| --- | --- |
| [[Nemotron]] | Ready |
`;

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

const pairPrefix = `${SOURCE_LANGUAGE}_${TARGET_LANGUAGE}`;
const { rebuildTranslatedMarkdown, segmentMarkdownForTranslation, translatableTexts } =
  await loadSegmentationModule();
const segments = segmentMarkdownForTranslation(TEST_MARKDOWN);
const texts = translatableTexts(segments);
const runtime = requireArtifact('runtime');
const runtimeGlue = requireArtifact('runtime_glue');
const model = requireArtifact(`${pairPrefix}_model`);
const lexicon = requireArtifact(`${pairPrefix}_lexicon`);
const vocabularies = [
  catalogModel.artifacts.find((artifact) => artifact.artifactId === `${pairPrefix}_vocabulary`),
].filter(Boolean);
if (vocabularies.length === 0) {
  vocabularies.push(
    requireArtifact(`${pairPrefix}_source_vocabulary`),
    requireArtifact(`${pairPrefix}_target_vocabulary`),
  );
}

const startedReading = performance.now();
const [glueSource, workerSource, wasmBinary, modelBytes, lexiconBytes, ...vocabularyBytes] =
  await Promise.all([
    readFile(join(installDir, runtimeGlue.filename), 'utf8'),
    bundleBergamotWorker({ minify: true }),
    readBytes(join(installDir, runtime.filename)),
    readBytes(join(installDir, model.filename)),
    readBytes(join(installDir, lexicon.filename)),
    ...vocabularies.map((artifact) => readBytes(join(installDir, artifact.filename))),
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
  let translatedMarkdown;
  try {
    translatedMarkdown = rebuildTranslatedMarkdown(segments, result.translations);
  } catch (error) {
    throw new Error(
      `Failed to rebuild translated Markdown from ${JSON.stringify(result.translations)}`,
      { cause: error },
    );
  }
  const combined = translatedMarkdown.toLocaleLowerCase('es');
  if (
    result.translations.length !== texts.length ||
    !combined.includes('mañana') ||
    !combined.includes('nueve') ||
    !translatedMarkdown.includes('`npm run check`') ||
    !translatedMarkdown.includes('[[Local Dictation]]') ||
    !translatedMarkdown.includes('#release') ||
    !translatedMarkdown.includes('$x + y$') ||
    !translatedMarkdown.includes('(https://example.com/spec)') ||
    !translatedMarkdown.includes('| --- | --- |') ||
    !translatedMarkdown.includes('[[Nemotron]]')
  ) {
    throw new Error(
      `Translation smoke output failed semantic checks: ${JSON.stringify(translatedMarkdown)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      installDir,
      readMs: Math.round(readMs),
      readyMs: Math.round(result.readyMs),
      inferenceMs: Math.round(performance.now() - startedInference),
      translatedMarkdown,
    })}\n`,
  );
} finally {
  await worker.terminate();
}

function requireArtifact(artifactId) {
  const artifact = catalogModel.artifacts.find((candidate) => candidate.artifactId === artifactId);
  if (artifact === undefined) {
    throw new Error(`The catalog model is missing ${artifactId}.`);
  }
  if (
    !metadata.artifacts.some(
      (installed) =>
        installed.artifactId === artifact.artifactId &&
        installed.filename === artifact.filename &&
        installed.sha256 === artifact.sha256,
    )
  ) {
    throw new Error(`The managed installation does not match catalog artifact ${artifactId}.`);
  }
  return artifact;
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

async function loadSegmentationModule() {
  const result = await build({
    bundle: true,
    entryPoints: ['src/translation/markdown-segmentation.ts'],
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
    throw new Error('Failed to bundle Markdown translation segmentation.');
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
