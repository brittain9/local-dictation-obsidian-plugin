import type { SearchMatches, SearchResult } from 'obsidian';

import { describePresetBehavior, type LlmPresetEntry } from '../llm/presets';

export interface PresetSearchHit {
  entry: LlmPresetEntry;
  // The text shown (and searched) as the row description.
  description: string;
  labelMatches: SearchMatches | null;
  descriptionMatches: SearchMatches | null;
}

export function searchPresetEntries(
  entries: readonly LlmPresetEntry[],
  search: ((text: string) => SearchResult | null) | null,
): PresetSearchHit[] {
  const hits: PresetSearchHit[] = [];
  for (const entry of entries) {
    const description = entry.preset.description ?? describePresetBehavior(entry.preset);
    if (search === null) {
      hits.push({ entry, description, labelMatches: null, descriptionMatches: null });
      continue;
    }
    const labelResult = search(entry.preset.label);
    const descriptionResult = search(description);
    if (labelResult === null && descriptionResult === null) {
      continue;
    }
    hits.push({
      entry,
      description,
      labelMatches: labelResult?.matches ?? null,
      descriptionMatches: descriptionResult?.matches ?? null,
    });
  }
  return hits;
}
