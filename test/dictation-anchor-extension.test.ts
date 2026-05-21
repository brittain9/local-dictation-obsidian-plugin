import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
  clearAnchorEffect,
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

  it('setAnchorEffect pins the anchor position', () => {
    const state = createState('hello world');
    const next = state.update({ effects: setAnchorEffect.of(6) }).state;
    expect(next.field(dictationAnchorStateField).pos).toBe(6);
  });

  it('setAnchorModeEffect updates the mode without moving pos', () => {
    const state = createState('hello world');
    const pinned = state.update({ effects: setAnchorEffect.of(6) }).state;
    const next = pinned.update({ effects: setAnchorModeEffect.of('visible') }).state;
    expect(next.field(dictationAnchorStateField)).toEqual({
      pos: 6,
      mode: 'visible',
    });
  });

  it('clearAnchorEffect resets pos to null and mode to hidden', () => {
    const state = createState('hello world');
    const pinned = state.update({
      effects: [setAnchorEffect.of(6), setAnchorModeEffect.of('visible')],
    }).state;
    const next = pinned.update({ effects: clearAnchorEffect.of(null) }).state;
    expect(next.field(dictationAnchorStateField)).toEqual({
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

  // Cursor-overlap regression: a single visible widget must render and stay
  // visible whether the cursor sits before, on, or moves on/off the anchor.
  it.each([
    ['cursor before anchor', 0, 6],
    ['cursor overlaps anchor', 6, 6],
    ['end_of_note anchor overlaps cursor at doc end', 11, 11],
  ] as const)('keeps the visible widget visible (%s)', (_label, selectionHead, anchorPos) => {
    const state = createState('hello world', selectionHead).update({
      effects: [setAnchorEffect.of(anchorPos), setAnchorModeEffect.of('visible')],
    }).state;

    expect(countDecorations(state)).toBe(1);
  });

  it('keeps the visible widget through selection moving onto and away from the anchor', () => {
    const initial = createState('hello world', 0).update({
      effects: [setAnchorEffect.of(6), setAnchorModeEffect.of('visible')],
    }).state;
    const overlapping = initial.update({ selection: EditorSelection.cursor(6) }).state;
    const movedAway = overlapping.update({ selection: EditorSelection.cursor(0) }).state;

    expect([
      countDecorations(initial),
      countDecorations(overlapping),
      countDecorations(movedAway),
    ]).toEqual([1, 1, 1]);
  });
});
