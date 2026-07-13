const MODEL_TAG_LABELS: Readonly<Record<string, string>> = {
  cpu: 'CPU',
  gpu: 'GPU',
  starter: 'Recommended',
};

export function formatModelTagLabel(tag: string): string {
  const knownLabel = MODEL_TAG_LABELS[tag];
  if (knownLabel !== undefined) {
    return knownLabel;
  }

  const firstCharacter = tag.at(0);
  return firstCharacter === undefined ? tag : `${firstCharacter.toUpperCase()}${tag.slice(1)}`;
}
