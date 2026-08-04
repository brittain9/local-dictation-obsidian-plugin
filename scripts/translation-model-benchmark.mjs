#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
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
const LANGUAGE_NAMES = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  nl: 'Dutch',
  pt: 'Portuguese',
};
const HY_MT_DECODING_PROFILES = {
  greedy: {
    temperature: 0,
    top_k: 0,
    top_p: 1,
    min_p: 0,
    repeat_penalty: 1,
  },
  'tencent-recommended': {
    temperature: 0.7,
    top_k: 20,
    top_p: 0.6,
    min_p: 0,
    repeat_penalty: 1.05,
  },
};

const args = parseArgs(process.argv.slice(2));
const model = requiredArg(args, 'model');
const direction = requiredArg(args, 'direction');
const inputPath = resolve(requiredArg(args, 'input'));
const outputPath = resolve(requiredArg(args, 'output'));
const inputFormat = args.format ?? 'jsonl';
const [sourceLanguage, targetLanguage, extraLanguage] = direction.split('-');

if (
  extraLanguage !== undefined ||
  !LANGUAGE_NAMES[sourceLanguage] ||
  !LANGUAGE_NAMES[targetLanguage]
) {
  throw new Error(`Unsupported direction: ${direction}`);
}
if (!['bergamot', 'hy-mt'].includes(model)) {
  throw new Error(`Unsupported --model ${model}; expected bergamot or hy-mt.`);
}
if (!['jsonl', 'markdown'].includes(inputFormat)) {
  throw new Error(`Unsupported --format ${inputFormat}; expected jsonl or markdown.`);
}

const input = await loadInput(
  inputPath,
  inputFormat,
  sourceLanguage,
  targetLanguage,
  args['marker-mode'],
);
const started = performance.now();
const result =
  model === 'bergamot'
    ? await translateWithBergamot(input.texts, sourceLanguage, targetLanguage)
    : await translateWithHyMt(input.texts, targetLanguage, args);
const wallMs = performance.now() - started;

if (inputFormat === 'jsonl') {
  const rows = input.rows.map((row, index) => ({
    ...row,
    translation: result.translations[index],
    elapsedMs: result.itemTimings[index]?.elapsedMs ?? null,
    predictedTokens: result.itemTimings[index]?.predictedTokens ?? null,
    promptTokens: result.itemTimings[index]?.promptTokens ?? null,
  }));
  await writeFile(outputPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
} else {
  let translatedMarkdown = null;
  let sourceUnitsKept = null;
  let rebuildError = null;
  try {
    const rebuilt = input.segmentation.rebuildTranslatedMarkdown(
      input.segments,
      result.translations,
    );
    translatedMarkdown = typeof rebuilt === 'string' ? rebuilt : rebuilt.text;
    sourceUnitsKept = typeof rebuilt === 'string' ? 0 : rebuilt.sourceUnitsKept;
  } catch (error) {
    rebuildError = error instanceof Error ? error.message : String(error);
  }
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        sourcePath: inputPath,
        model,
        direction,
        wallMs,
        engineTiming: result.engineTiming,
        itemTimings: result.itemTimings,
        sourceMarkdown: input.sourceMarkdown,
        translatedMarkdown,
        sourceUnitsKept,
        rebuildError,
        translations: result.translations,
      },
      null,
      2,
    )}\n`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    model,
    direction,
    inputFormat,
    items: input.texts.length,
    output: outputPath,
    wallMs: Math.round(wallMs),
    engineTiming: result.engineTiming,
  })}\n`,
);

async function loadInput(path, format, source, target, markerMode) {
  const raw = await readFile(path, 'utf8');
  if (format === 'jsonl') {
    const rows = raw
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    for (const [index, row] of rows.entries()) {
      if (typeof row.source !== 'string') {
        throw new Error(`Input row ${index + 1} does not contain a string source.`);
      }
    }
    return { rows, texts: rows.map((row) => row.source) };
  }

  const segmentation = await loadSegmentationModule();
  if (markerMode !== undefined && !['private-use', 'synthetic-url'].includes(markerMode)) {
    throw new Error(
      `Unsupported --marker-mode ${markerMode}; expected private-use or synthetic-url.`,
    );
  }
  const segments = segmentation.segmentMarkdownForTranslation(raw, {
    protectedMarkerMode: markerMode ?? segmentation.protectedMarkerModeForLanguages(source, target),
  });
  return {
    sourceMarkdown: raw,
    segmentation,
    segments,
    texts: segmentation.translatableTexts(segments),
  };
}

async function translateWithHyMt(texts, targetLanguage, options) {
  const endpoint = (options.endpoint ?? 'http://127.0.0.1:18080').replace(/\/$/u, '');
  const targetName = LANGUAGE_NAMES[targetLanguage];
  const decodingProfile = options.decoding ?? 'tencent-recommended';
  const decoding = HY_MT_DECODING_PROFILES[decodingProfile];
  if (decoding === undefined) {
    throw new Error(
      `Unsupported --decoding ${decodingProfile}; expected ${Object.keys(HY_MT_DECODING_PROFILES).join(' or ')}.`,
    );
  }
  const seed = Number(options.seed ?? 42);
  const concurrency = Number(options.concurrency ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('--concurrency must be a positive integer.');
  }
  const translations = Array.from({ length: texts.length });
  const itemTimings = Array.from({ length: texts.length });
  let nextIndex = 0;

  const translateNext = async () => {
    while (nextIndex < texts.length) {
      const index = nextIndex;
      nextIndex += 1;
      const text = texts[index];
      const prompt = `Translate the following segment into ${targetName}, without additional explanation.\n\n${text}`;
      const started = performance.now();
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          ...decoding,
          seed,
          max_tokens: Number(options['max-tokens'] ?? 512),
          stream: false,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `HY-MT request ${index + 1}/${texts.length} failed: ${response.status} ${await response.text()}`,
        );
      }
      const body = await response.json();
      const translation = body.choices?.[0]?.message?.content;
      if (typeof translation !== 'string') {
        throw new Error(`HY-MT request ${index + 1}/${texts.length} returned no message content.`);
      }
      translations[index] = translation.trim();
      itemTimings[index] = {
        elapsedMs: performance.now() - started,
        predictedTokens: body.timings?.predicted_n ?? body.usage?.completion_tokens ?? null,
        promptTokens: body.timings?.prompt_n ?? body.usage?.prompt_tokens ?? null,
        predictedTokensPerSecond: body.timings?.predicted_per_second ?? null,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, translateNext));
  return {
    translations,
    itemTimings,
    engineTiming: { decodingProfile, decoding, seed, concurrency },
  };
}

async function translateWithBergamot(texts, sourceLanguage, targetLanguage) {
  const catalog = JSON.parse(await readFile('native/catalog.json', 'utf8'));
  const catalogModel = catalog.models.find(
    (candidate) =>
      candidate.runtimeId === MODEL_TRIPLE.runtimeId &&
      candidate.familyId === MODEL_TRIPLE.familyId &&
      candidate.modelId === MODEL_TRIPLE.modelId,
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

  const pairPrefix = `${sourceLanguage}_${targetLanguage}`;
  const requireArtifact = (artifactId) => {
    const artifact = catalogModel.artifacts.find(
      (candidate) => candidate.artifactId === artifactId,
    );
    if (artifact === undefined) {
      throw new Error(`The catalog model is missing ${artifactId}.`);
    }
    const installed = metadata.artifacts.some(
      (candidate) =>
        candidate.artifactId === artifact.artifactId &&
        candidate.filename === artifact.filename &&
        candidate.sha256 === artifact.sha256,
    );
    if (!installed) {
      throw new Error(`The managed installation does not match catalog artifact ${artifactId}.`);
    }
    return artifact;
  };

  const runtime = requireArtifact('runtime');
  const runtimeGlue = requireArtifact('runtime_glue');
  const pairModel = requireArtifact(`${pairPrefix}_model`);
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
      readBytes(join(installDir, pairModel.filename)),
      readBytes(join(installDir, lexicon.filename)),
      ...vocabularies.map((artifact) => readBytes(join(installDir, artifact.filename))),
    ]);
  const readMs = performance.now() - startedReading;
  const bridge = `
const { parentPort } = require('node:worker_threads');
globalThis.postMessage = (message) => parentPort.postMessage(message);
globalThis.self = globalThis;
parentPort.on('message', (data) => globalThis.onmessage({ data }));
`;
  const worker = new Worker(`${bridge}\n${glueSource}\n${workerSource}`, { eval: true });
  const request = {
    type: 'translate',
    requestId: crypto.randomUUID(),
    sourceLanguage,
    targetLanguage,
    texts,
    wasmBinary,
    model: modelBytes,
    lexicon: lexiconBytes,
    vocabularies: vocabularyBytes,
  };
  const startedInference = performance.now();
  try {
    const complete = await runBergamotTranslation(worker, request, startedInference);
    return {
      translations: complete.translations,
      itemTimings: complete.translations.map(() => ({
        elapsedMs: null,
        predictedTokens: null,
        promptTokens: null,
      })),
      engineTiming: {
        readMs,
        readyMs: complete.readyMs,
        inferenceMs: performance.now() - startedInference,
      },
    };
  } finally {
    await worker.terminate();
  }
}

function runBergamotTranslation(worker, request, startedInference) {
  return new Promise((resolvePromise, reject) => {
    let readyMs = null;
    const timeout = setTimeout(() => {
      reject(new Error('Bergamot translation timed out after 10 minutes.'));
    }, 600_000);
    const fail = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    worker.once('error', fail);
    worker.on('message', (response) => {
      if (response.requestId !== request.requestId) return;
      if (response.type === 'ready') {
        readyMs = performance.now() - startedInference;
        return;
      }
      if (response.type === 'error') {
        fail(new Error(response.message));
        return;
      }
      if (response.type === 'complete') {
        clearTimeout(timeout);
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
  if (source === undefined) throw new Error('Failed to bundle Markdown translation segmentation.');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
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
  if (!value) {
    throw new Error(
      `Missing --${key}. Example: node ${process.argv[1]} --model hy-mt --direction en-nl ` +
        '--input samples.jsonl --output translations.jsonl',
    );
  }
  return value;
}
