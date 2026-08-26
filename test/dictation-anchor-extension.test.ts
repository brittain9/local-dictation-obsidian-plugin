import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
  dictationAnchorDecorationsField,
  dictationAnchorStateField,
  setAnchorEffect,
  setAnchorModeEffect,
} from '../src/editor/dictation-anchor-extension';

function createState(doc: string, selectionHead = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(selectionHead),
    extensions: [dictationAnchorStateField, dictationAnchorDecorationsField],
  });
}

function countDecorations(state: EditorState): number {
  let count = 0;
  state.field(dictationAnchorDecorationsField).between(0, state.doc.length + 1, () => {
    count += 1;
  });
  return count;
}

describe('dictationAnchorStateField', () => {
  it('starts with pos null and hidden mode', () => {
    const state = createState('hello');
    expect(state.field(dictationAnchorStateField)).toEqual({
      pos: null,
      mode: 'hidden',
    });
  });

  it('extends the anchor past insertions at the anchor position (tail bias +1)', () => {
    const state = createState('hello world');
    const pinned = state.update({ effects: setAnchorEffect.of(6) }).state;
    const edited = pinned.update({ changes: { from: 6, insert: 'NEW ' } }).state;
    expect(edited.field(dictationAnchorStateField).pos).toBe(10);
    expect(edited.doc.toString()).toBe('hello NEW world');
  });

  it('shifts the anchor forward when text is inserted before it', () => {
    const state = createState('hello world');
    const pinned = state.update({ effects: setAnchorEffect.of(6) }).state;
    const edited = pinned.update({ changes: { from: 0, insert: '!!! ' } }).state;
    expect(edited.field(dictationAnchorStateField).pos).toBe(10);
  });

  it('applies setAnchor and change in the same transaction with setAnchor taking precedence', () => {
    const state = createState('hello world');
    const pinned = state.update({ effects: setAnchorEffect.of(6) }).state;
    const edited = pinned.update({
      changes: { from: 6, insert: 'phrase' },
      effects: setAnchorEffect.of(12),
    }).state;
    expect(edited.doc.toString()).toBe('hello phraseworld');
    expect(edited.field(dictationAnchorStateField).pos).toBe(12);
  });

  it('keeps the visible widget through cursor overlap and movement', () => {
    let state = createState('hello world', 0).update({
      effects: [setAnchorEffect.of(6), setAnchorModeEffect.of('visible')],
    }).state;
    expect(countDecorations(state)).toBe(1);

    state = state.update({ selection: EditorSelection.cursor(6) }).state;
    expect(countDecorations(state)).toBe(1);

    state = state.update({ selection: EditorSelection.cursor(0) }).state;
    expect(countDecorations(state)).toBe(1);

    const endOfNote = createState('hello world', 11).update({
      effects: [setAnchorEffect.of(11), setAnchorModeEffect.of('visible')],
    }).state;
    expect(countDecorations(endOfNote)).toBe(1);
  });
});
