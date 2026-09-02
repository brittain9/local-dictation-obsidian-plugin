import type {
  CatalogModelRecord,
  InstalledModelRecord,
  ModelArtifactRecord,
  TranslationPackRecord,
} from '../models/model-management-types';
import type { TranslationLanguage } from './languages';

export type TranslationInstallRequirement =
  | { kind: 'ready' }
  | {
      artifactIds: string[];
      downloadBytes: number;
      kind: 'pack';
    }
  | { kind: 'model'; downloadBytes: number };

export function findTranslationPack(
  model: Pick<CatalogModelRecord, 'translationPacks'>,
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): TranslationPackRecord | null {
  return (
    model.translationPacks?.find(
      (pack) => pack.source === sourceLanguage && pack.target === targetLanguage,
    ) ?? null
  );
}

export function translationInstallRequirement(
  model: CatalogModelRecord,
  installed: InstalledModelRecord | null,
  sourceLanguage: TranslationLanguage,
  targetLanguage: TranslationLanguage,
): TranslationInstallRequirement {
  const pack = findTranslationPack(model, sourceLanguage, targetLanguage);
  if (pack === null) {
    return installed === null
      ? { downloadBytes: requiredArtifacts(model).reduce(sumArtifactBytes, 0), kind: 'model' }
      : { kind: 'ready' };
  }

  const installedIds = new Set(installed?.installedArtifactIds ?? []);
  const missingRequired = requiredArtifacts(model).filter(
    (artifact) => !installedIds.has(artifact.artifactId),
  );
  const missingPack = pack.artifactIds
    .map((artifactId) => model.artifacts.find((artifact) => artifact.artifactId === artifactId))
    .filter((artifact): artifact is ModelArtifactRecord => {
      return artifact !== undefined && !installedIds.has(artifact.artifactId);
    });
  const missing = [...missingRequired, ...missingPack];
  if (missing.length === 0) return { kind: 'ready' };

  return {
    artifactIds: pack.artifactIds,
    downloadBytes: missing.reduce(sumArtifactBytes, 0),
    kind: 'pack',
  };
}

export function installedTranslationPackCount(
  model: Pick<CatalogModelRecord, 'translationPacks'>,
  installed: InstalledModelRecord | null,
): number {
  if (installed === null || model.translationPacks === undefined) return 0;
  const installedIds = new Set(installed.installedArtifactIds);
  return model.translationPacks.filter((pack) =>
    pack.artifactIds.every((artifactId) => installedIds.has(artifactId)),
  ).length;
}

function requiredArtifacts(model: Pick<CatalogModelRecord, 'artifacts'>): ModelArtifactRecord[] {
  return model.artifacts.filter((artifact) => artifact.required);
}

function sumArtifactBytes(total: number, artifact: ModelArtifactRecord): number {
  return total + artifact.sizeBytes;
}
