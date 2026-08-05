import { describe, expect, it } from 'vitest';

import {
  activeLlmProviderIds,
  normalizeLlmRoutingPolicy,
  selectLlmProviderId,
} from '../../src/llm/routing-policy';

describe('LLM routing policy', () => {
  it('normalizes fixed and transcript-size policies', () => {
    expect(normalizeLlmRoutingPolicy({ kind: 'fixed', providerId: 'openai_compatible' })).toEqual({
      kind: 'fixed',
      providerId: 'openai_compatible',
    });
    expect(
      normalizeLlmRoutingPolicy({
        defaultProviderId: 'ollama',
        kind: 'transcript_size',
        largeTranscriptProviderId: 'openrouter',
        thresholdChars: 100,
      }),
    ).toEqual({
      defaultProviderId: 'ollama',
      kind: 'transcript_size',
      largeTranscriptProviderId: 'openrouter',
      thresholdChars: 100,
    });
  });

  it('collapses identical size-routing legs to a fixed policy', () => {
    expect(
      normalizeLlmRoutingPolicy({
        defaultProviderId: 'ollama',
        kind: 'transcript_size',
        largeTranscriptProviderId: 'ollama',
        thresholdChars: 100,
      }),
    ).toEqual({ kind: 'fixed', providerId: 'ollama' });
  });

  it.each([{}, { kind: 'fixed', providerId: 'unknown' }, { kind: 'transcript_size' }])(
    'rejects malformed policy %#',
    (value) => {
      expect(normalizeLlmRoutingPolicy(value)).toBeNull();
    },
  );

  it('uses the default at the threshold and the large provider above it', () => {
    const policy = {
      defaultProviderId: 'ollama' as const,
      kind: 'transcript_size' as const,
      largeTranscriptProviderId: 'openrouter' as const,
      thresholdChars: 100,
    };

    expect(selectLlmProviderId(policy, 100)).toBe('ollama');
    expect(selectLlmProviderId(policy, 101)).toBe('openrouter');
    expect(activeLlmProviderIds(policy)).toEqual(['ollama', 'openrouter']);
  });
});
