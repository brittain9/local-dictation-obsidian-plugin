import { formatAcceleratorLabel } from '../settings/acceleration-info';
import { t } from '../shared/i18n';
import type { CompiledAdapterInfo, CompiledRuntimeInfo } from '../sidecar/protocol';
import type {
  EngineCapabilitiesRecord,
  ModelFamilyCapabilitiesRecord,
  ModelFamilyId,
  ModelFormat,
  RuntimeId,
} from './model-management-types';

const MODEL_FORMAT_LABELS: Record<ModelFormat, string> = {
  ggml: 'GGML',
  gguf: 'GGUF',
  onnx: 'ONNX',
};

export function resolveEngineCapabilities(
  compiledRuntimes: readonly CompiledRuntimeInfo[],
  compiledAdapters: readonly CompiledAdapterInfo[],
  runtimeId: RuntimeId,
  familyId: ModelFamilyId,
): EngineCapabilitiesRecord | null {
  const runtime = compiledRuntimes.find((r) => r.runtimeId === runtimeId);
  const adapter = compiledAdapters.find(
    (a) => a.runtimeId === runtimeId && a.familyId === familyId,
  );
  if (runtime === undefined || adapter === undefined) return null;
  return {
    family: adapter.familyCapabilities,
    familyId,
    runtime: runtime.runtimeCapabilities,
    runtimeId,
  };
}

export function buildCapabilityLabels(caps: EngineCapabilitiesRecord): string[] {
  const labels: string[] = [];

  const accelerators =
    caps.runtime.availableAccelerators.length > 0
      ? caps.runtime.availableAccelerators
      : (['cpu'] as const);
  for (const id of accelerators) {
    labels.push(formatAcceleratorLabel(id));
  }

  for (const format of caps.runtime.supportedModelFormats) {
    labels.push(MODEL_FORMAT_LABELS[format]);
  }

  if (caps.family.supportsSegmentTimestamps) labels.push(t('models.capability.segmentTimestamps'));
  if (caps.family.supportsWordTimestamps) labels.push(t('models.capability.wordTimestamps'));
  if (caps.family.supportsInitialPrompt) labels.push(t('models.capability.initialPrompt'));
  if (caps.family.supportsStreaming) labels.push(t('models.capability.streaming'));
  if (caps.family.supportsAutomaticLanguageDetection) {
    labels.push(t('models.capability.autoLanguageDetection'));
  }
  if (caps.family.producesPunctuation) labels.push(t('models.capability.punctuation'));

  const languageLabel = describeLanguageSupport(caps.family);
  if (languageLabel !== null) labels.push(languageLabel);

  if (caps.family.maxAudioDurationSecs !== null) {
    labels.push(
      t('models.capability.maxAudio', {
        seconds: Math.round(caps.family.maxAudioDurationSecs),
      }),
    );
  }

  return labels;
}

function describeLanguageSupport(family: ModelFamilyCapabilitiesRecord): string | null {
  switch (family.supportedLanguages.kind) {
    case 'all':
      return t('models.capability.anyLanguage');
    case 'english_only':
      return t('models.capability.englishOnly');
    case 'list':
      return t('models.capability.languageCount', {
        count: family.supportedLanguages.tags.length,
      });
    case 'unknown':
      return family.supportsLanguageSelection ? t('models.capability.languageSelection') : null;
  }
}
