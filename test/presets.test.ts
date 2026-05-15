import { describe, expect, it } from 'vitest';

import {
  findMatchingStyleRef,
  getLlmBuiltinPreset,
  listStyleOptions,
  resolveStyleOption,
} from '../src/llm/presets';

describe('LLM presets', () => {
  it('findMatchingStyleRef matches on prompt only', () => {
    expect(findMatchingStyleRef(getLlmBuiltinPreset('clean-up').prompt, [])).toBe(
      'builtin:clean-up',
    );
    expect(
      findMatchingStyleRef('custom prompt', [
        {
          description: '',
          id: 'custom',
          label: 'Custom',
          prompt: 'custom prompt',
        },
      ]),
    ).toBe('user:custom');
    expect(findMatchingStyleRef('missing prompt', [])).toBeNull();
  });

  it('exposes a batch-only TLDR built-in', () => {
    const tldr = getLlmBuiltinPreset('tldr');
    expect(tldr.mode).toBe('batch');
    expect(tldr.prompt).toMatch(/TLDR/);
  });

  it('clean-up and professional-writing built-ins are mode-agnostic', () => {
    expect(getLlmBuiltinPreset('clean-up').mode).toBeUndefined();
    expect(getLlmBuiltinPreset('professional-writing').mode).toBeUndefined();
  });

  it('listStyleOptions propagates the mode field', () => {
    const options = listStyleOptions([
      {
        description: '',
        id: 'batchy',
        label: 'My batch style',
        mode: 'batch',
        prompt: 'X',
      },
      {
        description: '',
        id: 'agnostic',
        label: 'Either-mode style',
        prompt: 'Y',
      },
    ]);

    const byRef = Object.fromEntries(options.map((option) => [option.ref, option]));
    expect(byRef['builtin:tldr']?.mode).toBe('batch');
    expect(byRef['builtin:clean-up']?.mode).toBeUndefined();
    expect(byRef['user:batchy']?.mode).toBe('batch');
    expect(byRef['user:agnostic']?.mode).toBeUndefined();
  });

  it('resolveStyleOption returns the user preset with its mode', () => {
    const userPreset = {
      description: '',
      id: 'phrasey',
      label: 'Phrase style',
      mode: 'per_utterance' as const,
      prompt: 'P',
    };
    const option = resolveStyleOption('user:phrasey', [userPreset]);
    expect(option?.mode).toBe('per_utterance');
  });
});
