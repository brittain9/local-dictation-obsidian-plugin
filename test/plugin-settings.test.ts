import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LLM_BUILTIN_PRESET_ID,
  getLlmBuiltinPreset,
  type LlmUserPreset,
} from '../src/llm/presets';
import {
  DEFAULT_LLM_POSTPROCESS_PROMPT,
  DEFAULT_PLUGIN_SETTINGS,
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
  resetLlmPostprocessDefaults,
  resolvePluginSettings,
} from '../src/settings/plugin-settings';

const PROFESSIONAL_WRITING_PRESET = getLlmBuiltinPreset('professional-writing');

function makeUserPreset(overrides: Partial<LlmUserPreset> & { id: string }): LlmUserPreset {
  return {
    description: '',
    label: `Style ${overrides.id}`,
    prompt: 'Clean it my way.',
    ...overrides,
  };
}

describe('resolvePluginSettings', () => {
  it('returns defaults when persisted data is missing', () => {
    expect(resolvePluginSettings(undefined)).toEqual(DEFAULT_PLUGIN_SETTINGS);
  });

  it('defaults missing schemaVersion to the current settings schema', () => {
    expect(resolvePluginSettings({}).schemaVersion).toBe(1);
  });

  it('defaults to visible per-utterance cleanup with the Clean up prompt', () => {
    expect(DEFAULT_PLUGIN_SETTINGS).toMatchObject({
      llmFeaturesEnabled: true,
      llmPostprocessActivePresetRef: `builtin:${DEFAULT_LLM_BUILTIN_PRESET_ID}`,
      llmPostprocessMode: 'per_utterance',
      llmPostprocessPrompt: DEFAULT_LLM_POSTPROCESS_PROMPT,
      llmPostprocessUserPresets: [],
    });
  });

  it('merges valid persisted values', () => {
    expect(
      resolvePluginSettings({
        accelerationPreference: 'cpu_only',
        cudaLibraryPath: ' /run/host/usr/lib64 ',
        dictationAnchor: 'end_of_note',
        listeningMode: 'always_on',
        llmFeaturesEnabled: false,
        llmPostprocessMode: 'batch',
        llmPostprocessModel: ' llama3.2:latest ',
        llmPostprocessNoteContextChars: 4000,
        llmPostprocessPriorUtterancesN: 3,
        llmPostprocessPrompt: 'Custom prompt.',
        llmPostprocessShowRawBelow: true,
        llmPostprocessSkipMinWords: 6,
        llmPostprocessTemperature: 0.4,
        llmPostprocessTotalContextCap: 9000,
        localTranscriptSidebarBootstrapped: true,
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
        speakingStyle: 'patient',
        timestampClock: 'wallclock',
        timestampDensity: 'every_utterance',
        timestampsEnabled: true,
        timestampSessionHeader: false,
        timestampSparseIntervalMs: 60_000,
        transcriptFormatting: 'new_paragraph',
        useNoteAsContext: false,
      }),
    ).toEqual({
      ...DEFAULT_PLUGIN_SETTINGS,
      accelerationPreference: 'cpu_only',
      cudaLibraryPath: '/run/host/usr/lib64',
      dictationAnchor: 'end_of_note',
      listeningMode: 'always_on',
      llmFeaturesEnabled: false,
      llmPostprocessActivePresetRef: null,
      llmPostprocessMode: 'batch',
      llmPostprocessModel: 'llama3.2:latest',
      llmPostprocessNoteContextChars: 4000,
      llmPostprocessPriorUtterancesN: 3,
      llmPostprocessPrompt: 'Custom prompt.',
      llmPostprocessShowRawBelow: true,
      llmPostprocessSkipMinWords: 6,
      llmPostprocessTemperature: 0.4,
      llmPostprocessTotalContextCap: 9000,
      localTranscriptSidebarBootstrapped: true,
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
      speakingStyle: 'patient',
      timestampClock: 'wallclock',
      timestampDensity: 'every_utterance',
      timestampsEnabled: true,
      timestampSessionHeader: false,
      timestampSparseIntervalMs: 60_000,
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

  it('falls back when persisted values are invalid', () => {
    expect(
      resolvePluginSettings({
        dictationAnchor: 'at_end',
        listeningMode: 'unsupported',
        llmFeaturesEnabled: 'yes',
        llmPostprocessMode: 'later',
        llmPostprocessModel: 123,
        llmPostprocessPrompt: '',
        localTranscriptSidebarBootstrapped: 'yes',
        modelStorePathOverride: 42,
        sidecarPathOverride: 12,
        sidecarRequestTimeoutSeconds: -1,
        sidecarStartupTimeoutSeconds: 'fast',
        timestampClock: 'date',
        timestampDensity: 'always',
        timestampsEnabled: 'yes',
        timestampSessionHeader: 'yes',
        timestampSparseIntervalMs: 'soon',
        transcriptFormatting: 'tab',
        useNoteAsContext: 'yes',
      }),
    ).toEqual(DEFAULT_PLUGIN_SETTINGS);
  });

  it('validates setupCompletedAt as the exact persisted ISO timestamp', () => {
    const timestamp = '2026-05-22T10:00:00.000Z';

    expect(resolvePluginSettings({ setupCompletedAt: timestamp }).setupCompletedAt).toBe(timestamp);
    expect(resolvePluginSettings({ setupCompletedAt: 'corrupted' }).setupCompletedAt).toBeNull();
    expect(resolvePluginSettings({ setupCompletedAt: '2026-05-22' }).setupCompletedAt).toBeNull();
  });

  it('clamps LLM postprocess numeric settings at the settings boundary', () => {
    const low = resolvePluginSettings({
      llmPostprocessNoteContextChars: -1,
      llmPostprocessPriorUtterancesN: -1,
      llmPostprocessSkipMinWords: -1,
      llmPostprocessTemperature: -1,
      llmPostprocessTotalContextCap: -1,
    });
    const high = resolvePluginSettings({
      llmPostprocessNoteContextChars: 99_999,
      llmPostprocessPriorUtterancesN: 99,
      llmPostprocessSkipMinWords: 99,
      llmPostprocessTemperature: 99,
      llmPostprocessTotalContextCap: 99_999,
    });

    expect(low).toMatchObject({
      llmPostprocessNoteContextChars: 0,
      llmPostprocessPriorUtterancesN: 0,
      llmPostprocessSkipMinWords: 0,
      llmPostprocessTemperature: 0,
      llmPostprocessTotalContextCap: 0,
    });
    expect(high).toMatchObject({
      llmPostprocessNoteContextChars: 12_000,
      llmPostprocessPriorUtterancesN: 5,
      llmPostprocessSkipMinWords: 50,
      llmPostprocessTemperature: 2,
      llmPostprocessTotalContextCap: 30_000,
    });
  });

  it('clamps timestamp sparse interval at the settings boundary', () => {
    expect(resolvePluginSettings({ timestampSparseIntervalMs: 1 }).timestampSparseIntervalMs).toBe(
      10_000,
    );
    expect(
      resolvePluginSettings({ timestampSparseIntervalMs: 999_999 }).timestampSparseIntervalMs,
    ).toBe(600_000);
  });

  it('infers active style refs from the current prompt', () => {
    expect(resolvePluginSettings({}).llmPostprocessActivePresetRef).toBe('builtin:clean-up');
    expect(
      resolvePluginSettings({
        llmPostprocessPrompt: PROFESSIONAL_WRITING_PRESET.prompt,
      }).llmPostprocessActivePresetRef,
    ).toBe('builtin:professional-writing');
    expect(
      resolvePluginSettings({
        llmPostprocessPrompt: 'something fully custom',
      }).llmPostprocessActivePresetRef,
    ).toBeNull();
  });

  it('preserves a persisted active preset ref over content-based matching', () => {
    const userPreset = makeUserPreset({
      id: 'a',
      label: 'Mirror clean-up',
      prompt: getLlmBuiltinPreset(DEFAULT_LLM_BUILTIN_PRESET_ID).prompt,
    });

    expect(
      resolvePluginSettings({
        llmPostprocessActivePresetRef: 'user:a',
        llmPostprocessPrompt: userPreset.prompt,
        llmPostprocessUserPresets: [userPreset],
      }).llmPostprocessActivePresetRef,
    ).toBe('user:a');

    expect(
      resolvePluginSettings({
        llmPostprocessActivePresetRef: null,
        llmPostprocessPrompt: getLlmBuiltinPreset(DEFAULT_LLM_BUILTIN_PRESET_ID).prompt,
      }).llmPostprocessActivePresetRef,
    ).toBeNull();

    expect(
      resolvePluginSettings({
        llmPostprocessActivePresetRef: 'user:gone',
        llmPostprocessPrompt: PROFESSIONAL_WRITING_PRESET.prompt,
        llmPostprocessUserPresets: [],
      }).llmPostprocessActivePresetRef,
    ).toBe('builtin:professional-writing');
  });

  it.each([
    [
      'preserves valid prompt-shaped entries in order',
      [
        makeUserPreset({ id: 'a', label: 'Style A', description: 'first' }),
        makeUserPreset({ id: 'b', label: 'Style B', prompt: 'second prompt' }),
      ],
      [
        makeUserPreset({ id: 'a', label: 'Style A', description: 'first' }),
        makeUserPreset({ id: 'b', label: 'Style B', prompt: 'second prompt' }),
      ],
    ],
    [
      'drops invalid entries',
      [
        null,
        'string',
        { id: '', label: 'empty id', prompt: 'x' },
        { id: 'valid', label: '   ', prompt: 'x' },
        { id: 'no-label', prompt: 'x' },
        makeUserPreset({ id: 'ok', label: 'Keeper' }),
      ],
      [makeUserPreset({ id: 'ok', label: 'Keeper' })],
    ],
    [
      'drops duplicate IDs after the first valid entry',
      [
        makeUserPreset({ id: 'a', label: 'First A' }),
        makeUserPreset({ id: 'a', label: 'Second A' }),
        makeUserPreset({ id: 'b', label: 'Keeper B' }),
      ],
      [
        makeUserPreset({ id: 'a', label: 'First A' }),
        makeUserPreset({ id: 'b', label: 'Keeper B' }),
      ],
    ],
    [
      'falls back empty prompts to the Clean up prompt',
      [{ id: 'a', label: 'A', prompt: '' }],
      [makeUserPreset({ id: 'a', label: 'A', prompt: DEFAULT_LLM_POSTPROCESS_PROMPT })],
    ],
  ] as const)('normalizes user styles: %s', (_label, llmPostprocessUserPresets, expected) => {
    expect(resolvePluginSettings({ llmPostprocessUserPresets }).llmPostprocessUserPresets).toEqual(
      expected,
    );
  });

  it('keeps valid per-preset minWords and temperature overrides; drops invalid', () => {
    const presets = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'a', label: 'Has both', prompt: 'p', minWords: 0, temperature: 0.7 },
        { id: 'b', label: 'Clamped high', prompt: 'p', minWords: 999, temperature: 99 },
        { id: 'c', label: 'Bad types', prompt: 'p', minWords: '3', temperature: 'hot' },
        { id: 'd', label: 'None', prompt: 'p' },
      ],
    }).llmPostprocessUserPresets;

    expect(presets[0]?.minWords).toBe(0);
    expect(presets[0]?.temperature).toBe(0.7);
    expect(presets[1]?.minWords).toBe(50);
    expect(presets[1]?.temperature).toBe(2);
    expect(presets[2]?.minWords).toBeUndefined();
    expect(presets[2]?.temperature).toBeUndefined();
    expect(presets[3]?.minWords).toBeUndefined();
    expect(presets[3]?.temperature).toBeUndefined();
  });

  it('keeps valid preset modes and drops invalid ones', () => {
    const presets = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'a', label: 'Phrase', mode: 'per_utterance', prompt: 'p' },
        { id: 'b', label: 'Batch', mode: 'batch', prompt: 'p' },
        { id: 'c', label: 'Off rejected', mode: 'off', prompt: 'p' },
        { id: 'd', label: 'Unknown rejected', mode: 'whenever', prompt: 'p' },
        { id: 'e', label: 'No mode', prompt: 'p' },
      ],
    }).llmPostprocessUserPresets;

    expect(presets.map((preset) => preset.mode)).toEqual([
      'per_utterance',
      'batch',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('clamps user style label and description lengths', () => {
    const longLabel = 'L'.repeat(LLM_USER_PRESET_MAX_LABEL_CHARS + 20);
    const longDesc = 'D'.repeat(LLM_USER_PRESET_MAX_DESCRIPTION_CHARS + 50);
    const preset = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'a', label: longLabel, description: longDesc, prompt: 'prompt' },
      ],
    }).llmPostprocessUserPresets[0];

    expect(preset?.label.length).toBe(LLM_USER_PRESET_MAX_LABEL_CHARS);
    expect(preset?.description.length).toBe(LLM_USER_PRESET_MAX_DESCRIPTION_CHARS);
  });

  it(`caps user style count at ${LLM_USER_PRESET_MAX_COUNT}`, () => {
    const presets = Array.from({ length: LLM_USER_PRESET_MAX_COUNT + 5 }, (_, i) =>
      makeUserPreset({ id: `id-${i}`, label: `Label ${i}` }),
    );

    expect(
      resolvePluginSettings({ llmPostprocessUserPresets: presets }).llmPostprocessUserPresets,
    ).toHaveLength(LLM_USER_PRESET_MAX_COUNT);
  });

  it('drops non-array user preset values', () => {
    expect(
      resolvePluginSettings({ llmPostprocessUserPresets: 'oops' }).llmPostprocessUserPresets,
    ).toEqual([]);
    expect(
      resolvePluginSettings({ llmPostprocessUserPresets: { 0: 'oops' } }).llmPostprocessUserPresets,
    ).toEqual([]);
  });

  it('reads a valid audioInputDevice and trims whitespace', () => {
    expect(
      resolvePluginSettings({
        audioInputDevice: { deviceId: '  abc123  ', label: '  Plantronics Headset  ' },
      }).audioInputDevice,
    ).toEqual({ deviceId: 'abc123', label: 'Plantronics Headset' });
  });

  it.each([
    ['missing field', { audioInputDevice: { deviceId: 'abc' } }],
    ['empty deviceId', { audioInputDevice: { deviceId: '', label: 'Mic' } }],
    ['empty label', { audioInputDevice: { deviceId: 'abc', label: '' } }],
    ['whitespace-only label', { audioInputDevice: { deviceId: 'abc', label: '   ' } }],
    ['wrong types', { audioInputDevice: { deviceId: 42, label: 'Mic' } }],
    ['not an object', { audioInputDevice: 'abc123' }],
  ])('coerces invalid audioInputDevice to null (%s)', (_label, raw) => {
    expect(resolvePluginSettings(raw).audioInputDevice).toBeNull();
  });

  it('resets editable LLM defaults without touching visibility, model, raw display, or styles', () => {
    const presets = [makeUserPreset({ id: 'a', label: 'Keep me' })];
    const reset = resetLlmPostprocessDefaults({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmFeaturesEnabled: false,
      llmPostprocessActivePresetRef: 'user:custom',
      llmPostprocessMode: 'batch',
      llmPostprocessModel: 'llama3',
      llmPostprocessNoteContextChars: 333,
      llmPostprocessPriorUtterancesN: 3,
      llmPostprocessPrompt: 'changed',
      llmPostprocessShowRawBelow: true,
      llmPostprocessSkipMinWords: 3,
      llmPostprocessTemperature: 1,
      llmPostprocessTotalContextCap: 333,
      llmPostprocessUserPresets: presets,
    });

    expect(reset).toMatchObject({
      llmFeaturesEnabled: false,
      llmPostprocessActivePresetRef: `builtin:${DEFAULT_LLM_BUILTIN_PRESET_ID}`,
      llmPostprocessMode: 'per_utterance',
      llmPostprocessModel: 'llama3',
      llmPostprocessPrompt: DEFAULT_PLUGIN_SETTINGS.llmPostprocessPrompt,
      llmPostprocessShowRawBelow: true,
      llmPostprocessUserPresets: presets,
    });
  });
});
