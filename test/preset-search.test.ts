import { describe, expect, it } from 'vitest';

import { describePresetBehavior, listPresetEntries } from '../src/llm/presets';
import { searchPresetEntries } from '../src/ui/preset-search';
import { createUserPreset } from './fixtures/llm';

// Stand-in for obsidian's prepareSimpleSearch: case-insensitive substring match.
function substringSearch(
  query: string,
): (text: string) => { score: number; matches: [number, number][] } | null {
  return (text) => {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    return index === -1 ? null : { score: 0, matches: [[index, index + query.length]] };
  };
}

describe('searchPresetEntries', () => {
  it('returns every entry without highlights when search is null', () => {
    const entries = listPresetEntries([createUserPreset()]);
    const hits = searchPresetEntries(entries, null);
    expect(hits.map((hit) => hit.entry)).toEqual(entries);
    expect(hits.every((hit) => hit.labelMatches === null && hit.descriptionMatches === null)).toBe(
      true,
    );
  });

  it('matches on label and reports label match offsets', () => {
    const entries = listPresetEntries([createUserPreset({ label: 'My transform' })]);
    const hits = searchPresetEntries(entries, substringSearch('transform'));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entry.preset.label).toBe('My transform');
    expect(hits[0]?.labelMatches).toEqual([[3, 12]]);
    expect(hits[0]?.descriptionMatches).toBeNull();
  });

  it('matches on description when the label does not match', () => {
    const hits = searchPresetEntries(listPresetEntries([]), substringSearch('checklist'));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entry.preset.id).toBe('action-items');
    expect(hits[0]?.labelMatches).toBeNull();
    expect(hits[0]?.descriptionMatches).not.toBeNull();
  });

  it('searches the behavior summary when a preset has no description', () => {
    const preset = createUserPreset();
    const entries = listPresetEntries([preset]).filter((entry) => !entry.isBuiltin);
    const hits = searchPresetEntries(entries, substringSearch('rewrites the dictated text'));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.description).toBe(describePresetBehavior(preset));
    expect(hits[0]?.descriptionMatches).not.toBeNull();
  });

  it('excludes entries that match neither label nor description', () => {
    const hits = searchPresetEntries(listPresetEntries([]), substringSearch('zzz-no-such-preset'));
    expect(hits).toEqual([]);
  });
});
