import { describe, expect, it } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { resolveModelSettingsPresentation } from '../src/ui/llm-model-settings-presentation';

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
      routingThresholdChars: null,
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
      ).toMatchObject({ networkTimeoutSec: 91, routingThresholdChars: null });
    },
  );

  it('shows threshold and timeout when either size-routing leg uses the network', () => {
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
    ).toMatchObject({ networkTimeoutSec: 91, routingThresholdChars: 12_345 });
  });

  it('shows threshold without timeout when both legs are non-networked adapters', () => {
    expect(
      resolveModelSettingsPresentation({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmRoutingPolicy: {
          defaultProviderId: 'ollama',
          kind: 'transcript_size',
          largeTranscriptProviderId: 'ollama',
          thresholdChars: 1_000,
        },
      }),
    ).toMatchObject({ networkTimeoutSec: null, routingThresholdChars: 1_000 });
  });
});
