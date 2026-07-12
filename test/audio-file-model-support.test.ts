import { describe, expect, it } from 'vitest';

import {
  describeAudioFileModelRequirement,
  resolveAudioFileModelSupport,
} from '../src/audio/audio-file-model-support';
import type { EngineCapabilitiesRecord, SelectedModel } from '../src/models/model-management-types';

const WHISPER_SELECTION: SelectedModel = {
  familyId: 'whisper',
  filePath: '/models/whisper.bin',
  kind: 'external_file',
  runtimeId: 'whisper_cpp',
};

function capabilities(supportsStreaming: boolean): EngineCapabilitiesRecord {
  return {
    family: {
      maxAudioDurationSecs: null,
      producesPunctuation: true,
      supportedLanguages: { kind: 'english_only' },
      supportsInitialPrompt: true,
      supportsLanguageSelection: false,
      supportsSegmentTimestamps: true,
      supportsStreaming,
      supportsWordTimestamps: true,
    },
    familyId: supportsStreaming ? 'moonshine' : 'whisper',
    runtime: {
      acceleratorDetails: {},
      availableAccelerators: ['cpu'],
      supportedModelFormats: [supportsStreaming ? 'onnx' : 'ggml'],
    },
    runtimeId: supportsStreaming ? 'onnx_runtime' : 'whisper_cpp',
  };
}

describe('audio file model support', () => {
  it('requires a model before the file picker can open', () => {
    expect(
      resolveAudioFileModelSupport({
        selectedModel: null,
        selectedModelCapabilitiesSnapshot: null,
      }),
    ).toEqual({ kind: 'model_required' });
  });

  it('accepts a matching batch-model capability snapshot', () => {
    expect(
      resolveAudioFileModelSupport({
        selectedModel: WHISPER_SELECTION,
        selectedModelCapabilitiesSnapshot: {
          capabilities: capabilities(false),
          selection: WHISPER_SELECTION,
        },
      }),
    ).toEqual({ kind: 'supported' });
  });

  it('rejects a stale snapshot even when its capabilities would be supported', () => {
    const support = resolveAudioFileModelSupport({
      selectedModel: WHISPER_SELECTION,
      selectedModelCapabilitiesSnapshot: {
        capabilities: capabilities(false),
        selection: { ...WHISPER_SELECTION, filePath: '/models/old.bin' },
      },
    });

    expect(support).toEqual({ kind: 'capabilities_unavailable' });
    if (support.kind === 'capabilities_unavailable') {
      expect(describeAudioFileModelRequirement(support).actionLabel).toBe('Manage models');
    }
  });

  it('rejects streaming models with actionable batch-model guidance', () => {
    const moonshine: SelectedModel = {
      familyId: 'moonshine',
      filePath: '/models/moonshine.onnx',
      kind: 'external_file',
      runtimeId: 'onnx_runtime',
    };
    const support = resolveAudioFileModelSupport({
      selectedModel: moonshine,
      selectedModelCapabilitiesSnapshot: {
        capabilities: capabilities(true),
        selection: moonshine,
      },
    });

    expect(support).toEqual({ kind: 'streaming_unsupported' });
    if (support.kind === 'streaming_unsupported') {
      const requirement = describeAudioFileModelRequirement(support);
      expect(requirement.actionLabel).toBe('Choose a batch model');
      expect(requirement.message).toMatch(/Whisper or Cohere Transcribe/u);
    }
  });
});
