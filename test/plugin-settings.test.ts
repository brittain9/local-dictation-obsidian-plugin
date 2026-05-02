import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LLM_POSTPROCESS_SYSTEM_SLOT,
  DEFAULT_PLUGIN_SETTINGS,
  resetLlmPostprocessDefaults,
  resolvePluginSettings,
} from '../src/settings/plugin-settings';

describe('resolvePluginSettings', () => {
  it('returns defaults when persisted data is missing', () => {
    expect(resolvePluginSettings(undefined)).toEqual(DEFAULT_PLUGIN_SETTINGS);
  });

  it('merges valid persisted values', () => {
    expect(
      resolvePluginSettings({
        accelerationPreference: 'cpu_only',
        cudaLibraryPath: ' /run/host/usr/lib64 ',
        dictationAnchor: 'end_of_note',
        listeningMode: 'always_on',
        llmPostprocessEnabled: true,
        llmPostprocessFormatSlot: 'Format exactly.',
        llmPostprocessGlossaryChars: 1200,
        llmPostprocessGlossarySlot: ' Keep AcronymX. ',
        llmPostprocessKeepAlive: ' 45m ',
        llmPostprocessModel: ' llama3.2:latest ',
        llmPostprocessNoteContextChars: 4000,
        llmPostprocessNumPredict: 800,
        llmPostprocessPriorUtterancesN: 3,
        llmPostprocessSeed: 42,
        llmPostprocessShowRawBelow: true,
        llmPostprocessSkipIfAvgLogprobAbove: -0.5,
        llmPostprocessSkipMinWords: 6,
        llmPostprocessSystemSlot: '  Keep exact whitespace.  ',
        llmPostprocessTemperature: 0.4,
        llmPostprocessTotalContextCap: 9000,
        llmPostprocessUserTemplate: '{{utterance}}\n{{unknown}}',
        llmPostprocessVoiceSlot: 'voice',
        modelStorePathOverride: ' /tmp/models ',
        selectedModel: {
          familyId: 'whisper',
          kind: 'catalog_model',
          modelId: 'whisper_large_v3_turbo_q8_0',
          runtimeId: 'whisper_cpp',
        },
        sidecarPathOverride: ' /tmp/sidecar ',
        sidecarRequestTimeoutSeconds: 12,
        sidecarStartupTimeoutSeconds: 6,
        showTimestamps: true,
        speakingStyle: 'patient',
        transcriptFormatting: 'new_paragraph',
        useNoteAsContext: false,
      }),
    ).toEqual({
      ...DEFAULT_PLUGIN_SETTINGS,
      accelerationPreference: 'cpu_only',
      cudaLibraryPath: '/run/host/usr/lib64',
      dictationAnchor: 'end_of_note',
      listeningMode: 'always_on',
      llmPostprocessEnabled: true,
      llmPostprocessFormatSlot: 'Format exactly.',
      llmPostprocessGlossaryChars: 1200,
      llmPostprocessGlossarySlot: ' Keep AcronymX. ',
      llmPostprocessKeepAlive: '45m',
      llmPostprocessModel: 'llama3.2:latest',
      llmPostprocessNoteContextChars: 4000,
      llmPostprocessNumPredict: 800,
      llmPostprocessPriorUtterancesN: 3,
      llmPostprocessSeed: 42,
      llmPostprocessShowRawBelow: true,
      llmPostprocessSkipIfAvgLogprobAbove: -0.5,
      llmPostprocessSkipMinWords: 6,
      llmPostprocessSystemSlot: '  Keep exact whitespace.  ',
      llmPostprocessTemperature: 0.4,
      llmPostprocessTotalContextCap: 9000,
      llmPostprocessUserTemplate: '{{utterance}}\n{{unknown}}',
      llmPostprocessVoiceSlot: 'voice',
      modelStorePathOverride: '/tmp/models',
      selectedModel: {
        familyId: 'whisper',
        kind: 'catalog_model',
        modelId: 'whisper_large_v3_turbo_q8_0',
        runtimeId: 'whisper_cpp',
      },
      sidecarPathOverride: '/tmp/sidecar',
      sidecarRequestTimeoutSeconds: 12,
      sidecarStartupTimeoutSeconds: 6,
      showTimestamps: true,
      speakingStyle: 'patient',
      transcriptFormatting: 'new_paragraph',
      useNoteAsContext: false,
    });
  });

  it.each([
    'at_cursor',
    'end_of_note',
  ] as const)('accepts the supported dictation anchor %s', (dictationAnchor) => {
    expect(resolvePluginSettings({ dictationAnchor }).dictationAnchor).toBe(dictationAnchor);
  });

  it.each([
    'smart',
    'space',
    'new_line',
    'new_paragraph',
  ] as const)('accepts the supported transcript formatting mode %s', (transcriptFormatting) => {
    expect(resolvePluginSettings({ transcriptFormatting }).transcriptFormatting).toBe(
      transcriptFormatting,
    );
  });

  it('does not accept removed llmTransform fields', () => {
    const resolved = resolvePluginSettings({
      llmTransformDeveloperMode: true,
      llmTransformEnabled: true,
      llmTransformModel: 'llama3',
      llmTransformPrompt: 'legacy',
    });

    expect(resolved.llmPostprocessEnabled).toBe(false);
    expect(resolved.llmPostprocessModel).toBe('');
    expect(resolved).not.toHaveProperty('llmTransformEnabled');
    expect(resolved).not.toHaveProperty('llmTransformPrompt');
  });

  it('silently drops legacy formatting fields without migrating them', () => {
    const resolved = resolvePluginSettings({
      insertionMode: 'append_as_new_paragraph',
      phraseSeparator: 'new_paragraph',
    });

    expect(resolved.dictationAnchor).toBe(DEFAULT_PLUGIN_SETTINGS.dictationAnchor);
    expect(resolved.transcriptFormatting).toBe(DEFAULT_PLUGIN_SETTINGS.transcriptFormatting);
    expect(resolved).not.toHaveProperty('insertionMode');
    expect(resolved).not.toHaveProperty('phraseSeparator');
  });

  it('falls back when persisted values are invalid', () => {
    expect(
      resolvePluginSettings({
        dictationAnchor: 'at_end',
        listeningMode: 'unsupported',
        llmPostprocessEnabled: 'yes',
        llmPostprocessKeepAlive: '',
        llmPostprocessModel: 123,
        llmPostprocessSystemSlot: false,
        modelStorePathOverride: 42,
        sidecarPathOverride: 12,
        sidecarRequestTimeoutSeconds: -1,
        sidecarStartupTimeoutSeconds: 'fast',
        showTimestamps: 'yes',
        transcriptFormatting: 'tab',
        useNoteAsContext: 'yes',
      }),
    ).toEqual(DEFAULT_PLUGIN_SETTINGS);
  });

  it('clamps LLM postprocess numeric settings at the settings boundary', () => {
    const low = resolvePluginSettings({
      llmPostprocessGlossaryChars: -1,
      llmPostprocessNoteContextChars: -1,
      llmPostprocessNumPredict: -1,
      llmPostprocessPriorUtterancesN: -1,
      llmPostprocessSeed: -9_999_999_999,
      llmPostprocessSkipMinWords: -1,
      llmPostprocessTemperature: -1,
      llmPostprocessTotalContextCap: -1,
    });
    const high = resolvePluginSettings({
      llmPostprocessGlossaryChars: 9_999,
      llmPostprocessNoteContextChars: 99_999,
      llmPostprocessNumPredict: 99_999,
      llmPostprocessPriorUtterancesN: 99,
      llmPostprocessSeed: 9_999_999_999,
      llmPostprocessSkipMinWords: 99,
      llmPostprocessTemperature: 99,
      llmPostprocessTotalContextCap: 99_999,
    });

    expect(low).toMatchObject({
      llmPostprocessGlossaryChars: 0,
      llmPostprocessNoteContextChars: 0,
      llmPostprocessNumPredict: 1,
      llmPostprocessPriorUtterancesN: 0,
      llmPostprocessSeed: -2_147_483_648,
      llmPostprocessSkipMinWords: 0,
      llmPostprocessTemperature: 0,
      llmPostprocessTotalContextCap: 0,
    });
    expect(high).toMatchObject({
      llmPostprocessGlossaryChars: 4_000,
      llmPostprocessNoteContextChars: 12_000,
      llmPostprocessNumPredict: 4_096,
      llmPostprocessPriorUtterancesN: 5,
      llmPostprocessSeed: 2_147_483_647,
      llmPostprocessSkipMinWords: 50,
      llmPostprocessTemperature: 2,
      llmPostprocessTotalContextCap: 30_000,
    });
  });

  it('normalizes skipIfAvgLogprobAbove strictly', () => {
    expect(resolvePluginSettings({ llmPostprocessSkipIfAvgLogprobAbove: -0.5 })).toMatchObject({
      llmPostprocessSkipIfAvgLogprobAbove: -0.5,
    });
    for (const value of [null, Number.NaN, Infinity, -10, 0.1, '0']) {
      expect(
        resolvePluginSettings({ llmPostprocessSkipIfAvgLogprobAbove: value })
          .llmPostprocessSkipIfAvgLogprobAbove,
      ).toBeNull();
    }
    expect(resolvePluginSettings({ llmPostprocessSkipIfAvgLogprobAbove: 0 })).toMatchObject({
      llmPostprocessSkipIfAvgLogprobAbove: 0,
    });
  });

  it('ignores legacy useGpu and defaults to auto', () => {
    expect(resolvePluginSettings({ useGpu: false }).accelerationPreference).toBe('auto');
    expect(resolvePluginSettings({ useGpu: true }).accelerationPreference).toBe('auto');
  });

  it('falls back accelerationPreference to auto when persisted value is invalid', () => {
    expect(resolvePluginSettings({ accelerationPreference: 'gpu' }).accelerationPreference).toBe(
      'auto',
    );
  });

  it.each([
    'responsive',
    'balanced',
    'patient',
  ] as const)('accepts the supported speaking style %s', (speakingStyle) => {
    expect(resolvePluginSettings({ speakingStyle }).speakingStyle).toBe(speakingStyle);
  });

  it('falls back speakingStyle to balanced when persisted value is invalid', () => {
    expect(resolvePluginSettings({ speakingStyle: 'loud' }).speakingStyle).toBe('balanced');
  });

  it.each([
    'always_on',
    'one_sentence',
  ] as const)('accepts the supported listening mode %s', (listeningMode) => {
    expect(resolvePluginSettings({ listeningMode }).listeningMode).toBe(listeningMode);
  });

  it('uses one default system slot constant for persisted fallback', () => {
    expect(resolvePluginSettings({ llmPostprocessSystemSlot: null }).llmPostprocessSystemSlot).toBe(
      DEFAULT_LLM_POSTPROCESS_SYSTEM_SLOT,
    );
  });

  it('resets editable LLM defaults without touching enablement, model, or raw display', () => {
    const reset = resetLlmPostprocessDefaults({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessEnabled: true,
      llmPostprocessFormatSlot: 'changed',
      llmPostprocessGlossaryChars: 333,
      llmPostprocessGlossarySlot: 'changed',
      llmPostprocessKeepAlive: '5m',
      llmPostprocessModel: 'llama3',
      llmPostprocessNoteContextChars: 333,
      llmPostprocessNumPredict: 333,
      llmPostprocessPriorUtterancesN: 3,
      llmPostprocessSeed: 333,
      llmPostprocessShowRawBelow: true,
      llmPostprocessSkipIfAvgLogprobAbove: -0.5,
      llmPostprocessSkipMinWords: 3,
      llmPostprocessSystemSlot: 'changed',
      llmPostprocessTemperature: 1,
      llmPostprocessTotalContextCap: 333,
      llmPostprocessUserTemplate: 'changed {{utterance}}',
      llmPostprocessVoiceSlot: 'changed',
    });

    expect(reset).toMatchObject({
      llmPostprocessEnabled: true,
      llmPostprocessModel: 'llama3',
      llmPostprocessShowRawBelow: true,
      llmPostprocessSystemSlot: DEFAULT_PLUGIN_SETTINGS.llmPostprocessSystemSlot,
      llmPostprocessUserTemplate: DEFAULT_PLUGIN_SETTINGS.llmPostprocessUserTemplate,
    });
  });
});
