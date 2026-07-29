import { describe, expect, it } from 'vitest';

import {
  protectedMarkerModeForLanguages,
  rebuildTranslatedMarkdown,
  segmentMarkdownForTranslation,
  translatableTexts,
} from '../src/translation/markdown-segmentation';

describe('Markdown translation segmentation', () => {
  it('uses Japanese-safe markers only for Japanese pairs', () => {
    expect(protectedMarkerModeForLanguages('en', 'ja')).toBe('synthetic-url');
    expect(protectedMarkerModeForLanguages('ja', 'en')).toBe('synthetic-url');
    expect(protectedMarkerModeForLanguages('en', 'es')).toBe('private-use');
  });

  it('preserves note structure and protected content exactly', () => {
    const source = `---
title: Daily note
tags: [work]
---
# Project update

- [x] Review [[Speech Kit]]
- Read [the specification](https://example.com/spec?q=1)
- Keep \`npm run check\`, #release, and $x + y$ unchanged.

\`\`\`ts
const greeting = "Hello";
\`\`\`
`;
    const segments = segmentMarkdownForTranslation(source);
    const texts = translatableTexts(segments);

    expect(texts).toHaveLength(5);
    expect(texts.at(-1)).toContain('Keep');
    expect(texts.at(-1)).toContain('and');
    expect(texts.at(-1)).toContain('unchanged.');

    const { text: translated } = rebuildTranslatedMarkdown(segments, texts);
    expect(translated).toContain('[[Speech Kit]]');
    expect(translated).toContain('(https://example.com/spec?q=1)');
    expect(translated).toContain('`npm run check`');
    expect(translated).toContain('#release');
    expect(translated).toContain('$x + y$');
    expect(translated).toContain('const greeting = "Hello";');
    expect(translated).toMatch(/^- \[x\]/mu);
  });

  it('keeps each sentence together when protected Markdown appears inline', () => {
    const source = 'Keep `npm run check`, #release, and $x + y$ unchanged.';
    const texts = translatableTexts(segmentMarkdownForTranslation(source));

    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('Keep');
    expect(texts[0]).toContain('and');
    expect(texts[0]).toContain('unchanged.');
  });

  it('protects longer fenced blocks and inline double-dollar math', () => {
    const source = `Before.

\`\`\`\`text
do_not_translate()
\`\`\`
still_code()
\`\`\`\`

The value $$x + y$$ stays literal.
`;
    const segments = segmentMarkdownForTranslation(source);

    expect(translatableTexts(segments).join('\n')).not.toContain('do_not_translate');
    expect(translatableTexts(segments).join('\n')).not.toContain('still_code');
    expect(translatableTexts(segments).join('\n')).not.toContain('x + y');
    expect(rebuildTranslatedMarkdown(segments, translatableTexts(segments)).text).toBe(source);
  });

  it('round trips byte-for-byte when translations are unchanged', () => {
    const source =
      '> [!NOTE] Important\n\n| Name | Value |\n| --- | --- |\n| Alex | 42 |\n\nPlain text.\n';
    const segments = segmentMarkdownForTranslation(source);

    expect(rebuildTranslatedMarkdown(segments, translatableTexts(segments)).text).toBe(source);
  });

  it('bounds long translation units without changing the source structure', () => {
    const source = `${'word '.repeat(1_000).trim()}\n`;
    const segments = segmentMarkdownForTranslation(source);
    const texts = translatableTexts(segments);

    expect(texts.length).toBeGreaterThan(1);
    expect(texts.every((text) => text.length <= 2_000)).toBe(true);
    expect(rebuildTranslatedMarkdown(segments, texts).text).toBe(source);
  });

  it('keeps a unit in the source language when its protected slots come back changed', () => {
    const segments = segmentMarkdownForTranslation('Keep `code` and [[Note]] unchanged.');
    const texts = translatableTexts(segments);
    const markers = texts[0]?.match(/[\uE000-\uF8FF]/gu) ?? [];
    expect(markers).toHaveLength(2);
    const reordered = texts[0]
      ?.replace(markers[0] as string, '\uF8FF')
      .replace(markers[1] as string, markers[0] as string)
      .replace('\uF8FF', markers[1] as string);

    const reorderedResult = rebuildTranslatedMarkdown(segments, [reordered as string]);
    expect(reorderedResult.sourceUnitsKept).toBe(1);
    expect(reorderedResult.text).toBe('Keep `code` and [[Note]] unchanged.');

    const dropped = texts[0]?.replace(markers[1] as string, '');
    const droppedResult = rebuildTranslatedMarkdown(segments, [dropped as string]);
    expect(droppedResult.sourceUnitsKept).toBe(1);
    expect(droppedResult.text).toBe('Keep `code` and [[Note]] unchanged.');
  });

  it('uses distinct Japanese-safe markers when source text contains a marker candidate', () => {
    const source = 'Keep <https://0.invalid> and `code` unchanged.';
    const segments = segmentMarkdownForTranslation(source, {
      protectedMarkerMode: 'synthetic-url',
    });
    const texts = translatableTexts(segments);

    expect(texts[0]).not.toContain('https://0.invalid');
    expect(texts[0]).toContain('https://1.invalid');
    expect(rebuildTranslatedMarkdown(segments, texts).text).toBe(source);
  });

  it('translates formatted Japanese prose without wrapping it in synthetic URLs', () => {
    const source =
      '**Accurate Speech-to-Text**: Converts spoken words into text with high precision.';
    const segments = segmentMarkdownForTranslation(source, {
      protectedMarkerMode: 'synthetic-url',
    });
    const texts = translatableTexts(segments);

    expect(texts).toEqual([
      'Accurate Speech-to-Text',
      'Converts spoken words into text with high precision.',
    ]);
    expect(rebuildTranslatedMarkdown(segments, texts).text).toBe(source);
  });

  it('protects indented code blocks and fenced code inside blockquotes', () => {
    const source = `Intro paragraph.

    indented_code_block()
    still_code()

> Quoted intro.
>
> \`\`\`py
> print("hi")
> \`\`\`
`;
    const segments = segmentMarkdownForTranslation(source);
    const translatable = translatableTexts(segments).join('\n');

    expect(translatable).not.toContain('indented_code_block');
    expect(translatable).not.toContain('still_code');
    expect(translatable).not.toContain('print("hi")');
    expect(translatable).toContain('Quoted intro.');
    expect(rebuildTranslatedMarkdown(segments, translatableTexts(segments)).text).toBe(source);
  });

  it('still translates paragraphs that continue a list item', () => {
    const source = '- A list item\n\n  A continuation paragraph.\n';
    const segments = segmentMarkdownForTranslation(source);
    const translatable = translatableTexts(segments).join('\n');

    expect(translatable).toContain('A list item');
    expect(translatable).toContain('A continuation paragraph.');
  });

  it('rejects mismatched runtime output', () => {
    const segments = segmentMarkdownForTranslation('Translate this.');

    expect(() => rebuildTranslatedMarkdown(segments, [])).toThrow(/too few/u);
    expect(() => rebuildTranslatedMarkdown(segments, ['One', 'Two'])).toThrow(/too many/u);
  });
});
