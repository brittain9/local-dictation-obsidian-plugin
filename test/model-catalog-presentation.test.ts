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
});
