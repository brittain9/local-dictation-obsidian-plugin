import type { CatalogModelRecord, ModelArtifactRecord } from '../models/model-management-types';

/** The installed pack is missing a file the selected language pair needs. */
export class TranslationModelIncompleteError extends Error {
  constructor(readonly artifactId: string) {
    super(`The installed translation model is missing ${artifactId}.`);
    this.name = 'TranslationModelIncompleteError';
  }
}

export interface TranslationPairArtifacts {
  lexicon: ModelArtifactRecord;
  model: ModelArtifactRecord;
  runtime: ModelArtifactRecord;
  runtimeGlue: ModelArtifactRecord;
  vocabularies: ModelArtifactRecord[];
}

/**
 * Resolves every artifact one language pair needs. Shared by the plugin worker
 * client and the real-model end-to-end check so both load the same files.
 */
export function resolveTranslationPairArtifacts(
  model: Pick<CatalogModelRecord, 'artifacts'>,
  sourceLanguage: string,
  targetLanguage: string,
): TranslationPairArtifacts {
  const pairPrefix = `${sourceLanguage}_${targetLanguage}`;
  return {
    lexicon: requireArtifact(model, `${pairPrefix}_lexicon`),
    model: requireArtifact(model, `${pairPrefix}_model`),
    runtime: requireArtifact(model, 'runtime'),
    runtimeGlue: requireArtifact(model, 'runtime_glue'),
    vocabularies: resolveVocabularyArtifacts(model, pairPrefix),
  };
}

function requireArtifact(
  model: Pick<CatalogModelRecord, 'artifacts'>,
  artifactId: string,
): ModelArtifactRecord {
  const artifact = model.artifacts.find((candidate) => candidate.artifactId === artifactId);
  if (artifact === undefined) throw new TranslationModelIncompleteError(artifactId);
  return artifact;
}

// Most pairs ship one shared vocabulary; Japanese ships separate source and
// target vocabularies.
function resolveVocabularyArtifacts(
  model: Pick<CatalogModelRecord, 'artifacts'>,
  pairPrefix: string,
): ModelArtifactRecord[] {
  const shared = model.artifacts.find(
    (artifact) => artifact.artifactId === `${pairPrefix}_vocabulary`,
  );
  if (shared !== undefined) return [shared];
  return [
    requireArtifact(model, `${pairPrefix}_source_vocabulary`),
    requireArtifact(model, `${pairPrefix}_target_vocabulary`),
  ];
}
