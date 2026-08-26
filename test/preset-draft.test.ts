import { describe, expect, it } from 'vitest';

import { getLlmBuiltinPreset } from '../src/llm/presets';
import type { LlmPresetState } from '../src/settings/llm-preset-state';
import {
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
} from '../src/settings/plugin-settings';
import {
  applyPresetDraftSave,
  draftFromPreset,
  duplicateLabel,
  emptyPresetDraft,
  validatePresetDraft,
} from '../src/ui/preset-draft';
import { createUserPreset } from './fixtures/llm';

const NO_LABELS: string[] = [];

function stateWith(presets: LlmPresetState['userPresets']): LlmPresetState {
  return { activePresetRef: 'builtin:clean-up', userPresets: presets };
}

describe('preset draft validation', () => {
  it('accepts a minimal valid draft and omits inherited overrides', () => {
    const result = validatePresetDraft(
      { ...emptyPresetDraft(), label: 'Mine', prompt: 'Do the thing.' },
      NO_LABELS,
    );
    expect(result).toEqual({
      kind: 'ok',
      preset: { label: 'Mine', output: 'replace', prompt: 'Do the thing.' },
    });
  });

  it('rejects empty or duplicate names (case-insensitive) and empty prompts', () => {
    const base = { ...emptyPresetDraft(), label: 'Mine', prompt: 'p' };
    expect(validatePresetDraft({ ...base, label: '  ' }, NO_LABELS).kind).toBe('error');
    expect(validatePresetDraft(base, ['mine']).kind).toBe('error');
    expect(validatePresetDraft({ ...base, prompt: '' }, NO_LABELS).kind).toBe('error');
  });

  it('parses override fields and rejects out-of-range values', () => {
    const base = { ...emptyPresetDraft(), label: 'Mine', prompt: 'p' };
    const ok = validatePresetDraft(
      { ...base, minWords: '3', temperature: '0.7', useNoteContext: 'on' },
      NO_LABELS,
    );
    expect(ok).toMatchObject({
      kind: 'ok',
      preset: { overrides: { minWords: 3, temperature: 0.7, useNoteContext: true } },
    });
    expect(validatePresetDraft({ ...base, minWords: '99' }, NO_LABELS).kind).toBe('error');
    expect(validatePresetDraft({ ...base, temperature: 'abc' }, NO_LABELS).kind).toBe('error');
  });

  it.each([
    ['fractional min words', { minWords: '7.5' }],
    ['partial min words', { minWords: '7 words' }],
    ['exponent temperature', { temperature: '1e0' }],
    ['partial temperature', { temperature: '0.7 degrees' }],
  ])('rejects %s input instead of accepting its numeric prefix', (_case, override) => {
    const base = { ...emptyPresetDraft(), label: 'Mine', prompt: 'p' };

    expect(validatePresetDraft({ ...base, ...override }, NO_LABELS).kind).toBe('error');
  });

  it('forces batch timing for additive output', () => {
    const result = validatePresetDraft(
      { ...emptyPresetDraft(), label: 'Adder', output: 'add_below', prompt: 'p', timing: 'either' },
      NO_LABELS,
    );
    expect(result).toMatchObject({ kind: 'ok', preset: { output: 'add_below', timing: 'batch' } });
  });

  it('duplicateLabel picks the first free (copy N) name, case-insensitively', () => {
    expect(duplicateLabel('Mine', [])).toBe('Mine (copy)');
    expect(duplicateLabel('Mine', ['mine (COPY)'])).toBe('Mine (copy 2)');
    expect(duplicateLabel('Mine', ['Mine (copy)', 'Mine (copy 2)'])).toBe('Mine (copy 3)');
  });

  it('duplicateLabel numbers up from an existing copy instead of stacking suffixes', () => {
    expect(duplicateLabel('Mine (copy)', ['Mine', 'Mine (copy)'])).toBe('Mine (copy 2)');
    expect(duplicateLabel('Mine (copy 2)', ['Mine (copy)', 'Mine (copy 2)'])).toBe('Mine (copy 3)');
  });

  it('duplicateLabel numbers localized copies without stacking suffixes', () => {
    const germanCopy = {
      copy: ' (Kopie)',
      numberedCopy: (number: number) => ` (Kopie ${number})`,
    };

    expect(duplicateLabel('Meine (Kopie)', ['Meine', 'Meine (Kopie)'], germanCopy)).toBe(
      'Meine (Kopie 2)',
    );
    expect(
      duplicateLabel('Meine (Kopie 2)', ['Meine (Kopie)', 'Meine (Kopie 2)'], germanCopy),
    ).toBe('Meine (Kopie 3)');
  });

  it('duplicateLabel recognizes an English suffix after the UI locale changes', () => {
    const germanCopy = {
      copy: ' (Kopie)',
      numberedCopy: (number: number) => ` (Kopie ${number})`,
    };

    expect(duplicateLabel('Meine (copy)', ['Meine (copy)', 'Meine (Kopie)'], germanCopy)).toBe(
      'Meine (Kopie 2)',
    );
    expect(duplicateLabel('Meine (copy 2)', ['Meine (Kopie)', 'Meine (Kopie 2)'], germanCopy)).toBe(
      'Meine (Kopie 3)',
    );
  });

  it('duplicateLabel keeps the (copy) suffix within the label limit', () => {
    const atLimit = duplicateLabel('L'.repeat(LLM_USER_PRESET_MAX_LABEL_CHARS), []);
    expect(atLimit.endsWith(' (copy)')).toBe(true);
    expect(atLimit.length).toBeLessThanOrEqual(LLM_USER_PRESET_MAX_LABEL_CHARS);
  });

  it('draftFromPreset round-trips a built-in for duplication', () => {
    const draft = draftFromPreset(getLlmBuiltinPreset('tldr'));
    expect(draft).toMatchObject({
      output: 'add_above',
      prompt: getLlmBuiltinPreset('tldr').prompt,
      timing: 'batch',
    });
  });
});

describe('applyPresetDraftSave', () => {
  const draft = { ...emptyPresetDraft(), label: 'Mine', prompt: 'Do the thing.' };

  it('creates a new preset with a fresh id', () => {
    const result = applyPresetDraftSave(stateWith([]), draft, null);
    expect(result.error).toBeNull();
    expect(result.state.userPresets).toHaveLength(1);
    expect(result.state.userPresets[0]).toMatchObject({ label: 'Mine', prompt: 'Do the thing.' });
    expect(result.state.userPresets[0]?.id).toBeTruthy();
  });

  it('updates the edited preset in place, keeping its id', () => {
    const existing = createUserPreset({ id: 'p1', label: 'Old name' });
    const result = applyPresetDraftSave(stateWith([existing]), draft, 'p1');
    expect(result.error).toBeNull();
    expect(result.state.userPresets).toEqual([
      { id: 'p1', label: 'Mine', output: 'replace', prompt: 'Do the thing.' },
    ]);
  });

  it('re-adds an edited preset whose id vanished instead of dropping the edits', () => {
    const result = applyPresetDraftSave(stateWith([]), draft, 'deleted-elsewhere');
    expect(result.error).toBeNull();
    expect(result.state.userPresets).toEqual([
      { id: 'deleted-elsewhere', label: 'Mine', output: 'replace', prompt: 'Do the thing.' },
    ]);
  });

  it('rejects names colliding with built-ins or other user presets', () => {
    const builtinClash = applyPresetDraftSave(stateWith([]), { ...draft, label: 'clean up' }, null);
    expect(builtinClash.error).toMatch(/built-in/);
    expect(builtinClash.state.userPresets).toEqual([]);

    const existing = createUserPreset({ id: 'p1', label: 'Mine' });
    const userClash = applyPresetDraftSave(
      stateWith([existing]),
      { ...draft, label: 'MINE' },
      null,
    );
    expect(userClash.error).toMatch(/already exists/);

    // Keeping your own name while editing is not a collision.
    const selfEdit = applyPresetDraftSave(stateWith([existing]), draft, 'p1');
    expect(selfEdit.error).toBeNull();
  });

  it('enforces the preset cap for new presets', () => {
    const full = Array.from({ length: LLM_USER_PRESET_MAX_COUNT }, (_, index) =>
      createUserPreset({ id: `p${index}`, label: `Preset ${index}` }),
    );
    const result = applyPresetDraftSave(stateWith(full), draft, null);
    expect(result.error).toMatch(/up to/);
    expect(result.state.userPresets).toHaveLength(LLM_USER_PRESET_MAX_COUNT);
  });
});
