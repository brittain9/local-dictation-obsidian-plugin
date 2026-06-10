import { describe, expect, it } from 'vitest';

import { getLlmBuiltinPreset } from '../src/llm/presets';
import { draftFromPreset, emptyPresetDraft, validatePresetDraft } from '../src/ui/preset-draft';

const NO_LABELS: string[] = [];

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

  it('forces batch timing for additive output', () => {
    const result = validatePresetDraft(
      { ...emptyPresetDraft(), label: 'Adder', output: 'add_below', prompt: 'p', timing: 'either' },
      NO_LABELS,
    );
    expect(result).toMatchObject({ kind: 'ok', preset: { output: 'add_below', timing: 'batch' } });
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
