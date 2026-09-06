import { t } from '../shared/i18n';

const MODEL_TAG_LABELS: Readonly<Record<string, string>> = {
  accuracy: t('models.tag.accuracy'),
  balanced: t('models.tag.balanced'),
  cpu: 'CPU',
  'cpu-fallback': 'CPU fallback',
  cuda: 'CUDA',
  fast: t('models.tag.fast'),
  'full-precision': t('models.tag.fullPrecision'),
  gpu: 'GPU capable',
  heavy: t('models.tag.heavy'),
  'high-cpu': t('models.tag.highCpu'),
  lightweight: t('models.tag.lightweight'),
  'may-buffer': t('models.tag.mayBuffer'),
  metal: 'Metal',
  multilingual: t('models.tag.multilingual'),
  optional: t('models.tag.optional'),
  'read-aloud': t('models.tag.readAloud'),
  recommended: t('models.tag.recommended'),
  'reduced-size': t('models.tag.reducedSize'),
  'requires-terms-review': t('models.tag.termsApply'),
  smallest: t('models.tag.smallest'),
  streaming: t('models.capability.streaming'),
  vulkan: 'Vulkan',
};

const RUNTIME_DERIVED_TAGS = new Set([
  'cpu',
  'cpu-fallback',
  'cuda',
  'gpu',
  'metal',
  'streaming',
  'vulkan',
]);

export function formatModelTagLabel(tag: string): string {
  const knownLabel = MODEL_TAG_LABELS[tag];
  if (knownLabel !== undefined) {
    return knownLabel;
  }

  const firstCharacter = tag.at(0);
  return firstCharacter === undefined ? tag : `${firstCharacter.toUpperCase()}${tag.slice(1)}`;
}

export function isRuntimeDerivedModelTag(tag: string): boolean {
  return RUNTIME_DERIVED_TAGS.has(tag);
}
