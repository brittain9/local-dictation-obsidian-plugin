import { describe, expect, it } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { resolveEffectiveTransformTiming } from '../src/ui/llm-preset-overrides';
import { describeTimestampTransformInteraction } from '../src/ui/llm-timing-settings-presentation';
import { validateBoundedNumber } from '../src/ui/validated-number-setting';

describe('resolveEffectiveTransformTiming', () => {
  it('uses timing pinned by the active preset', () => {
    expect(
      resolveEffectiveTransformTiming({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmPostprocessActivePresetRef: 'builtin:tldr',
        llmPostprocessMode: 'per_utterance',
      }),
    ).toBe('batch');
  });

  it('uses the remembered timing while transformation is off', () => {
    expect(
      resolveEffectiveTransformTiming({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmPostprocessLastEnabledMode: 'batch',
        llmPostprocessMode: 'off',
      }),
    ).toBe('batch');
  });
});

describe('describeTimestampTransformInteraction', () => {
  it('omits timestamp guidance when timestamps are disabled', () => {
    expect(describeTimestampTransformInteraction(DEFAULT_PLUGIN_SETTINGS)).toBeNull();
  });

  it.each([
    ['per_utterance', 'After each phrase preserves timestamp boundaries.'],
    ['batch', 'All at once may rewrite or remove timestamps, depending on the preset.'],
  ] as const)('describes the %s transform interaction', (mode, expected) => {
    expect(
      describeTimestampTransformInteraction({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmPostprocessMode: mode,
        timestampsEnabled: true,
      }),
    ).toBe(expected);
  });
});

describe('validateBoundedNumber', () => {
  it('rejects partial and fractional integer input', () => {
    const options = { integer: true, max: 30_000, min: 0 };

    expect(validateBoundedNumber('7000 chars', options).valid).toBe(false);
    expect(validateBoundedNumber('7.5', options).valid).toBe(false);
  });

  it('rejects out-of-range input and accepts an in-range boundary', () => {
    const options = { integer: true, max: 60_000, min: 500 };

    expect(validateBoundedNumber('499', options).valid).toBe(false);
    expect(validateBoundedNumber('500', options)).toEqual({ valid: true, value: 500 });
  });

  it('accepts decimal temperature but rejects exponent notation', () => {
    const options = { max: 2, min: 0 };

    expect(validateBoundedNumber('0.25', options)).toEqual({ valid: true, value: 0.25 });
    expect(validateBoundedNumber('1e0', options).valid).toBe(false);
  });
});
