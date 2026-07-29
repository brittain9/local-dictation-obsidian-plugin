import { describe, expect, it } from 'vitest';

import {
  rebuildTranslatedMarkdown,
  segmentMarkdownForTranslation,
  translatableTexts,
} from '../src/translation/markdown-segmentation';

describe('Markdown translation segmentation', () => {
  it('keeps formatted prose in one native HTML translation unit', () => {
    const source = 'Please press **Ctrl+S** to save your work before closing.';
    const segments = segmentMarkdownForTranslation(source);

    expect(translatableTexts(segments)).toEqual([
      'Please press <strong data-md="0">Ctrl+S</strong> to save your work before closing.',
    ]);
  });

  it('restores emphasis after alignment moves it for Japanese word order', () => {
    const segments = segmentMarkdownForTranslation(
      'Please press **Ctrl+S** to save your work before closing.',
    );

    const rebuilt = rebuildTranslatedMarkdown(segments, [
      '閉じる前に<strong data-md="0">Ctrl+S</strong>を押して、作業を保存してください。',
    ]);

    expect(rebuilt).toEqual({
      sourceUnitsKept: 0,
      text: '閉じる前に**Ctrl+S**を押して、作業を保存してください。',
    });
  });

  it('preserves exact Markdown syntax through an unchanged HTML round trip', () => {
    const source =
      'Use __bold__, _italics_, ~~removed~~, ==marked==, [the spec](https://example.com/a?x=1&y=2), `npm run check`, [[Note|Alias]], $x + y$, #release, and <kbd>raw</kbd>.';
    const segments = segmentMarkdownForTranslation(source);
    const texts = translatableTexts(segments);

    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('<strong data-md="0">bold</strong>');
    expect(texts[0]).toContain('<a data-md="4">the spec</a>');
    expect(texts[0]).toContain('<span data-md="5">');
    expect(texts[0]).not.toMatch(/[\uE000-\uF8FF]|https:\/\/\d+\.invalid/u);
    expect(rebuildTranslatedMarkdown(segments, texts)).toEqual({
      sourceUnitsKept: 0,
      text: source,
    });
  });

  it('preserves compound emphasis without treating intraword underscores as Markdown', () => {
    const source = 'Use ***both styles*** and foo_bar_baz in prose.';
    const segments = segmentMarkdownForTranslation(source);
    const [html] = translatableTexts(segments);

    expect(html).toContain('<strong data-md="0"><em data-md="1">both styles</em></strong>');
    expect(html).toContain('foo_bar_baz');
    expect(rebuildTranslatedMarkdown(segments, [html ?? '']).text).toBe(source);
  });

  it('preserves complete link destinations with parentheses, angle brackets, and titles', () => {
    const source =
      'Read [nested](https://example.com/a_(b) "Title (v2)") and [angle](<https://example.com/a b>).';
    const segments = segmentMarkdownForTranslation(source);

    expect(
      rebuildTranslatedMarkdown(segments, [
        'Lee <a data-md="0">anidado</a> y <a data-md="1">ángulo</a>.',
      ]).text,
    ).toBe(
      'Lee [anidado](https://example.com/a_(b) "Title (v2)") y [ángulo](<https://example.com/a b>).',
    );
  });

  it('translates raw HTML container text while restoring the exact original tags', () => {
    const source = "<mark data-kind='result'>Hello world</mark> continues with <kbd>Ctrl+S</kbd>.";
    const segments = segmentMarkdownForTranslation(source);
    const [html] = translatableTexts(segments);

    expect(html).toContain('<mark data-md="0">Hello world</mark>');
    expect(html).toContain('<span data-md="1">code</span>');
    expect(
      rebuildTranslatedMarkdown(segments, [
        '<mark data-md="0">Hola mundo</mark> continúa con <span data-md="1">código</span>.',
      ]).text,
    ).toBe("<mark data-kind='result'>Hola mundo</mark> continúa con <kbd>Ctrl+S</kbd>.");
  });

  it('keeps protected inline content inside the surrounding sentence', () => {
    const source = 'Keep `npm run check`, [[Local Dictation]], and $x + y$ unchanged.';
    const texts = translatableTexts(segmentMarkdownForTranslation(source));

    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(
      /^Keep <span .+<\/span>, <span .+<\/span>, and <span .+<\/span> unchanged\.$/u,
    );
  });

  it('restores protected spans byte-for-byte without decoding their entities', () => {
    const source = 'Keep `a &amp; <b>` unchanged & ready.';
    const segments = segmentMarkdownForTranslation(source);
    const [html] = translatableTexts(segments);

    expect(html).toContain('<span data-md="0">code</span>');
    expect(html).not.toContain('a &amp;amp; &lt;b&gt;');
    expect(
      rebuildTranslatedMarkdown(segments, [
        'Mantén <span data-md="0">translated</span> sin cambios &amp; listo.',
      ]).text,
    ).toBe('Mantén `a &amp; <b>` sin cambios & listo.');
  });

  it('preserves note structure and block-level protected content', () => {
    const source = `---
title: Daily note
tags: [work]
---
# Project update

- [x] Review [[Speech Kit]]

\`\`\`\`ts
const greeting = "Hello";
\`\`\`
still_code()
\`\`\`\`

$$
x + y
$$
`;
    const segments = segmentMarkdownForTranslation(source);
    const texts = translatableTexts(segments);

    expect(texts.join('\n')).not.toContain('title: Daily note');
    expect(texts.join('\n')).not.toContain('const greeting');
    expect(texts.join('\n')).not.toContain('still_code');
    expect(texts.join('\n')).not.toContain('x + y');
    expect(rebuildTranslatedMarkdown(segments, texts).text).toBe(source);
  });

  it('protects indented code and fenced code inside blockquotes', () => {
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

  it('round trips table syntax and callouts byte-for-byte', () => {
    const source =
      '> [!NOTE]+ Important\n\n| Name | Value |\n| --- | --- |\n| Alex | 42 |\n\nPlain text.\n';
    const segments = segmentMarkdownForTranslation(source);
    const [callout] = translatableTexts(segments);

    expect(callout).toMatch(/^<span data-md="0">note<\/span> Important$/u);
    expect(rebuildTranslatedMarkdown(segments, translatableTexts(segments)).text).toBe(source);
  });

  it('translates each table row as one contextual HTML unit', () => {
    const source = '| Tool | Status |\n| :--- | ---: |\n| [[Nemotron|Local model]] | Ready |\n';
    const segments = segmentMarkdownForTranslation(source);

    expect(translatableTexts(segments)).toEqual([
      '<output data-table-cell="0">Tool</output> — <output data-table-cell="1">Status</output>',
      '<output data-table-cell="0"><span data-md="0">note</span></output> — <output data-table-cell="1">Ready</output>',
    ]);
    expect(
      rebuildTranslatedMarkdown(segments, [
        '<output data-table-cell="0">Herramienta</output> — <output data-table-cell="1">Estado</output>',
        '<output data-table-cell="0"><span data-md="0">Nota</span></output> — <output data-table-cell="1">Listo</output>',
      ]).text,
    ).toBe('| Herramienta | Estado |\n| :--- | ---: |\n| [[Nemotron|Local model]] | Listo |\n');
  });

  it('rebuilds a table cell when word alignment splits one source wrapper', () => {
    const source = '| Phrase | State |\n| --- | --- |\n| **bold text** | Ready |\n';
    const segments = segmentMarkdownForTranslation(source);

    expect(
      rebuildTranslatedMarkdown(segments, [
        '<output data-table-cell="0">Frase</output> — <output data-table-cell="1">Estado</output>',
        '<output data-table-cell="0"><strong data-md="0">texto</strong> en <strong data-md="0">negrita</strong></output> — <output data-table-cell="1">Listo</output>',
      ]).text,
    ).toBe('| Frase | Estado |\n| --- | --- |\n| **texto** en **negrita** | Listo |\n');
  });

  it('keeps a one-column table structural while translating each row', () => {
    const source = '| Heading |\n| --- |\n| Value |\n';
    const segments = segmentMarkdownForTranslation(source);

    expect(translatableTexts(segments)).toEqual([
      '<output data-table-cell="0">Heading</output>',
      '<output data-table-cell="0">Value</output>',
    ]);
    expect(
      rebuildTranslatedMarkdown(segments, [
        '<output data-table-cell="0">Encabezado</output>',
        '<output data-table-cell="0">Valor</output>',
      ]).text,
    ).toBe('| Encabezado |\n| --- |\n| Valor |\n');
  });

  it('still translates paragraphs that continue a list item', () => {
    const source = '- A list item\n\n  A continuation paragraph.\n';
    const translatable = translatableTexts(segmentMarkdownForTranslation(source)).join('\n');

    expect(translatable).toContain('A list item');
    expect(translatable).toContain('A continuation paragraph.');
  });

  it('rejects missing, duplicated, or malformed restoration tags', () => {
    const segments = segmentMarkdownForTranslation('Use **bold** and `code`.');

    expect(() =>
      rebuildTranslatedMarkdown(segments, ['Use bold and <span data-md="1">code</span>.']),
    ).toThrow(/missing Markdown tag 0/u);
    expect(() =>
      rebuildTranslatedMarkdown(segments, [
        'Use <strong data-md="0">bold</strong> and <span data-md="1">code</span><span data-md="1">code</span>.',
      ]),
    ).toThrow(/duplicated protected Markdown tag 1/u);
    expect(() =>
      rebuildTranslatedMarkdown(segments, [
        'Use <strong data-md="0">bold and <span data-md="1">code</span>.',
      ]),
    ).toThrow(/unclosed Markdown tag 0/u);
  });

  it('rejects mismatched runtime output counts', () => {
    const segments = segmentMarkdownForTranslation('Translate this.');

    expect(() => rebuildTranslatedMarkdown(segments, [])).toThrow(/too few/u);
    expect(() => rebuildTranslatedMarkdown(segments, ['One', 'Two'])).toThrow(/too many/u);
  });
});
