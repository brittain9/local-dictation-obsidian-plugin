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

    expect(resolved.llmPostprocessMode).toBe('per_utterance');
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
        llmFeaturesEnabled: 'yes',
        llmPostprocessMode: 'later',
        llmPostprocessModel: 123,
        llmPostprocessPrompt: '',
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

  it('preserves valid prompt-shaped user styles in their original order', () => {
    const presets = [
      makeUserPreset({ id: 'a', label: 'Style A', description: 'first' }),
      makeUserPreset({ id: 'b', label: 'Style B', prompt: 'second prompt' }),
    ];
    expect(
      resolvePluginSettings({ llmPostprocessUserPresets: presets }).llmPostprocessUserPresets,
    ).toEqual(presets);
  });

  it('drops invalid user style entries', () => {
    expect(
      resolvePluginSettings({
        llmPostprocessUserPresets: [
          null,
          'string',
          { id: '', label: 'empty id', prompt: 'x' },
          { id: 'valid', label: '   ', prompt: 'x' },
          { id: 'no-label', prompt: 'x' },
          makeUserPreset({ id: 'ok', label: 'Keeper' }),
        ],
      }).llmPostprocessUserPresets,
    ).toEqual([makeUserPreset({ id: 'ok', label: 'Keeper' })]);
  });

  it('drops duplicate user style IDs after the first valid entry', () => {
    expect(
      resolvePluginSettings({
        llmPostprocessUserPresets: [
          makeUserPreset({ id: 'a', label: 'First A' }),
          makeUserPreset({ id: 'a', label: 'Second A' }),
          makeUserPreset({ id: 'b', label: 'Keeper B' }),
        ],
      }).llmPostprocessUserPresets,
    ).toEqual([
      makeUserPreset({ id: 'a', label: 'First A' }),
      makeUserPreset({ id: 'b', label: 'Keeper B' }),
    ]);
  });

  it('falls back empty user-preset prompts to the Clean up prompt', () => {
    const preset = resolvePluginSettings({
      llmPostprocessUserPresets: [{ id: 'a', label: 'A', prompt: '' }],
    }).llmPostprocessUserPresets[0];

    expect(preset?.prompt).toBe(DEFAULT_LLM_POSTPROCESS_PROMPT);
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
