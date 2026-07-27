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

    expect(texts).toEqual([
      'Project update',
      'Review',
      'Read',
      'the specification',
      'Keep',
      ', and',
      'unchanged.',
    ]);

    const translated = rebuildTranslatedMarkdown(
      segments,
      texts.map((text) => `«${text}»`),
    );
    expect(translated).toContain('[[Local Dictation]]');
    expect(translated).toContain('(https://example.com/spec?q=1)');
    expect(translated).toContain('`npm run check`');
    expect(translated).toContain('#release');
    expect(translated).toContain('$x + y$');
    expect(translated).toContain('const greeting = "Hello";');
    expect(translated).toMatch(/^- \[x\]/mu);
  });

  it('round trips byte-for-byte when translations are unchanged', () => {
    const source =
      '> [!NOTE] Important\n\n| Name | Value |\n| --- | --- |\n| Alex | 42 |\n\nPlain text.\n';
    const segments = segmentMarkdownForTranslation(source);

    expect(rebuildTranslatedMarkdown(segments, translatableTexts(segments))).toBe(source);
  });

  it('rejects mismatched runtime output', () => {
    const segments = segmentMarkdownForTranslation('Translate this.');

    expect(() => rebuildTranslatedMarkdown(segments, [])).toThrow(/too few/u);
    expect(() => rebuildTranslatedMarkdown(segments, ['One', 'Two'])).toThrow(/too many/u);
  });
});
