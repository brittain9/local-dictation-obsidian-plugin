import { formatAcceleratorLabel } from '../settings/acceleration-info';
import { t, tPlural } from '../shared/i18n';
import type { CompiledAdapterInfo, CompiledRuntimeInfo } from '../sidecar/protocol';
import type {
  AcceleratorId,
  CatalogModelRecord,
  EngineCapabilitiesRecord,
  ModelFamilyCapabilitiesRecord,
  ModelFamilyId,
  ModelFormat,
  RuntimeId,
} from './model-management-types';

const MODEL_FORMAT_LABELS: Record<ModelFormat, string> = {
  bergamot: 'Bergamot',
  ggml: 'GGML',
  gguf: 'GGUF',
  onnx: 'ONNX',
};

const ACCELERATOR_DISPLAY_ORDER: readonly AcceleratorId[] = [
  'cuda',
  'metal',
  'direct_ml',
  'vulkan',
  'cpu',
];

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

export function buildCapabilityLabels(
  caps: EngineCapabilitiesRecord,
  options: { includeLanguageSupport?: boolean } = {},
): string[] {
  const labels: string[] = [];

  const accelerators =
    caps.family.supportsHardwareAcceleration && caps.runtime.availableAccelerators.length > 0
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

  if (options.includeLanguageSupport ?? true) {
    const languageLabel = describeLanguageSupport(caps.family);
    if (languageLabel !== null) labels.push(languageLabel);
  }

  if (caps.family.maxAudioDurationSecs !== null) {
    labels.push(
      t('models.capability.maxAudio', {
        seconds: Math.round(caps.family.maxAudioDurationSecs),
      }),
    );
  }

  return labels;
}

/**
 * Builds the concrete capability tags shown on a catalog row. Unlike the
 * engine details view, these labels combine family capabilities with facts
 * from the exact artifact being offered, so an English-only Whisper file does
 * not inherit multilingual auto-detection from the Whisper family.
 */
export function buildModelRowCapabilityLabels(
  model: CatalogModelRecord,
  caps: EngineCapabilitiesRecord,
): string[] {
  if (
    caps.runtimeId !== model.runtimeId ||
    caps.familyId !== model.familyId ||
    caps.family.task !== model.task
  ) {
    return [];
  }

  const labels = [
    describeExecutionBackends(model, caps),
    ...describeCatalogModelFormats(model, caps),
  ];
  const family = caps.family;

  if (family.supportsStreaming) {
    labels.push(t('models.capability.streaming'));
  } else if (model.task === 'stt') {
    labels.push(t('models.capability.afterPause'));
  } else if (model.task === 'translation') {
    labels.push(t('models.capability.batch'));
  }

  if (family.supportsSegmentTimestamps) labels.push(t('models.capability.segmentTimestamps'));
  if (family.supportsWordTimestamps) labels.push(t('models.capability.wordTimestamps'));
  if (family.supportsInitialPrompt) labels.push(t('models.capability.initialPrompt'));
  if (family.supportsLanguageSelection && model.languageTags.length > 1) {
    labels.push(t('models.capability.languageSelection'));
  }
  if (family.supportsAutomaticLanguageDetection && model.supportsAutomaticLanguageDetection) {
    labels.push(t('models.capability.autoLanguageDetection'));
  }
  if (family.producesPunctuation) labels.push(t('models.capability.punctuation'));
  if (family.supportsSpeedControl) labels.push(t('models.capability.speedControl'));
  if (model.task === 'stt') {
    labels.push(
      t(
        family.supportsStreaming
          ? 'models.capability.noSpeakerLabels'
          : 'models.capability.speakerLabels',
      ),
    );
  }

  if (family.outputSampleRate !== null) {
    labels.push(formatSampleRate(family.outputSampleRate));
  }

  const voiceCount = new Set(
    model.artifacts
      .filter((artifact) => artifact.role === 'voice' && artifact.voiceId !== undefined)
      .map((artifact) => artifact.voiceId),
  ).size;
  if (voiceCount > 0) {
    labels.push(
      tPlural(
        voiceCount,
        {
          one: 'models.capability.voiceCountOne',
          other: 'models.capability.voiceCountOther',
        },
        { count: voiceCount },
      ),
    );
  }

  if (family.maxAudioDurationSecs !== null) {
    labels.push(
      t('models.capability.maxAudio', {
        seconds: Math.round(family.maxAudioDurationSecs),
      }),
    );
  }

  return [...new Set(labels)];
}

function describeExecutionBackends(
  model: CatalogModelRecord,
  caps: EngineCapabilitiesRecord,
): string {
  if (!caps.family.supportsHardwareAcceleration) return 'CPU';

  const available = new Set(caps.runtime.availableAccelerators);
  const supported =
    model.supportedAccelerators === undefined || model.supportedAccelerators.length === 0
      ? available
      : new Set(model.supportedAccelerators.filter((accelerator) => available.has(accelerator)));
  const gpuLabels = ACCELERATOR_DISPLAY_ORDER.filter(
    (accelerator) => accelerator !== 'cpu' && supported.has(accelerator),
  ).map(formatAcceleratorLabel);
  if (gpuLabels.length === 0) return 'CPU';

  const accelerators = gpuLabels.join(' + ');
  return supported.has('cpu')
    ? t('models.capability.acceleratorsWithCpuFallback', { accelerators })
    : accelerators;
}

function describeCatalogModelFormats(
  model: CatalogModelRecord,
  caps: EngineCapabilitiesRecord,
): string[] {
  const formats = new Set<ModelFormat>();
  if (model.runtimeId === 'bergamot_wasm') formats.add('bergamot');

  for (const artifact of model.artifacts) {
    const filename = artifact.filename.toLocaleLowerCase();
    if (filename.endsWith('.gguf')) formats.add('gguf');
    if (filename.endsWith('.onnx') || filename.endsWith('.ort')) formats.add('onnx');
    if (model.runtimeId === 'whisper_cpp' && filename.endsWith('.bin')) formats.add('ggml');
  }

  if (formats.size === 0 && caps.runtime.supportedModelFormats.length === 1) {
    const onlyFormat = caps.runtime.supportedModelFormats[0];
    if (onlyFormat !== undefined) formats.add(onlyFormat);
  }

  return caps.runtime.supportedModelFormats
    .filter((format) => formats.has(format))
    .map((format) => MODEL_FORMAT_LABELS[format]);
}

function formatSampleRate(sampleRate: number): string {
  const kilohertz = sampleRate / 1_000;
  return `${Number.isInteger(kilohertz) ? kilohertz : kilohertz.toFixed(1)} kHz`;
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
