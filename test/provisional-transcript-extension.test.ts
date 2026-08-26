import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
  clearProvisionalTranscriptEffect,
  provisionalTranscriptDecorationsField,
  provisionalTranscriptExtension,
  provisionalTranscriptStateField,
  setProvisionalTranscriptEffect,
} from '../src/editor/provisional-transcript-extension';

function state(doc = 'alpha beta'): EditorState {
  return EditorState.create({ doc, extensions: provisionalTranscriptExtension() });
}

function decorationRanges(editorState: EditorState): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  editorState
    .field(provisionalTranscriptDecorationsField)
    .between(0, editorState.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
  return ranges;
}

describe('provisionalTranscriptExtension', () => {
  it('applies and clears a provisional decoration by utterance', () => {
    const applied = state().update({
      effects: setProvisionalTranscriptEffect.of({ from: 0, to: 5, utteranceId: 'u1' }),
    }).state;

    expect(decorationRanges(applied)).toEqual([{ from: 0, to: 5 }]);
    const cleared = applied.update({
      effects: clearProvisionalTranscriptEffect.of(['u1']),
    }).state;
    expect(decorationRanges(cleared)).toEqual([]);
  });

  it('maps provisional ranges through edits before and inside the span', () => {
    const applied = state().update({
      effects: setProvisionalTranscriptEffect.of({ from: 6, to: 10, utteranceId: 'u1' }),
    }).state;
    const editedBefore = applied.update({ changes: { from: 0, insert: 'say ' } }).state;
    const editedInside = editedBefore.update({ changes: { from: 12, insert: '!' } }).state;

    expect(editedInside.field(provisionalTranscriptStateField).get('u1')).toEqual({
      from: 10,
      to: 15,
      utteranceId: 'u1',
    });
    expect(decorationRanges(editedInside)).toEqual([{ from: 10, to: 15 }]);
  });

  it('does not style text inserted at the exact provisional tail', () => {
    const applied = state().update({
      effects: setProvisionalTranscriptEffect.of({ from: 0, to: 5, utteranceId: 'u1' }),
    }).state;
    const editedAtTail = applied.update({ changes: { from: 5, insert: ' typed' } }).state;

    expect(editedAtTail.field(provisionalTranscriptStateField).get('u1')).toEqual({
      from: 0,
      to: 5,
      utteranceId: 'u1',
    });
    expect(decorationRanges(editedAtTail)).toEqual([{ from: 0, to: 5 }]);
  });

  it('clears only the requested session spans during teardown', () => {
    const applied = state().update({
      effects: [
        setProvisionalTranscriptEffect.of({ from: 0, to: 5, utteranceId: 'u1' }),
        setProvisionalTranscriptEffect.of({ from: 6, to: 10, utteranceId: 'u2' }),
      ],
    }).state;
    const cleared = applied.update({
      effects: clearProvisionalTranscriptEffect.of(['u1']),
    }).state;

    expect([...cleared.field(provisionalTranscriptStateField).keys()]).toEqual(['u2']);
    expect(decorationRanges(cleared)).toEqual([{ from: 6, to: 10 }]);
  });
});
