import { describe, expect, it } from 'vitest';

import type {
  CatalogModelRecord,
  InstalledModelRecord,
} from '../src/models/model-management-types';
import {
  installedTranslationPackCount,
  translationInstallRequirement,
} from '../src/translation/translation-packs';

const model = {
  artifacts: [
    artifact('runtime', 5, true),
    artifact('runtime_glue', 1, true),
    artifact('en_zh_model', 30),
    artifact('en_zh_vocabulary', 2),
    artifact('en_zh_lexicon', 3),
    artifact('zh_en_model', 31),
    artifact('zh_en_vocabulary', 2),
    artifact('zh_en_lexicon', 4),
  ],
  translationPacks: [
    {
      artifactIds: ['en_zh_model', 'en_zh_vocabulary', 'en_zh_lexicon'],
      source: 'en',
      target: 'zh',
    },
    {
      artifactIds: ['zh_en_model', 'zh_en_vocabulary', 'zh_en_lexicon'],
      source: 'zh',
      target: 'en',
    },
  ],
} as CatalogModelRecord;

describe('translation packs', () => {
  it('includes the shared runtime in the first direction download', () => {
    expect(translationInstallRequirement(model, null, 'en', 'zh')).toEqual({
      artifactIds: ['en_zh_model', 'en_zh_vocabulary', 'en_zh_lexicon'],
      downloadBytes: 41,
      kind: 'pack',
    });
  });

  it('charges only the missing direction after the shared runtime is installed', () => {
    const installed = installedModel([
      'runtime',
      'runtime_glue',
      'en_zh_model',
      'en_zh_vocabulary',
      'en_zh_lexicon',
    ]);

    expect(translationInstallRequirement(model, installed, 'zh', 'en')).toEqual({
      artifactIds: ['zh_en_model', 'zh_en_vocabulary', 'zh_en_lexicon'],
      downloadBytes: 37,
      kind: 'pack',
    });
    expect(installedTranslationPackCount(model, installed)).toBe(1);
  });

  it('reports an installed direction as ready without assuming its reverse is installed', () => {
    const installed = installedModel([
      'runtime',
      'runtime_glue',
      'en_zh_model',
      'en_zh_vocabulary',
      'en_zh_lexicon',
    ]);

    expect(translationInstallRequirement(model, installed, 'en', 'zh')).toEqual({ kind: 'ready' });
    expect(translationInstallRequirement(model, installed, 'zh', 'en').kind).toBe('pack');
  });
});

function artifact(artifactId: string, sizeBytes: number, required = false) {
  return {
    artifactId,
    downloadUrl: `https://example.com/${artifactId}`,
    filename: artifactId,
    required,
    role: artifactId.endsWith('_model')
      ? ('translation_model' as const)
      : ('supporting_file' as const),
    sha256: '0'.repeat(64),
    sizeBytes,
  };
}

function installedModel(installedArtifactIds: string[]): InstalledModelRecord {
  return {
    catalogVersion: 1,
    familyId: 'firefox_translations',
    installPath: '/models/firefox',
    installedArtifactIds,
    installedAtUnixMs: 1,
    installedVoiceIds: [],
    modelId: 'firefox',
    runtimeId: 'bergamot_wasm',
    runtimePath: '/models/firefox/runtime',
    totalSizeBytes: 1,
  };
}
