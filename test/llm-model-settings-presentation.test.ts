import { describe, expect, it } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { resolveModelSettingsPresentation } from '../src/ui/llm-model-settings-presentation';

describe('resolveModelSettingsPresentation', () => {
  it('applies only temperature to local routing', () => {
    const presentation = resolveModelSettingsPresentation({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessTemperature: 0.4,
      llmRemoteFeaturesEnabled: true,
      llmRemoteThresholdChars: 12_345,
      llmRemoteTimeoutSec: 91,
      llmRouting: 'local',
    });

    expect(presentation).toEqual({
      remoteThresholdChars: null,
      remoteTimeoutSec: null,
      temperature: { presetLabel: null, value: 0.4 },
    });
  });

  it('applies temperature and timeout to remote routing', () => {
    const presentation = resolveModelSettingsPresentation({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessTemperature: 0.4,
      llmRemoteFeaturesEnabled: true,
      llmRemoteThresholdChars: 12_345,
      llmRemoteTimeoutSec: 91,
      llmRouting: 'remote',
    });

    expect(presentation).toEqual({
      remoteThresholdChars: null,
      remoteTimeoutSec: 91,
      temperature: { presetLabel: null, value: 0.4 },
    });
  });

  it('applies temperature, threshold, and timeout to automatic routing', () => {
    const presentation = resolveModelSettingsPresentation({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessTemperature: 0.4,
      llmRemoteFeaturesEnabled: true,
      llmRemoteThresholdChars: 12_345,
      llmRemoteTimeoutSec: 91,
      llmRouting: 'auto',
    });

    expect(presentation).toEqual({
      remoteThresholdChars: 12_345,
      remoteTimeoutSec: 91,
      temperature: { presetLabel: null, value: 0.4 },
    });
  });

  it('keeps remote settings inapplicable when remote features are disabled', () => {
    const presentation = resolveModelSettingsPresentation({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessTemperature: 0.4,
      llmRemoteFeaturesEnabled: false,
      llmRemoteThresholdChars: 12_345,
      llmRemoteTimeoutSec: 91,
      llmRouting: 'auto',
    });

    expect(presentation).toEqual({
      remoteThresholdChars: null,
      remoteTimeoutSec: null,
      temperature: { presetLabel: null, value: 0.4 },
    });
  });
});
