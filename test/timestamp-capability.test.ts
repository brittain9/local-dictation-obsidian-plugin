import { describe, expect, it } from 'vitest';

import type { ModelFamilyCapabilitiesRecord } from '../src/models/model-management-types';
import { timestampCapabilityPresentation } from '../src/settings/timestamp-capability';

function capabilities(
  overrides: Partial<ModelFamilyCapabilitiesRecord> = {},
): ModelFamilyCapabilitiesRecord {
  return {
    maxAudioDurationSecs: null,
    producesPunctuation: true,
    supportedLanguages: { kind: 'english_only' },
    supportsInitialPrompt: false,
    supportsLanguageSelection: false,
    supportsSegmentTimestamps: false,
    supportsStreaming: false,
    supportsWordTimestamps: false,
    ...overrides,
  };
}

describe('timestampCapabilityPresentation', () => {
  it('prefers word timing when the selected model supports it', () => {
    expect(
      timestampCapabilityPresentation(
        capabilities({ supportsSegmentTimestamps: true, supportsWordTimestamps: true }),
      ),
    ).toMatchObject({
      detailedOptionLabel: 'Every word · model timed',
      support: 'word',
    });
  });

  it('uses segment timing when that is the finest model timing', () => {
    expect(
      timestampCapabilityPresentation(capabilities({ supportsSegmentTimestamps: true })),
    ).toMatchObject({
      detailedOptionLabel: 'Every model segment',
      support: 'segment',
    });
  });

  it('explains the phrase fallback for untimed models', () => {
    const presentation = timestampCapabilityPresentation(capabilities());

    expect(presentation.support).toBe('unavailable');
    expect(presentation.detailedDescription).toContain('fall back');
  });
});
