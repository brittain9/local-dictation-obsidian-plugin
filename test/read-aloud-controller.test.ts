import type { Editor, EditorPosition } from 'obsidian';
import { describe, expect, it } from 'vitest';

import { resolveReadRange } from '../src/tts/read-aloud-controller';

function editorFor(source: string, cursor: EditorPosition, selection?: [number, number]): Editor {
  const lines = source.split('\n');
  const offset = (position: EditorPosition): number => {
    let result = 0;
    for (let line = 0; line < position.line; line += 1) result += (lines[line]?.length ?? 0) + 1;
    return result + position.ch;
  };
  const position = (value: number): EditorPosition => {
    let remaining = value;
    for (let line = 0; line < lines.length; line += 1) {
      const length = lines[line]?.length ?? 0;
      if (remaining <= length) return { ch: remaining, line };
      remaining -= length + 1;
    }
    return { ch: 0, line: lines.length - 1 };
  };
  return {
    getCursor: (side?: string) => {
      if (selection === undefined) return cursor;
      return side === 'anchor' ? position(selection[0]) : position(selection[1]);
    },
    getLine: (line: number) => lines[line] ?? '',
    posToOffset: offset,
    somethingSelected: () => selection !== undefined,
  } as unknown as Editor;
}

describe('resolveReadRange', () => {
  it('reads an exact selection regardless of selection direction', () => {
    const source = 'Before selected after';
    expect(resolveReadRange(editorFor(source, { ch: 0, line: 0 }, [15, 7]), source, false)).toEqual(
      {
        from: 7,
        to: 15,
      },
    );
  });

  it('starts at the current Markdown block and continues to the end', () => {
    const source = 'First block\ncontinues\n\nCurrent block\ncontinues\n\nLast';
    const editor = editorFor(source, { ch: 3, line: 4 });
    expect(source.slice(resolveReadRange(editor, source, false).from)).toBe(
      'Current block\ncontinues\n\nLast',
    );
  });

  it('reads the entire note for the explicit scope', () => {
    const source = 'One\n\nTwo';
    expect(resolveReadRange(editorFor(source, { ch: 1, line: 2 }), source, true)).toEqual({
      from: 0,
      to: source.length,
    });
  });
});
