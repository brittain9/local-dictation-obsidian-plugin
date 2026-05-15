import { describe, expect, it } from 'vitest';

import { findMatchingStyleRef, getLlmBuiltinPreset } from '../src/llm/presets';

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
});
