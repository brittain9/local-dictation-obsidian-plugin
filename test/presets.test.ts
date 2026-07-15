import { describe, expect, it } from 'vitest';

import {
  describePresetBehavior,
  getLlmBuiltinPreset,
  LLM_BUILTIN_PRESETS,
  listPresetEntries,
  resolveActivePresetEntry,
  resolveEffectiveLlmGlobals,
  resolvePresetEntry,
} from '../src/llm/presets';
import { createUserPreset } from './fixtures/llm';

const GLOBALS = { minWords: 4, temperature: 0.2, useNoteContext: false };

describe('LLM presets', () => {
  it('ships the approved built-in lineup', () => {
    expect(LLM_BUILTIN_PRESETS.map((preset) => preset.id)).toEqual([
      'clean-up',
      'professional-writing',
      'tldr',
      'markdown-formatting',
      'action-items',
    ]);
  });

  it('forbids implicit translation in every built-in transform', () => {
    for (const preset of LLM_BUILTIN_PRESETS) {
      expect(preset.prompt).toContain('original language');
      expect(preset.prompt).toContain('Never translate');
    }
  });

  it('tldr and action-items are batch-only additive presets', () => {
    const tldr = getLlmBuiltinPreset('tldr');
    expect(tldr.timing).toBe('batch');
    expect(tldr.output).toBe('add_above');
    expect(tldr.prompt).not.toMatch(/transcript with light cleanup/i);

    const actionItems = getLlmBuiltinPreset('action-items');
    expect(actionItems.timing).toBe('batch');
    expect(actionItems.output).toBe('add_below');
  });

  it('clean-up and professional-writing stay timing-agnostic replace presets', () => {
    for (const id of ['clean-up', 'professional-writing'] as const) {
      const preset = getLlmBuiltinPreset(id);
      expect(preset.timing).toBeUndefined();
      expect(preset.output).toBe('replace');
    }
  });

  it('listPresetEntries returns built-ins then user presets with refs', () => {
    const entries = listPresetEntries([createUserPreset({ id: 'abc' })]);
    expect(entries[0]).toMatchObject({ isBuiltin: true, ref: 'builtin:clean-up' });
    expect(entries.at(-1)).toMatchObject({ isBuiltin: false, ref: 'user:abc' });
  });

  it('resolvePresetEntry returns null for unknown refs (including removed built-ins)', () => {
    expect(resolvePresetEntry('builtin:voice-commands', [])).toBeNull();
    expect(resolvePresetEntry('builtin:brain-dump', [])).toBeNull();
    expect(resolvePresetEntry('user:missing', [])).toBeNull();
    expect(resolvePresetEntry(null, [])).toBeNull();
  });

  it('resolveActivePresetEntry falls back to clean-up', () => {
    expect(resolveActivePresetEntry('builtin:voice-commands', []).ref).toBe('builtin:clean-up');
    expect(resolveActivePresetEntry('user:abc', [createUserPreset({ id: 'abc' })]).ref).toBe(
      'user:abc',
    );
  });

  it('resolveEffectiveLlmGlobals applies per-field overrides', () => {
    const preset = createUserPreset({
      overrides: { temperature: 0.9, useNoteContext: true },
    });
    expect(resolveEffectiveLlmGlobals(GLOBALS, preset)).toEqual({
      minWords: 4,
      temperature: 0.9,
      useNoteContext: true,
    });
    expect(resolveEffectiveLlmGlobals(GLOBALS, createUserPreset())).toEqual(GLOBALS);
  });

  it('describePresetBehavior summarizes timing, output, and overrides', () => {
    expect(describePresetBehavior(getLlmBuiltinPreset('tldr'))).toBe(
      'Runs once on stop · adds new content above the transcript',
    );
    expect(
      describePresetBehavior(createUserPreset({ overrides: { minWords: 0, temperature: 1 } })),
    ).toBe('Runs in either mode · rewrites the dictated text · overrides min words, temperature');
  });
});
