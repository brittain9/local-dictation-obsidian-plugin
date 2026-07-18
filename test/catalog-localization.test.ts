import { describe, expect, it } from 'vitest';

import catalog from '../native/catalog.json';
import { localizeFamilySummary, localizeModelSummary } from '../src/models/catalog-localization';

describe('catalog localization', () => {
  it('localizes known model and family summaries', () => {
    expect(localizeModelSummary('whisper_tiny_en_q8_0', 'wire fallback')).toBe(
      'Fastest model with lowest resource cost. Good for testing or low-power machines.',
    );
    expect(localizeFamilySummary('whisper', 'wire fallback')).toContain(
      'Whisper provides more accurate timestamps',
    );
  });

  it('preserves wire summaries for unknown future catalog ids', () => {
    expect(localizeModelSummary('future_model', 'Future model summary.')).toBe(
      'Future model summary.',
    );
    expect(localizeFamilySummary('future_family', 'Future family summary.')).toBe(
      'Future family summary.',
    );
  });

  it('maps every model and family in the shipped native catalog', () => {
    for (const model of catalog.models) {
      expect(localizeModelSummary(model.modelId, 'unmapped model'), model.modelId).not.toBe(
        'unmapped model',
      );
    }
    for (const family of catalog.families) {
      expect(localizeFamilySummary(family.familyId, 'unmapped family'), family.familyId).not.toBe(
        'unmapped family',
      );
    }
  });
});
