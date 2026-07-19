import { t } from '../shared/i18n';

const MODEL_TAG_LABELS: Readonly<Record<string, string>> = {
  cpu: 'CPU',
  'full-precision': t('models.tag.fullPrecision'),
  gpu: 'GPU',
  'reduced-size': t('models.tag.reducedSize'),
};

export function formatModelTagLabel(tag: string): string {
  const knownLabel = MODEL_TAG_LABELS[tag];
  if (knownLabel !== undefined) {
    return knownLabel;
  }

  const firstCharacter = tag.at(0);
  return firstCharacter === undefined ? tag : `${firstCharacter.toUpperCase()}${tag.slice(1)}`;
}
