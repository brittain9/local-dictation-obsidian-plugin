import { selectedModelEquals } from '../models/model-management-types';
import type { PluginSettings } from '../settings/plugin-settings';

type AudioFileModelSettings = Pick<
  PluginSettings,
  'selectedModel' | 'selectedModelCapabilitiesSnapshot'
>;

export type AudioFileModelSupport =
  | { kind: 'capabilities_unavailable' }
  | { kind: 'model_required' }
  | { kind: 'streaming_unsupported' }
  | { kind: 'supported' };

export function resolveAudioFileModelSupport(
  settings: AudioFileModelSettings,
): AudioFileModelSupport {
  if (settings.selectedModel === null) {
    return { kind: 'model_required' };
  }

  const snapshot = settings.selectedModelCapabilitiesSnapshot;
  if (snapshot === null || !selectedModelEquals(snapshot.selection, settings.selectedModel)) {
    return { kind: 'capabilities_unavailable' };
  }

  return snapshot.capabilities.family.supportsStreaming
    ? { kind: 'streaming_unsupported' }
    : { kind: 'supported' };
}

export function describeAudioFileModelRequirement(
  support: Exclude<AudioFileModelSupport, { kind: 'model_required' | 'supported' }>,
): { actionLabel: string; message: string } {
  if (support.kind === 'streaming_unsupported') {
    return {
      actionLabel: 'Choose a batch model',
      message:
        'Audio file transcription currently requires a batch model. Choose a Whisper or Cohere Transcribe model, then try again.',
    };
  }
  return {
    actionLabel: 'Manage models',
    message: 'Verify the selected model in Manage models before transcribing an audio file.',
  };
}
