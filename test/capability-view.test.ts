import { describe, expect, it } from 'vitest';

import { buildCapabilityLabels, resolveEngineCapabilities } from '../src/models/capability-view';
import type {
  EngineCapabilitiesRecord,
  ModelFamilyCapabilitiesRecord,
  RuntimeCapabilitiesRecord,
} from '../src/models/model-management-types';
import type { CompiledAdapterInfo, CompiledRuntimeInfo } from '../src/sidecar/protocol';

const RUNTIME_CAPS_DEFAULT: RuntimeCapabilitiesRecord = {
  acceleratorDetails: { cpu: { available: true, unavailableReason: null } },
  availableAccelerators: ['cpu'],
  supportedModelFormats: ['ggml'],
};

const FAMILY_CAPS_DEFAULT: ModelFamilyCapabilitiesRecord = {
  availableVoices: [],
  maxAudioDurationSecs: null,
  producesPunctuation: false,
  outputSampleRate: null,
  supportedLanguages: { kind: 'all' },
  supportsInitialPrompt: false,
  supportsStreaming: false,
  supportsSpeedControl: false,
  supportsLanguageSelection: false,
  supportsAutomaticLanguageDetection: false,
  supportsSegmentTimestamps: false,
  supportsWordTimestamps: false,
  task: 'stt',
};

function runtime(
  runtimeId: 'whisper_cpp' | 'onnx_runtime' = 'whisper_cpp',
  overrides: Partial<RuntimeCapabilitiesRecord> = {},
): CompiledRuntimeInfo {
  return {
    displayName: runtimeId,
    runtimeCapabilities: { ...RUNTIME_CAPS_DEFAULT, ...overrides },
    runtimeId,
  };
}

function adapter(
  runtimeId: 'whisper_cpp' | 'onnx_runtime' = 'whisper_cpp',
  familyId: 'whisper' | 'cohere_transcribe' | 'moonshine' = 'whisper',
  overrides: Partial<ModelFamilyCapabilitiesRecord> = {},
): CompiledAdapterInfo {
  return {
    displayName: familyId,
    familyCapabilities: { ...FAMILY_CAPS_DEFAULT, ...overrides },
    familyId,
    runtimeId,
  };
}

function caps(
  overrides: {
    runtime?: Partial<RuntimeCapabilitiesRecord>;
    family?: Partial<ModelFamilyCapabilitiesRecord>;
  } = {},
): EngineCapabilitiesRecord {
  return {
    family: { ...FAMILY_CAPS_DEFAULT, ...overrides.family },
    familyId: 'whisper',
    runtime: { ...RUNTIME_CAPS_DEFAULT, ...overrides.runtime },
    runtimeId: 'whisper_cpp',
  };
}

describe('resolveEngineCapabilities', () => {
  it('returns merged caps when both the runtime and family adapter are registered', () => {
    expect(resolveEngineCapabilities([runtime()], [adapter()], 'whisper_cpp', 'whisper')).toEqual({
      family: FAMILY_CAPS_DEFAULT,
      familyId: 'whisper',
      runtime: RUNTIME_CAPS_DEFAULT,
      runtimeId: 'whisper_cpp',
    });
  });

  it('returns null when the runtime is not present', () => {
    expect(resolveEngineCapabilities([], [adapter()], 'whisper_cpp', 'whisper')).toBeNull();
  });

  it('returns null when the family adapter is not paired with this runtime', () => {
    // Adapter exists for onnx + whisper but we ask about whisper_cpp + whisper.
    expect(
      resolveEngineCapabilities(
        [runtime()],
        [adapter('onnx_runtime', 'whisper')],
        'whisper_cpp',
        'whisper',
      ),
    ).toBeNull();
  });
});

describe('buildCapabilityLabels', () => {
  it('always lists at least one accelerator and falls back to CPU when none are available', () => {
    // Empty availableAccelerators is a real wire-format possibility on CPU-only builds
    // where the runtime hasn't declared an explicit accelerator list.
    const labels = buildCapabilityLabels(caps({ runtime: { availableAccelerators: [] } }));

    expect(labels[0]).toBe('CPU');
  });

  it('lists every supported model format using the canonical UI casing', () => {
    const labels = buildCapabilityLabels(
      caps({ runtime: { supportedModelFormats: ['ggml', 'gguf', 'onnx'] } }),
    );

    expect(labels).toEqual(expect.arrayContaining(['GGML', 'GGUF', 'ONNX']));
  });

  it('emits a label for each enabled family-level feature flag', () => {
    const labels = buildCapabilityLabels(
      caps({
        family: {
          producesPunctuation: true,
          supportsInitialPrompt: true,
          supportsStreaming: true,
          supportsSegmentTimestamps: true,
          supportsWordTimestamps: true,
        },
      }),
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        'Segment timestamps',
        'Word timestamps',
        'Initial prompt',
        'Streaming',
        'Punctuation',
      ]),
    );
  });

  it('omits feature labels when the corresponding flag is false', () => {
    const labels = buildCapabilityLabels(caps());

    expect(labels).not.toContain('Segment timestamps');
    expect(labels).not.toContain('Word timestamps');
    expect(labels).not.toContain('Initial prompt');
    expect(labels).not.toContain('Streaming');
    expect(labels).not.toContain('Punctuation');
  });

  it.each([
    [{ kind: 'all' as const }, 'Any language'],
    [{ kind: 'english_only' as const }, 'English only'],
  ])('describes supportedLanguages.kind=%j as %s', (supportedLanguages, expected) => {
    const labels = buildCapabilityLabels(caps({ family: { supportedLanguages } }));

    expect(labels).toContain(expected);
  });

  it('counts the entries when supportedLanguages is an explicit list', () => {
    const labels = buildCapabilityLabels(
      caps({
        family: {
          supportedLanguages: { kind: 'list', tags: ['en', 'fr', 'de'] },
        },
      }),
    );

    expect(labels).toContain('3 languages');
  });

  it('uses "Language selection" for unknown languages when language selection is supported', () => {
    const labels = buildCapabilityLabels(
      caps({
        family: {
          supportedLanguages: { kind: 'unknown' },
          supportsLanguageSelection: true,
        },
      }),
    );

    expect(labels).toContain('Language selection');
  });

  it('emits no language label for unknown languages when selection is not supported', () => {
    const labels = buildCapabilityLabels(
      caps({
        family: {
          supportedLanguages: { kind: 'unknown' },
          supportsLanguageSelection: false,
        },
      }),
    );

    // No language-related label should appear.
    expect(labels.some((label) => /language/iu.test(label))).toBe(false);
  });

  it('formats max audio duration as rounded seconds when specified', () => {
    const labels = buildCapabilityLabels(caps({ family: { maxAudioDurationSecs: 30.4 } }));

    expect(labels).toContain('Max audio: 30s');
  });

  it('omits the max-audio label when maxAudioDurationSecs is null', () => {
    const labels = buildCapabilityLabels(caps({ family: { maxAudioDurationSecs: null } }));

    expect(labels.some((label) => label.startsWith('Max audio'))).toBe(false);
  });
});
