import type { App, Editor } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import {
  findMarkdownHeadingTargets,
  openDictateUnderHeadingPicker,
  resolveHeadingSectionPlacement,
} from '../src/dictation/dictate-under-heading';

describe('dictate under heading', () => {
  it('anchors after nested subsection content and before the next peer heading', () => {
    const documentText = [
      '# Project',
      'intro',
      '## Notes',
      'existing',
      '### Detail',
      'deep',
      '',
      '## Actions',
      '- old',
      '# Appendix',
    ].join('\n');
    const headings = findMarkdownHeadingTargets(documentText);
    const notes = headings.find((heading) => heading.text === 'Notes');

    expect(notes?.path).toEqual(['Project', 'Notes']);
    expect(
      notes === undefined ? null : resolveHeadingSectionPlacement(documentText, notes),
    ).toEqual({
      anchor: 'section_end',
      position: documentText.indexOf('\n## Actions'),
    });
  });

  it('ignores headings in frontmatter and fenced code while disambiguating repeated headings', () => {
    const documentText = [
      '---',
      '# not a heading',
      '---',
      '# Project A',
      '## Updates',
      '```md',
      '# code sample',
      '```',
      '# Project B',
      '## Updates ###',
    ].join('\n');

    expect(
      findMarkdownHeadingTargets(documentText).map(({ level, path, text }) => ({
        level,
        path,
        text,
      })),
    ).toEqual([
      { level: 1, path: ['Project A'], text: 'Project A' },
      { level: 2, path: ['Project A', 'Updates'], text: 'Updates' },
      { level: 1, path: ['Project B'], text: 'Project B' },
      { level: 2, path: ['Project B', 'Updates'], text: 'Updates' },
    ]);
  });

  it('recomputes the section end from current text when content changes below the chosen heading', () => {
    let documentText = '# Log\n## Notes\nold\n## Next\ntail';
    const editor = { getValue: () => documentText } as Editor;
    const onChoose = vi.fn(async () => {});
    const feedback = { show: vi.fn() };
    const modal = openDictateUnderHeadingPicker({} as App, editor, { feedback, onChoose });
    const notes = modal?.getItems().find((heading) => heading.text === 'Notes');
    if (modal === null || notes === undefined) throw new Error('expected heading picker fixture');

    documentText = '# Log\n## Notes\nold\nnew\n## Next\ntail';
    modal.onChooseItem(notes);

    expect(onChoose).toHaveBeenCalledWith({
      documentText,
      placement: { anchor: 'section_end', position: documentText.indexOf('\n## Next') },
    });
    expect(feedback.show).not.toHaveBeenCalled();
  });

  it('refuses a stale heading instead of targeting a shifted lookalike', () => {
    let documentText = '# First\n## Notes\nbody';
    const editor = { getValue: () => documentText } as Editor;
    const onChoose = vi.fn(async () => {});
    const feedback = { show: vi.fn() };
    const modal = openDictateUnderHeadingPicker({} as App, editor, { feedback, onChoose });
    const notes = modal?.getItems().find((heading) => heading.text === 'Notes');
    if (modal === null || notes === undefined) throw new Error('expected heading picker fixture');

    documentText = `preface\n${documentText}`;
    modal.onChooseItem(notes);

    expect(onChoose).not.toHaveBeenCalled();
    expect(feedback.show).toHaveBeenCalledWith({
      intent: 'warning',
      key: 'dictate-under-heading-changed',
      message: 'That heading changed while the picker was open. Run Dictate under heading again.',
    });
  });

  it('explains when the note has no headings instead of opening an empty picker', () => {
    const feedback = { show: vi.fn() };

    const modal = openDictateUnderHeadingPicker(
      {} as App,
      { getValue: () => 'plain note' } as Editor,
      { feedback, onChoose: vi.fn(async () => {}) },
    );

    expect(modal).toBeNull();
    expect(feedback.show).toHaveBeenCalledWith({
      intent: 'information',
      key: 'dictate-under-heading-none',
      message: 'This note has no Markdown headings.',
    });
  });
});
