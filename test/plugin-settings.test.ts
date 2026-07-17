import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LLM_BUILTIN_PRESET_ID,
  getLlmBuiltinPreset,
  type LlmPreset,
} from '../src/llm/presets';
import {
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_SMART_PARAGRAPH_LINE_BREAK_PAUSE_MS,
  DEFAULT_SMART_PARAGRAPH_PARAGRAPH_PAUSE_MS,
  isRemoteLlmEffectivelyEnabled,
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
  MAX_SMART_PARAGRAPH_PAUSE_MS,
  MIN_SMART_PARAGRAPH_PAUSE_MS,
  resetLlmPostprocessDefaults,
  resolvePluginSettings,
  shouldRefreshLlmSidebar,
  validateTimestampIntervalSeconds,
} from '../src/settings/plugin-settings';

function makeUserPreset(overrides: Partial<LlmPreset> & { id: string }): LlmPreset {
  return {
    label: `Style ${overrides.id}`,
    output: 'replace',
    prompt: 'Clean it my way.',
    ...overrides,
  };
}

describe('resolvePluginSettings', () => {
  it('returns defaults when persisted data is missing', () => {
    expect(resolvePluginSettings(undefined)).toEqual(DEFAULT_PLUGIN_SETTINGS);
  });

  it('defaults missing schemaVersion to the current settings schema', () => {
    expect(resolvePluginSettings({}).schemaVersion).toBe(4);
  });

  it('migrates missing or invalid dictation language to English', () => {
    expect(resolvePluginSettings({}).dictationLanguage).toBe('en');
    expect(resolvePluginSettings({ dictationLanguage: 'ja' }).dictationLanguage).toBe('ja');
    expect(resolvePluginSettings({ dictationLanguage: 'xx' }).dictationLanguage).toBe('en');
  });

  it('enables LLM capabilities but keeps transformation off by default', () => {
    expect(DEFAULT_PLUGIN_SETTINGS).toMatchObject({
      llmFeaturesEnabled: true,
      llmRemoteFeaturesEnabled: true,
      llmPostprocessActivePresetRef: `builtin:${DEFAULT_LLM_BUILTIN_PRESET_ID}`,
      llmPostprocessMode: 'off',
      llmPostprocessUserPresets: [],
    });
  });

  it('defaults speaker diarization off and honors a persisted boolean', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.diarizationEnabled).toBe(false);
    expect(DEFAULT_PLUGIN_SETTINGS.diarizationMaxSpeakers).toBeNull();
    expect(resolvePluginSettings({ diarizationEnabled: true }).diarizationEnabled).toBe(true);
    expect(resolvePluginSettings({ diarizationEnabled: 'yes' }).diarizationEnabled).toBe(false);
  });

  it('accepts automatic or bounded maximum speaker counts', () => {
    expect(
      resolvePluginSettings({ diarizationMaxSpeakers: null }).diarizationMaxSpeakers,
    ).toBeNull();
    expect(resolvePluginSettings({ diarizationMaxSpeakers: 2 }).diarizationMaxSpeakers).toBe(2);
    expect(resolvePluginSettings({ diarizationMaxSpeakers: 0 }).diarizationMaxSpeakers).toBeNull();
    expect(resolvePluginSettings({ diarizationMaxSpeakers: 99 }).diarizationMaxSpeakers).toBeNull();
    expect(
      resolvePluginSettings({ diarizationMaxSpeakers: '2' }).diarizationMaxSpeakers,
    ).toBeNull();
  });

  it('retains the last utterance by default and honors only a persisted boolean opt-out', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.retainLastUtterance).toBe(true);
    expect(resolvePluginSettings({ retainLastUtterance: false }).retainLastUtterance).toBe(false);
    expect(resolvePluginSettings({ retainLastUtterance: 'no' }).retainLastUtterance).toBe(true);
  });

  it('migrates legacy speaker label setting to diarization', () => {
    expect(resolvePluginSettings({ speakerLabelsEnabled: true }).diarizationEnabled).toBe(true);
    expect(
      resolvePluginSettings({ diarizationEnabled: false, speakerLabelsEnabled: true })
        .diarizationEnabled,
    ).toBe(false);
  });

  it('merges valid persisted values', () => {
    expect(
      resolvePluginSettings({
        accelerationPreference: 'cpu_only',
        cudaLibraryPath: ' /run/host/usr/lib64 ',
        dictationAnchor: 'end_of_note',
        listeningMode: 'always_on',
        llmFeaturesEnabled: false,
        llmOpenRouterSecretId: ' openrouter-secret ',
        llmRemoteFeaturesEnabled: false,
        llmPostprocessMode: 'batch',
        llmPostprocessNoteContextChars: 4000,
        llmPostprocessPriorUtterancesN: 3,
        llmPostprocessShowRawBelow: true,
        llmPostprocessSkipMinWords: 6,
        llmPostprocessTemperature: 0.4,
        llmPostprocessTotalContextCap: 9000,
        llmProviderModels: {
          ollama: ' llama3.2:latest ',
          openrouter: ' anthropic/claude-sonnet-4.5 ',
        },
        llmRemoteThresholdChars: 8000,
        llmRouting: 'auto',
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
        smartParagraphLineBreakPauseMs: 1500,
        smartParagraphParagraphPauseMs: 4500,
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
      llmOpenRouterSecretId: 'openrouter-secret',
      llmRemoteFeaturesEnabled: false,
      // Seeded from the stored mode (no explicit value persisted).
      llmPostprocessLastEnabledMode: 'batch',
      llmPostprocessMode: 'batch',
      llmPostprocessNoteContextChars: 4000,
      llmPostprocessPriorUtterancesN: 3,
      llmPostprocessShowRawBelow: true,
      llmPostprocessSkipMinWords: 6,
      llmPostprocessTemperature: 0.4,
      llmPostprocessTotalContextCap: 9000,
      llmProviderModels: {
        ollama: 'llama3.2:latest',
        openrouter: 'anthropic/claude-sonnet-4.5',
      },
      llmRemoteThresholdChars: 8000,
      llmRouting: 'auto',
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
      smartParagraphLineBreakPauseMs: 1500,
      smartParagraphParagraphPauseMs: 4500,
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
        llmOpenRouterSecretId: 'Invalid secret ID',
        llmRemoteFeaturesEnabled: 'yes',
        llmPostprocessMode: 'later',
        llmPostprocessPrompt: '',
        llmProviderModels: 'llama3',
        llmRemoteThresholdChars: 'soon',
        llmRouting: 'claude',
        localTranscriptSidebarBootstrapped: 'yes',
        modelStorePathOverride: 42,
        sidecarPathOverride: 12,
        sidecarRequestTimeoutSeconds: -1,
        sidecarStartupTimeoutSeconds: 'fast',
        smartParagraphLineBreakPauseMs: 'soon',
        smartParagraphParagraphPauseMs: 'later',
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

  it('round-trips a well-formed selectedModelCapabilitiesSnapshot', () => {
    const selection = {
      familyId: 'whisper' as const,
      kind: 'catalog_model' as const,
      modelId: 'whisper_large_v3_turbo_q8_0',
      runtimeId: 'whisper_cpp' as const,
    };
    const capabilities = {
      family: {
        maxAudioDurationSecs: null,
        producesPunctuation: true,
        supportedLanguages: { kind: 'all' as const },
        supportsInitialPrompt: true,
        supportsLanguageSelection: true,
        supportsAutomaticLanguageDetection: true,
        supportsSegmentTimestamps: true,
        supportsStreaming: false,
        supportsWordTimestamps: false,
      },
      familyId: 'whisper' as const,
      runtime: {
        acceleratorDetails: { cpu: { available: true, unavailableReason: null } },
        availableAccelerators: ['cpu' as const],
        supportedModelFormats: ['ggml' as const],
      },
      runtimeId: 'whisper_cpp' as const,
    };

    expect(
      resolvePluginSettings({
        schemaVersion: 4,
        selectedModelCapabilitiesSnapshot: { capabilities, selection },
      }).selectedModelCapabilitiesSnapshot,
    ).toEqual({ capabilities, selection });

    expect(
      resolvePluginSettings({
        schemaVersion: 3,
        selectedModelCapabilitiesSnapshot: { capabilities, selection },
      }).selectedModelCapabilitiesSnapshot,
    ).toBeNull();
  });

  it.each([
    ['not a record', 'nope'],
    [
      'missing capabilities',
      {
        selection: {
          familyId: 'whisper',
          kind: 'catalog_model',
          modelId: 'm',
          runtimeId: 'whisper_cpp',
        },
      },
    ],
    [
      'capabilities missing required fields',
      {
        capabilities: { familyId: 'whisper' },
        selection: {
          familyId: 'whisper',
          kind: 'catalog_model',
          modelId: 'm',
          runtimeId: 'whisper_cpp',
        },
      },
    ],
    [
      'invalid selection',
      {
        capabilities: {},
        selection: {
          familyId: 'not_a_family',
          kind: 'catalog_model',
          modelId: 'm',
          runtimeId: 'whisper_cpp',
        },
      },
    ],
  ])('drops a malformed selectedModelCapabilitiesSnapshot (%s)', (_label, value) => {
    expect(
      resolvePluginSettings({ selectedModelCapabilitiesSnapshot: value })
        .selectedModelCapabilitiesSnapshot,
    ).toBeNull();
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

  it('migrates detailed model timing to every-phrase timestamps', () => {
    expect(resolvePluginSettings({ timestampDensity: 'detailed' }).timestampDensity).toBe(
      'every_utterance',
    );
  });

  it.each([
    ['10', 10_000],
    [' 30 ', 30_000],
    ['600', 600_000],
  ])('validates a whole-number timestamp interval of %s seconds', (value, milliseconds) => {
    expect(validateTimestampIntervalSeconds(value)).toEqual({ milliseconds, valid: true });
  });

  it.each([
    '',
    'ten',
    'NaN',
    '9',
    '10.5',
    '601',
    '1e2',
    '0x10',
  ])('rejects timestamp interval %j', (value) => {
    expect(validateTimestampIntervalSeconds(value)).toEqual({
      message: 'Enter a whole number from 10 to 600 seconds.',
      valid: false,
    });
  });

  it('defaults smart paragraph thresholds to separate line and paragraph pauses', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.smartParagraphLineBreakPauseMs).toBe(
      DEFAULT_SMART_PARAGRAPH_LINE_BREAK_PAUSE_MS,
    );
    expect(DEFAULT_PLUGIN_SETTINGS.smartParagraphParagraphPauseMs).toBe(
      DEFAULT_SMART_PARAGRAPH_PARAGRAPH_PAUSE_MS,
    );
    expect(resolvePluginSettings({})).toMatchObject({
      smartParagraphLineBreakPauseMs: 4_000,
      smartParagraphParagraphPauseMs: 10_000,
    });
  });

  it('clamps smart paragraph thresholds at the settings boundary', () => {
    expect(
      resolvePluginSettings({
        smartParagraphLineBreakPauseMs: 1,
        smartParagraphParagraphPauseMs: 999_999,
      }),
    ).toMatchObject({
      smartParagraphLineBreakPauseMs: MIN_SMART_PARAGRAPH_PAUSE_MS,
      smartParagraphParagraphPauseMs: MAX_SMART_PARAGRAPH_PAUSE_MS,
    });
  });

  it('normalizes smart paragraph line breaks to not exceed paragraph breaks', () => {
    expect(
      resolvePluginSettings({
        smartParagraphLineBreakPauseMs: 5000,
        smartParagraphParagraphPauseMs: 2000,
      }),
    ).toMatchObject({
      smartParagraphLineBreakPauseMs: 2000,
      smartParagraphParagraphPauseMs: 2000,
    });
  });

  it('defaults useLlmNoteContext to false', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.useLlmNoteContext).toBe(false);
    expect(resolvePluginSettings({}).useLlmNoteContext).toBe(false);
  });

  it('accepts useLlmNoteContext when persisted as a boolean', () => {
    expect(resolvePluginSettings({ useLlmNoteContext: true }).useLlmNoteContext).toBe(true);
    expect(resolvePluginSettings({ useLlmNoteContext: false }).useLlmNoteContext).toBe(false);
  });

  it('refreshes the LLM sidebar when remote availability changes', () => {
    expect(
      shouldRefreshLlmSidebar(DEFAULT_PLUGIN_SETTINGS, {
        ...DEFAULT_PLUGIN_SETTINGS,
        llmRemoteFeaturesEnabled: false,
      }),
    ).toBe(true);
    expect(
      shouldRefreshLlmSidebar(DEFAULT_PLUGIN_SETTINGS, {
        ...DEFAULT_PLUGIN_SETTINGS,
        developerMode: true,
      }),
    ).toBe(false);
  });

  it.each([
    ['both enabled', true, true, true],
    ['global enabled and remote disabled', true, false, false],
    ['global disabled and remote enabled', false, true, false],
    ['both disabled', false, false, false],
  ] as const)('resolves effective remote LLM availability when %s', (_label, llmFeaturesEnabled, llmRemoteFeaturesEnabled, expected) => {
    expect(
      isRemoteLlmEffectivelyEnabled({
        llmFeaturesEnabled,
        llmRemoteFeaturesEnabled,
      }),
    ).toBe(expected);
  });

  it('migrates the legacy single Ollama model into per-provider model storage', () => {
    expect(
      resolvePluginSettings({
        llmPostprocessModel: ' llama3.2:latest ',
      }),
    ).toMatchObject({
      llmProviderModels: {
        ollama: 'llama3.2:latest',
        openrouter: '',
      },
    });
  });

  it.each([
    ['ollama maps to local', 'ollama', 'local'],
    ['openrouter maps to remote', 'openrouter', 'remote'],
    ['gemini maps to local', 'gemini', 'local'],
  ] as const)('migrates legacy llmProvider %s', (_label, llmProvider, llmRouting) => {
    expect(resolvePluginSettings({ llmProvider }).llmRouting).toBe(llmRouting);
  });

  it('prefers a valid llmRouting over a legacy llmProvider value', () => {
    expect(resolvePluginSettings({ llmProvider: 'ollama', llmRouting: 'remote' }).llmRouting).toBe(
      'remote',
    );
  });

  it('drops the legacy gemini model and keeps ollama/openrouter', () => {
    expect(
      resolvePluginSettings({
        llmProviderModels: {
          gemini: 'gemini-2.5-flash',
          ollama: 'new-ollama',
          openrouter: 'openai/gpt-4.1',
        },
      }).llmProviderModels,
    ).toEqual({
      ollama: 'new-ollama',
      openrouter: 'openai/gpt-4.1',
    });
  });

  it('clamps the remote routing threshold at the settings boundary', () => {
    expect(resolvePluginSettings({ llmRemoteThresholdChars: 1 }).llmRemoteThresholdChars).toBe(500);
    expect(
      resolvePluginSettings({ llmRemoteThresholdChars: 999_999 }).llmRemoteThresholdChars,
    ).toBe(60_000);
  });

  it('clamps the remote timeout at the settings boundary', () => {
    expect(resolvePluginSettings({ llmRemoteTimeoutSec: 1 }).llmRemoteTimeoutSec).toBe(5);
    expect(resolvePluginSettings({ llmRemoteTimeoutSec: 9_999 }).llmRemoteTimeoutSec).toBe(600);
    expect(resolvePluginSettings({ llmRemoteTimeoutSec: 'soon' }).llmRemoteTimeoutSec).toBe(60);
    expect(resolvePluginSettings({ llmRemoteTimeoutSec: 120 }).llmRemoteTimeoutSec).toBe(120);
  });

  it('falls back to the default when useLlmNoteContext is not a boolean', () => {
    expect(resolvePluginSettings({ useLlmNoteContext: 'yes' }).useLlmNoteContext).toBe(false);
  });

  it('persists the last enabled LLM mode and seeds it from the stored mode', () => {
    expect(
      resolvePluginSettings({ llmPostprocessLastEnabledMode: 'batch' })
        .llmPostprocessLastEnabledMode,
    ).toBe('batch');
    // Vaults that predate the field seed from the enabled mode.
    expect(
      resolvePluginSettings({ llmPostprocessMode: 'batch' }).llmPostprocessLastEnabledMode,
    ).toBe('batch');
    expect(
      resolvePluginSettings({ llmPostprocessLastEnabledMode: 'off' }).llmPostprocessLastEnabledMode,
    ).toBe('per_utterance');
  });
});

describe('llm preset migration', () => {
  it('drops a legacy prompt that matches the active preset', () => {
    const settings = resolvePluginSettings({
      llmPostprocessActivePresetRef: 'builtin:professional-writing',
      llmPostprocessPrompt: getLlmBuiltinPreset('professional-writing').prompt,
    });
    expect(settings.llmPostprocessActivePresetRef).toBe('builtin:professional-writing');
    expect(settings.llmPostprocessUserPresets).toHaveLength(0);
    expect('llmPostprocessPrompt' in settings).toBe(false);
  });

  it('re-points the ref when a legacy prompt matches another preset', () => {
    const settings = resolvePluginSettings({
      llmPostprocessActivePresetRef: null,
      llmPostprocessPrompt: getLlmBuiltinPreset('professional-writing').prompt,
    });
    expect(settings.llmPostprocessActivePresetRef).toBe('builtin:professional-writing');
  });

  it('trusts a valid builtin ref even when its prompt text changed across versions', () => {
    // Pre-redesign vaults stored the builtin's old prompt as a mirror; the ref
    // is the authoritative signal of user intent.
    const settings = resolvePluginSettings({
      llmPostprocessActivePresetRef: 'builtin:tldr',
      llmPostprocessPrompt: 'old TLDR prompt text that no longer matches any preset',
    });
    expect(settings.llmPostprocessActivePresetRef).toBe('builtin:tldr');
    expect(settings.llmPostprocessUserPresets).toHaveLength(0);
  });

  it('still preserves a custom prompt when the stored ref is a user preset with a different prompt', () => {
    const settings = resolvePluginSettings({
      llmPostprocessActivePresetRef: 'user:a',
      llmPostprocessPrompt: 'diverged custom prompt',
      llmPostprocessUserPresets: [makeUserPreset({ id: 'a' })],
    });
    const created = settings.llmPostprocessUserPresets[1];
    expect(created).toMatchObject({ label: 'My preset', prompt: 'diverged custom prompt' });
    expect(settings.llmPostprocessActivePresetRef).toBe(`user:${created?.id}`);
  });

  it('converts a custom legacy prompt into a "My preset" user preset', () => {
    const settings = resolvePluginSettings({ llmPostprocessPrompt: 'fully custom prompt' });
    const created = settings.llmPostprocessUserPresets[0];
    expect(created).toMatchObject({
      label: 'My preset',
      output: 'replace',
      prompt: 'fully custom prompt',
    });
    expect(settings.llmPostprocessActivePresetRef).toBe(`user:${created?.id}`);
  });

  it('suffixes the migrated preset label when "My preset" is taken', () => {
    const settings = resolvePluginSettings({
      llmPostprocessPrompt: 'fully custom prompt',
      llmPostprocessUserPresets: [makeUserPreset({ id: 'a', label: 'My preset' })],
    });
    expect(settings.llmPostprocessUserPresets[1]?.label).toBe('My preset 2');
  });

  it('falls back to clean-up for unknown refs, including removed voice-commands', () => {
    expect(
      resolvePluginSettings({ llmPostprocessActivePresetRef: 'builtin:voice-commands' })
        .llmPostprocessActivePresetRef,
    ).toBe('builtin:clean-up');
    expect(
      resolvePluginSettings({ llmPostprocessActivePresetRef: null }).llmPostprocessActivePresetRef,
    ).toBe('builtin:clean-up');
  });

  it('migrates legacy user-preset fields into the new shape', () => {
    const settings = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'a', label: 'Old', prompt: 'p', mode: 'batch', minWords: 2, temperature: 0.7 },
      ],
    });
    expect(settings.llmPostprocessUserPresets[0]).toEqual({
      id: 'a',
      label: 'Old',
      output: 'replace',
      overrides: { minWords: 2, temperature: 0.7 },
      prompt: 'p',
      timing: 'batch',
    });
  });

  it('drops user presets without a prompt and forces batch timing for additive presets', () => {
    const settings = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'empty', label: 'No prompt', prompt: '   ' },
        { id: 'add', label: 'Adder', prompt: 'p', output: 'add_above', timing: 'per_utterance' },
      ],
    });
    expect(settings.llmPostprocessUserPresets).toHaveLength(1);
    expect(settings.llmPostprocessUserPresets[0]).toMatchObject({ id: 'add', timing: 'batch' });
  });
});

describe('user preset normalization', () => {
  it.each([
    [
      'preserves valid entries in order',
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
  ] as const)('normalizes user presets: %s', (_label, llmPostprocessUserPresets, expected) => {
    expect(resolvePluginSettings({ llmPostprocessUserPresets }).llmPostprocessUserPresets).toEqual(
      expected,
    );
  });

  it('keeps valid override values in the overrides bag; drops invalid', () => {
    const presets = resolvePluginSettings({
      llmPostprocessUserPresets: [
        {
          id: 'a',
          label: 'Has all',
          prompt: 'p',
          overrides: { minWords: 0, temperature: 0.7, useNoteContext: true },
        },
        {
          id: 'b',
          label: 'Clamped high',
          prompt: 'p',
          overrides: { minWords: 999, temperature: 99 },
        },
        {
          id: 'c',
          label: 'Bad types',
          prompt: 'p',
          overrides: { minWords: '3', temperature: 'hot', useNoteContext: 'yes' },
        },
        { id: 'd', label: 'None', prompt: 'p' },
      ],
    }).llmPostprocessUserPresets;

    expect(presets[0]?.overrides).toEqual({ minWords: 0, temperature: 0.7, useNoteContext: true });
    expect(presets[1]?.overrides).toEqual({ minWords: 50, temperature: 2 });
    expect(presets[2]?.overrides).toBeUndefined();
    expect(presets[3]?.overrides).toBeUndefined();
  });

  it('keeps valid preset timings and drops invalid ones', () => {
    const presets = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'a', label: 'Phrase', prompt: 'p', timing: 'per_utterance' },
        { id: 'b', label: 'Batch', prompt: 'p', timing: 'batch' },
        { id: 'c', label: 'Off rejected', prompt: 'p', timing: 'off' },
        { id: 'd', label: 'Unknown rejected', prompt: 'p', timing: 'whenever' },
        { id: 'e', label: 'No timing', prompt: 'p' },
      ],
    }).llmPostprocessUserPresets;

    expect(presets.map((preset) => preset.timing)).toEqual([
      'per_utterance',
      'batch',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('clamps user preset label and description lengths', () => {
    const longLabel = 'L'.repeat(LLM_USER_PRESET_MAX_LABEL_CHARS + 20);
    const longDesc = 'D'.repeat(LLM_USER_PRESET_MAX_DESCRIPTION_CHARS + 50);
    const preset = resolvePluginSettings({
      llmPostprocessUserPresets: [
        { id: 'a', label: longLabel, description: longDesc, prompt: 'prompt' },
      ],
    }).llmPostprocessUserPresets[0];

    expect(preset?.label.length).toBe(LLM_USER_PRESET_MAX_LABEL_CHARS);
    expect(preset?.description?.length).toBe(LLM_USER_PRESET_MAX_DESCRIPTION_CHARS);
  });

  it(`caps user preset count at ${LLM_USER_PRESET_MAX_COUNT}`, () => {
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
});

describe('audio input device', () => {
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
});

describe('system audio inclusion', () => {
  it('defaults to microphone-only capture when unset', () => {
    expect(resolvePluginSettings({}).includeSystemAudio).toBe(false);
  });

  it('reads a valid includeSystemAudio value', () => {
    expect(resolvePluginSettings({ includeSystemAudio: true }).includeSystemAudio).toBe(true);
  });

  it('migrates legacy system audio source to include system audio', () => {
    expect(resolvePluginSettings({ audioSource: 'system' }).includeSystemAudio).toBe(true);
    expect(resolvePluginSettings({ audioSource: 'microphone' }).includeSystemAudio).toBe(false);
  });

  it.each([
    ['unknown string', 'speaker'],
    ['wrong type', 42],
    ['null', null],
  ])('coerces invalid includeSystemAudio to false (%s)', (_label, raw) => {
    expect(resolvePluginSettings({ includeSystemAudio: raw }).includeSystemAudio).toBe(false);
  });
});

describe('resetLlmPostprocessDefaults', () => {
  it('resets editable LLM defaults while preserving preset state and provider models', () => {
    const presets = [makeUserPreset({ id: 'a', label: 'Keep me' })];
    const reset = resetLlmPostprocessDefaults({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmFeaturesEnabled: false,
      llmPostprocessActivePresetRef: 'user:custom',
      llmPostprocessLastEnabledMode: 'batch',
      llmPostprocessMode: 'batch',
      llmPostprocessNoteContextChars: 333,
      llmPostprocessPriorUtterancesN: 3,
      llmPostprocessShowRawBelow: true,
      llmPostprocessSkipMinWords: 3,
      llmPostprocessTemperature: 1,
      llmPostprocessTotalContextCap: 333,
      llmPostprocessUserPresets: presets,
      llmProviderModels: {
        ollama: 'llama3',
        openrouter: 'openai/gpt-4.1',
      },
    });

    expect(reset).toMatchObject({
      llmFeaturesEnabled: false,
      llmPostprocessActivePresetRef: 'user:custom',
      llmPostprocessLastEnabledMode: 'per_utterance',
      llmPostprocessMode: 'per_utterance',
      llmPostprocessShowRawBelow: true,
      llmPostprocessUserPresets: presets,
      llmProviderModels: {
        ollama: 'llama3',
        openrouter: 'openai/gpt-4.1',
      },
    });
  });

  it('preserves a disabled transform while resetting its configuration', () => {
    const reset = resetLlmPostprocessDefaults({
      ...DEFAULT_PLUGIN_SETTINGS,
      llmPostprocessMode: 'off',
      llmPostprocessTemperature: 1.5,
    });

    expect(reset.llmPostprocessMode).toBe('off');
    expect(reset.llmPostprocessLastEnabledMode).toBe('per_utterance');
    expect(reset.llmPostprocessTemperature).toBe(DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature);
  });
});
