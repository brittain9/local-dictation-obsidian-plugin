import { describe, expect, it } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import {
  didReadAloudSettingsChange,
  resolveReadAloudVoiceId,
} from '../src/tts/read-aloud-selection';

describe('resolveReadAloudVoiceId', () => {
  it('uses the persisted voice when one is selected', () => {
    expect(resolveReadAloudVoiceId('cosette', 'alba')).toBe('cosette');
  });

  it('uses the model default consistently when no voice is selected', () => {
    expect(resolveReadAloudVoiceId(null, 'alba')).toBe('alba');
  });

  it('returns null when neither source defines a voice', () => {
    expect(resolveReadAloudVoiceId(null, undefined)).toBeNull();
  });
});

describe('didReadAloudSettingsChange', () => {
  it.each([
    ['speed', { ttsSpeed: 1.5 }],
    ['voice', { selectedTtsVoice: 'cosette' }],
    [
      'model',
      {
        selectedTtsModel: {
          familyId: 'pocket_tts',
          kind: 'catalog_model' as const,
          modelId: 'pocket_tts_french_24l_int8',
          runtimeId: 'onnx_runtime',
        },
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, Partial<typeof DEFAULT_PLUGIN_SETTINGS>]>)(
    'detects a %s change that must restart active reading',
    (_label, change) => {
      expect(
        didReadAloudSettingsChange(DEFAULT_PLUGIN_SETTINGS, {
          ...DEFAULT_PLUGIN_SETTINGS,
          ...change,
        }),
      ).toBe(true);
    },
  );

  it('ignores unrelated settings changes', () => {
    expect(
      didReadAloudSettingsChange(DEFAULT_PLUGIN_SETTINGS, {
        ...DEFAULT_PLUGIN_SETTINGS,
        developerMode: !DEFAULT_PLUGIN_SETTINGS.developerMode,
      }),
    ).toBe(false);
  });
});
