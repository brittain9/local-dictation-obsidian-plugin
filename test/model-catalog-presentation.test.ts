import { describe, expect, it } from 'vitest';

import catalog from '../native/catalog.json';

describe('model catalog presentation', () => {
  it('explains the Whisper timestamp advantage at the family level', () => {
    const whisper = catalog.families.find((family) => family.familyId === 'whisper');

    expect(whisper?.summary).toContain('more accurate timestamps than other model families');
    expect(whisper?.summary).toContain('word-level timing');
  });

  it('keeps artifact precision out of primary Whisper names', () => {
    const whisperModels = catalog.models.filter((model) => model.familyId === 'whisper');

    expect(whisperModels.map((model) => model.displayName)).toEqual([
      'Whisper Tiny',
      'Whisper Base',
      'Whisper Small',
      'Whisper Medium',
      'Whisper Large V3 Turbo',
    ]);
    for (const model of whisperModels) {
      expect(model.displayName).not.toMatch(/\b(?:English|Q\d)/u);
      expect(model.artifacts[0]?.filename).toMatch(/q(?:5|8)_\d/u);
    }
    expect(whisperModels.slice(0, 4).every((model) => model.languageTags.join() === 'en')).toBe(
      true,
    );
    expect(whisperModels[4]?.languageTags).toEqual([
      'en',
      'es',
      'de',
      'fr',
      'pt',
      'it',
      'nl',
      'ja',
      'hr',
      'sr',
    ]);
    expect(whisperModels[4]?.supportsAutomaticLanguageDetection).toBe(true);
  });

  it('does not use a generic recommendation tag', () => {
    for (const model of catalog.models) {
      const tags: readonly string[] = model.uxTags;
      expect(tags).not.toContain('starter');
    }
  });

  it('describes Cohere Q4 relative to its family, not as lightweight', () => {
    const model = catalog.models.find((candidate) => candidate.modelId === 'cohere_transcribe_q4');

    expect(model?.uxTags).toEqual(['smallest']);
    expect(
      model?.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0),
    ).toBeGreaterThan(2_000_000_000);
  });

  it('ships the pinned Apache-2.0 HY-MT 2 Q4 models with presentation-only resource metadata', () => {
    const models = catalog.models.filter((model) => model.familyId === 'tencent_hy_mt');
    expect(models.map((model) => model.modelId)).toEqual([
      'tencent_hy_mt_2_1_8b_q4_k_m',
      'tencent_hy_mt_2_7b_q4_k_m',
    ]);
    expect(
      models.map((model) => [model.artifacts[0]?.sizeBytes, model.artifacts[0]?.sha256]),
    ).toEqual([
      [1133080448, 'dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699'],
      [4624648896, '9f96256500f3fc1ab4d64336b58f52a949a95ad7516b0c229476eef782f9f77b'],
    ]);
    expect(models.every((model) => model.licenseLabel === 'Apache-2.0')).toBe(true);
    expect(
      models.every((model) =>
        model.licenseUrl.endsWith('/71928c82b61fc04e0289ad7eab1faf5ebef721b2/LICENSE.txt'),
      ),
    ).toBe(true);
    expect(models[0]?.summary).toContain('suitable for most local translation');
    expect(models[0]?.uxTags).not.toContain('heavy');
    expect(models[1]?.uxTags).toContain('heavy');
  });
});
