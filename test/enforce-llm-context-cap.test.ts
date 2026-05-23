import { describe, expect, it } from 'vitest';

import { enforceLlmContextCap } from '../src/dictation/dictation-session-controller';
import type { ContextWindowSource } from '../src/sidecar/protocol';

function source(
  kind: ContextWindowSource['kind'],
  text: string,
  truncated = false,
): ContextWindowSource {
  return { kind, text, truncated } as ContextWindowSource;
}

describe('enforceLlmContextCap', () => {
  it('leaves sources unchanged when total text already fits the cap', () => {
    const sources = [
      source('note_text', 'note'),
      source('prior_utterance', 'prior'),
      source('note_glossary', 'term'),
    ];

    expect(enforceLlmContextCap(sources, 100)).toEqual(sources);
  });

  it('trims note text first when the cap is exceeded', () => {
    expect(
      enforceLlmContextCap([source('note_text', 'abcdef'), source('prior_utterance', 'ghij')], 7),
    ).toEqual([source('note_text', 'abc', true), source('prior_utterance', 'ghij')]);
  });

  it('trims prior utterances after note text is exhausted', () => {
    expect(
      enforceLlmContextCap([source('note_text', 'abcdef'), source('prior_utterance', 'ghij')], 2),
    ).toEqual([source('prior_utterance', 'gh', true)]);
  });

  it('returns no sources when the cap is zero', () => {
    expect(
      enforceLlmContextCap(
        [source('note_glossary', 'terms'), source('prior_utterance', 'prior')],
        0,
      ),
    ).toEqual([]);
  });

  it('does not mutate the input source array or source objects', () => {
    const note = source('note_text', 'abcdef');
    const prior = source('prior_utterance', 'ghij');
    const sources = [note, prior];

    const capped = enforceLlmContextCap(sources, 7);

    expect(sources).toEqual([source('note_text', 'abcdef'), source('prior_utterance', 'ghij')]);
    expect(sources[0]).toBe(note);
    expect(sources[1]).toBe(prior);
    expect(capped[0]).not.toBe(note);
  });
});
