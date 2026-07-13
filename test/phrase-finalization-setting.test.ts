import { describe, expect, it } from 'vitest';

import {
  PHRASE_FINALIZATION_TOOLTIP,
  phraseFinalizationDescription,
} from '../src/settings/phrase-finalization-setting';

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

  it('keeps shared model behavior in the tooltip', () => {
    expect(PHRASE_FINALIZATION_TOOLTIP).toContain('every transcription model');
    expect(PHRASE_FINALIZATION_TOOLTIP).toContain('Live words can still update');
  });
});
