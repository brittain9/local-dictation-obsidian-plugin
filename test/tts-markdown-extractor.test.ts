import { describe, expect, it } from 'vitest';

import {
  extractAndSegmentMarkdown,
  extractSpeakableMarkdown,
  segmentSpeakableText,
} from '../src/tts/markdown-extractor';

describe('extractSpeakableMarkdown', () => {
  it('drops frontmatter, code, and math while speaking markdown labels and table cells', () => {
    const source = [
      '---',
      'title: Hidden',
      '---',
      '# Heading',
      'Read **bold** and [the label](https://example.com).',
      '```ts',
      'doNotSpeak()',
      '```',
      '| Name | Value |',
      '| --- | --- |',
      '| Alpha | `skip` Beta |',
      '$x + y$ Finish.',
    ].join('\n');

    expect(extractSpeakableMarkdown(source).text).toBe(
      'Heading Read bold and the label. Name Value Alpha Beta Finish.',
    );
  });

  it('maps link display text and headings back to their source characters', () => {
    const source = '# Hello [friendly world](https://example.com).';
    const mapped = extractSpeakableMarkdown(source);
    expect(mapped.text).toBe('Hello friendly world.');
    expect(
      mapped.sourceOffsets
        .slice(0, 1)
        .map((offset) => source[offset])
        .join(''),
    ).toBe('H');
    const worldIndex = mapped.text.indexOf('world');
    expect(
      mapped.sourceOffsets
        .slice(worldIndex, worldIndex + 'world'.length)
        .map((offset) => source[offset])
        .join(''),
    ).toBe('world');
  });
});

describe('segmentSpeakableText', () => {
  it('merges short sentences and preserves source ranges', () => {
    const source = 'One. Two. This sentence is long enough to flush the merged chunk.';
    const mapped = extractSpeakableMarkdown(source);
    const chunks = segmentSpeakableText(mapped, { minimumCharacters: 12 });
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'One. Two. This sentence is long enough to flush the merged chunk.',
    ]);
    expect(chunks[0]?.sourceRange).toEqual({ from: 0, to: source.length });
  });

  it('offsets selection ranges into the full note', () => {
    const source = 'Ignore. Speak this sentence.';
    expect(extractAndSegmentMarkdown(source, { from: 8, to: source.length })[0]).toEqual({
      sourceRange: { from: 8, to: source.length },
      text: 'Speak this sentence.',
    });
  });

  it('bounds chunks even when prose has no sentence punctuation', () => {
    const source = Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ');
    const chunks = segmentSpeakableText(extractSpeakableMarkdown(source), {
      maximumCharacters: 60,
      minimumCharacters: 20,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 60)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join(' ')).toBe(source);
  });
});
