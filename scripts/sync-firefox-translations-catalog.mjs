import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MODEL_ID = 'firefox_translations_release_2026_07';
const MODEL_REGISTRY_URL =
  'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json';
const REMOTE_SETTINGS_URL =
  'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records';
const ATTACHMENT_BASE_URL = 'https://firefox-settings-attachments.cdn.mozilla.net/';

const catalogPath = resolve(process.argv[2] ?? 'native/catalog.json');
const shouldWrite = process.argv.includes('--write');

const [registryResponse, remoteSettingsResponse] = await Promise.all([
  fetch(MODEL_REGISTRY_URL),
  fetch(REMOTE_SETTINGS_URL),
]);
if (!registryResponse.ok || !remoteSettingsResponse.ok) {
  throw new Error(
    `Mozilla catalog fetch failed: ${registryResponse.status}/${remoteSettingsResponse.status}`,
  );
}

const [{ models }, { data: remoteRecords }] = await Promise.all([
  registryResponse.json(),
  remoteSettingsResponse.json(),
]);
const selectedPairs = selectBidirectionalEnglishPairs(models);
const pairArtifacts = selectedPairs.flatMap((pair) => resolveArtifacts(pair, remoteRecords));
const pairs = selectedPairs.map(({ model }) => ({
  source: toProductLanguage(model.sourceLanguage),
  target: toProductLanguage(model.targetLanguage),
}));
const languages = [...new Set(pairs.flatMap(({ source, target }) => [source, target]))].sort(
  (left, right) => (left === 'en' ? -1 : right === 'en' ? 1 : left.localeCompare(right)),
);

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const model = catalog.models.find((candidate) => candidate.modelId === MODEL_ID);
if (model === undefined) throw new Error(`Catalog model ${MODEL_ID} is missing.`);
const sharedArtifacts = model.artifacts
  .filter((artifact) => artifact.artifactId === 'runtime' || artifact.artifactId === 'runtime_glue')
  .map((artifact) => ({
    ...artifact,
    required: true,
    role: artifact.artifactId === 'runtime' ? 'translation_model' : 'supporting_file',
  }));
if (sharedArtifacts.length !== 2) throw new Error('Firefox shared runtime artifacts are missing.');

model.summary =
  'Fast local translation with small, on-demand language downloads using models released in Firefox.';
model.languageTags = languages;
model.translationSupport = { kind: 'pairs', pairs };
model.translationPacks = pairs.map(({ source, target }) => ({
  artifactIds: pairArtifacts
    .filter((artifact) => artifact.source === source && artifact.target === target)
    .map((artifact) => artifact.artifactId),
  source,
  target,
}));
model.notes = [
  `Includes ${pairs.length} released English-anchored directions across ${languages.length} languages.`,
  'Only the selected direction is downloaded. The Bergamot WebAssembly runtime is shared across installed directions.',
  'The models, vocabularies, lexicons, and Bergamot runtime are SHA-256 pinned.',
  'Inference runs locally in an isolated WebAssembly worker. Network access is used only for explicit installation.',
];
model.artifacts = [
  ...pairArtifacts.map(({ source: _source, target: _target, ...artifact }) => artifact),
  ...sharedArtifacts,
];
catalog.catalogVersion = Math.max(catalog.catalogVersion, 9);

const output = `${JSON.stringify(catalog, null, 2)}\n`;
if (shouldWrite) await writeFile(catalogPath, output);

console.log(
  JSON.stringify(
    {
      artifactCount: pairArtifacts.length,
      catalogPath,
      languageCount: languages.length,
      pairCount: pairs.length,
      pairDownloadBytes: pairArtifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0),
      wrote: shouldWrite,
    },
    null,
    2,
  ),
);

function canonicalMozillaLanguage(language) {
  return language === 'no' ? 'nb' : language;
}

function toProductLanguage(language) {
  const canonical = canonicalMozillaLanguage(language);
  return canonical === 'zh_hant' ? 'zh-Hant' : canonical;
}

function toRemoteSettingsLanguage(language) {
  const canonical = canonicalMozillaLanguage(language);
  return canonical === 'zh' ? 'zh-Hans' : canonical === 'zh_hant' ? 'zh-Hant' : canonical;
}

function releaseRank(model) {
  if (model.releaseStatus === 'Release Desktop') return 3;
  if (model.architecture === 'base-memory') return 2;
  if (model.architecture === 'base') return 1;
  return 0;
}

function selectReleasedModel(entries) {
  return (
    entries
      .filter((entry) => /^Release(?: |$)/u.test(entry.releaseStatus ?? ''))
      .sort((left, right) => releaseRank(right) - releaseRank(left))[0] ?? null
  );
}

function selectBidirectionalEnglishPairs(models) {
  const selected = Object.entries(models)
    .map(([direction, entries]) => ({ direction, model: selectReleasedModel(entries) }))
    .filter(({ model }) => model !== null)
    .filter(({ model }) => model.sourceLanguage === 'en' || model.targetLanguage === 'en')
    .map(({ direction, model }) => ({
      direction,
      model: {
        ...model,
        sourceLanguage: canonicalMozillaLanguage(model.sourceLanguage),
        targetLanguage: canonicalMozillaLanguage(model.targetLanguage),
      },
    }));
  const deduplicated = new Map();
  for (const pair of selected) {
    const key = `${pair.model.sourceLanguage}-${pair.model.targetLanguage}`;
    const existing = deduplicated.get(key);
    if (
      existing === undefined ||
      existing.direction.includes('-no') ||
      existing.direction.startsWith('no-')
    ) {
      deduplicated.set(key, pair);
    }
  }
  const byLanguage = new Map();
  for (const pair of deduplicated.values()) {
    const language =
      pair.model.sourceLanguage === 'en' ? pair.model.targetLanguage : pair.model.sourceLanguage;
    const languagePairs = byLanguage.get(language) ?? [];
    languagePairs.push(pair);
    byLanguage.set(language, languagePairs);
  }
  return [...byLanguage.values()]
    .filter((languagePairs) => languagePairs.some(({ model }) => model.sourceLanguage === 'en'))
    .filter((languagePairs) => languagePairs.some(({ model }) => model.targetLanguage === 'en'))
    .flat()
    .sort(({ direction: left }, { direction: right }) => left.localeCompare(right));
}

function resolveArtifacts(pair, remoteRecords) {
  const source = toProductLanguage(pair.model.sourceLanguage);
  const target = toProductLanguage(pair.model.targetLanguage);
  const remoteSource = toRemoteSettingsLanguage(pair.model.sourceLanguage);
  const remoteTarget = toRemoteSettingsLanguage(pair.model.targetLanguage);
  const modelRecord = remoteRecords.find(
    (record) =>
      record.fromLang === remoteSource &&
      record.toLang === remoteTarget &&
      record.fileType === 'model' &&
      record.attachment.hash === pair.model.files.model.uncompressedHash,
  );
  if (modelRecord === undefined) throw new Error(`Missing model artifact for ${pair.direction}.`);

  return Object.keys(pair.model.files).map((fileKey) => {
    const fileType = artifactType(fileKey);
    const record =
      fileKey === 'model'
        ? modelRecord
        : remoteRecords.find(
            (candidate) =>
              candidate.fromLang === remoteSource &&
              candidate.toLang === remoteTarget &&
              candidate.fileType === fileType &&
              candidate.version === modelRecord.version,
          );
    if (record === undefined) {
      throw new Error(
        `Missing ${fileType} artifact for ${pair.direction} v${modelRecord.version}.`,
      );
    }
    return {
      artifactId: `${source}_${target}_${artifactSuffix(fileKey)}`,
      downloadUrl: `${ATTACHMENT_BASE_URL}${record.attachment.location}`,
      filename: `${source}-${target}/${record.attachment.filename}`,
      required: false,
      role: fileKey === 'model' ? 'translation_model' : 'supporting_file',
      sha256: record.attachment.hash,
      sizeBytes: record.attachment.size,
      source,
      target,
    };
  });
}

function artifactType(fileKey) {
  return {
    lexicalShortlist: 'lex',
    model: 'model',
    srcVocab: 'srcvocab',
    trgVocab: 'trgvocab',
    vocab: 'vocab',
  }[fileKey];
}

function artifactSuffix(fileKey) {
  return {
    lexicalShortlist: 'lexicon',
    model: 'model',
    srcVocab: 'source_vocabulary',
    trgVocab: 'target_vocabulary',
    vocab: 'vocabulary',
  }[fileKey];
}
