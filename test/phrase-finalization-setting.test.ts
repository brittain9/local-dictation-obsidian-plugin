import { describe, expect, it } from 'vitest';

import { phraseFinalizationDescription } from '../src/settings/phrase-finalization-setting';

describe('phraseFinalizationDescription', () => {
  it.each([
    ['responsive', 'shorter pauses', 'faster completed text'],
    ['balanced', 'standard pause tolerance', 'everyday dictation'],
    ['patient', 'longer pauses', 'less likely to be split'],
  ] as const)('explains the %s trade-off', (style, timing, outcome) => {
    const description = phraseFinalizationDescription(style);

    expect(description).toContain(timing);
    expect(description).toContain(outcome);
  });

  it.each([
    'responsive',
    'balanced',
    'patient',
  ] as const)('makes live-model behavior explicit for %s', (style) => {
    expect(phraseFinalizationDescription(style)).toContain(
      'every transcription model, including live models',
    );
  });
});
