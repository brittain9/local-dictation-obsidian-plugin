import { describe, expect, it } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import {
  describeAdvancedModelSettings,
  resolveModelSettingsPresentation,
} from '../src/ui/llm-model-settings-presentation';

describe('resolveModelSettingsPresentation', () => {
  it('shows only temperature for fixed Ollama routing', () => {
    expect(
      resolveModelSettingsPresentation({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmPostprocessTemperature: 0.4,
        llmRoutingPolicy: { kind: 'fixed', providerId: 'ollama' },
      }),
    ).toEqual({
      networkTimeoutSec: null,
      temperature: { presetLabel: null, value: 0.4 },
    });
  });

  it.each(['openrouter', 'openai_compatible'] as const)(
    'shows network timeout for fixed %s routing',
    (providerId) => {
      expect(
        resolveModelSettingsPresentation({
          ...DEFAULT_PLUGIN_SETTINGS,
          llmNetworkTimeoutSec: 91,
          llmRoutingPolicy: { kind: 'fixed', providerId },
        }),
      ).toMatchObject({ networkTimeoutSec: 91 });
    },
  );

  it('shows timeout when either size-routing leg uses the network', () => {
    expect(
      resolveModelSettingsPresentation({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmNetworkTimeoutSec: 91,
        llmRoutingPolicy: {
          defaultProviderId: 'ollama',
          kind: 'transcript_size',
          largeTranscriptProviderId: 'openrouter',
          thresholdChars: 12_345,
        },
      }),
    ).toMatchObject({ networkTimeoutSec: 91 });
  });

  it('explains that temperature is shared without repeating routing policy', () => {
    const description = describeAdvancedModelSettings({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessTemperature: 0.3,
      llmRoutingPolicy: {
        defaultProviderId: 'ollama',
        kind: 'transcript_size',
        largeTranscriptProviderId: 'openrouter',
        thresholdChars: 6_000,
      },
    });

    expect(description).toBe('Temperature 0.3 for both providers · 60s network timeout');
    expect(description).not.toContain('6,000');
  });

  it('does not mention provider sharing for a fixed route', () => {
    expect(
      describeAdvancedModelSettings({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmPostprocessTemperature: 0.3,
        llmRoutingPolicy: { kind: 'fixed', providerId: 'openai_compatible' },
      }),
    ).toBe('Temperature 0.3 · 60s network timeout');
  });
});
