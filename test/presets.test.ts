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

  it('preserves the approved English prompt bodies', () => {
    expect(LLM_BUILTIN_PRESETS.map((preset) => preset.prompt)).toEqual([
      "Clean dictated speech-to-text. Fix filler, false starts, repetitions, punctuation, capitalization, and obvious recognition errors. Preserve the speaker's voice and meaning. Use the reference context only for spelling. Write in the transcript’s original language. Never translate unless the user explicitly asks for translation. Return only the cleaned text — no preamble, no commentary.",
      'Rewrite dictated speech as concise professional prose. Active voice, no filler or hedging. Preserve every fact, name, and term. Use the reference context for spelling. Write in the transcript’s original language. Never translate unless the user explicitly asks for translation. Return only the rewritten text — no preamble, no commentary.',
      "Write a TLDR summary of the dictated transcript: a 'TLDR' heading followed by 1-3 short bullets covering the key points. Write in the transcript’s original language. Never translate unless the user explicitly asks for translation. Return only the heading and bullets — do not repeat the transcript, no preamble, no commentary.",
      "Reformat dictated speech as well-structured Markdown. Add headings, bullet or numbered lists, bold, emphasis, and fenced code blocks where the content calls for it. Lightly clean filler, false starts, punctuation, and capitalization; preserve the speaker's wording, every fact, name, and term. Write in the transcript’s original language. Never translate unless the user explicitly asks for translation. Return only the Markdown — no preamble, no commentary.",
      "Extract action items from the dictated transcript. Output an 'Action items' heading followed by a Markdown checklist of concrete tasks, naming an owner when the speaker mentions one. If the transcript contains no action items, return nothing. Write in the transcript’s original language. Never translate unless the user explicitly asks for translation. Return only the heading and checklist — do not repeat the transcript, no preamble, no commentary.",
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
