import { describe, expect, it } from 'vitest';

import {
  rebuildTranslatedMarkdown,
  segmentMarkdownForTranslation,
  translatableTexts,
} from '../src/translation/markdown-segmentation';

describe('Markdown translation segmentation', () => {
  it('preserves note structure and protected content exactly', () => {
    const source = `---
title: Daily note
tags: [work]
---
# Project update

- [x] Review [[Local Dictation]]
- Read [the specification](https://example.com/spec?q=1)
- Keep \`npm run check\`, #release, and $x + y$ unchanged.

\`\`\`ts
const greeting = "Hello";
\`\`\`
`;
    const segments = segmentMarkdownForTranslation(source);
    const texts = translatableTexts(segments);

    expect(texts).toHaveLength(4);
    expect(texts[3]).toContain('Keep');
    expect(texts[3]).toContain('and');
    expect(texts[3]).toContain('unchanged.');

    const translated = rebuildTranslatedMarkdown(segments, texts);
    expect(translated).toContain('[[Local Dictation]]');
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
    expect(rebuildTranslatedMarkdown(segments, translatableTexts(segments))).toBe(source);
  });

  it('round trips byte-for-byte when translations are unchanged', () => {
    const source =
      '> [!NOTE] Important\n\n| Name | Value |\n| --- | --- |\n| Alex | 42 |\n\nPlain text.\n';
    const segments = segmentMarkdownForTranslation(source);

    expect(rebuildTranslatedMarkdown(segments, translatableTexts(segments))).toBe(source);
  });

  it('bounds long translation units without changing the source structure', () => {
    const source = `${'word '.repeat(1_000).trim()}\n`;
    const segments = segmentMarkdownForTranslation(source);
    const texts = translatableTexts(segments);

    expect(texts.length).toBeGreaterThan(1);
    expect(texts.every((text) => text.length <= 2_000)).toBe(true);
    expect(rebuildTranslatedMarkdown(segments, texts)).toBe(source);
  });

  it('rejects reordered protected slots instead of producing corrupt Markdown', () => {
    const segments = segmentMarkdownForTranslation('Keep `code` and [[Note]] unchanged.');
    const texts = translatableTexts(segments);
    const markers = texts[0]?.match(/[\uE000-\uF8FF]/gu) ?? [];
    expect(markers).toHaveLength(2);
    const reordered = texts[0]
      ?.replace(markers[0] as string, '\uF8FF')
      .replace(markers[1] as string, markers[0] as string)
      .replace('\uF8FF', markers[1] as string);

    expect(() => rebuildTranslatedMarkdown(segments, [reordered as string])).toThrow(
      /changed protected Markdown slots/u,
    );
  });

  it('rejects mismatched runtime output', () => {
    const segments = segmentMarkdownForTranslation('Translate this.');

    expect(() => rebuildTranslatedMarkdown(segments, [])).toThrow(/too few/u);
    expect(() => rebuildTranslatedMarkdown(segments, ['One', 'Two'])).toThrow(/too many/u);
  });
});
