import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

export interface SessionProcessingRange {
  from: number;
  to: number;
}

export const setSessionProcessingEffect = StateEffect.define<SessionProcessingRange | null>();

export const sessionProcessingStateField = StateField.define<SessionProcessingRange | null>({
  create: () => null,
  update(value, tr) {
    let next = value;

    if (next !== null && !tr.changes.empty) {
      const mappedFrom = tr.changes.mapPos(next.from, -1);
      const mappedTo = tr.changes.mapPos(next.to, 1);
      next = mappedFrom < mappedTo ? { from: mappedFrom, to: mappedTo } : null;
    }

    for (const effect of tr.effects) {
      if (effect.is(setSessionProcessingEffect)) {
        const range = effect.value;
        next = range === null || range.from >= range.to ? null : { ...range };
      }
    }

    return next;
  },
});

const EMPTY_DECORATIONS: DecorationSet = Decoration.none;

const PROCESSING_DECORATION = Decoration.mark({ class: 'local-stt-session-processing' });

export const sessionProcessingDecorationsField = StateField.define<DecorationSet>({
  create(state) {
    return decorationsFor(state);
  },
  update(value, tr) {
    const prev = tr.startState.field(sessionProcessingStateField, false);
    const next = tr.state.field(sessionProcessingStateField, false);
    if (prev === next) {
      return value;
    }
    return decorationsFor(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function decorationsFor(state: EditorState): DecorationSet {
  const range = state.field(sessionProcessingStateField, false);
  if (range === undefined || range === null) {
    return EMPTY_DECORATIONS;
  }
  return Decoration.set([PROCESSING_DECORATION.range(range.from, range.to)]);
}

export function sessionProcessingExtension(): Extension {
  return [sessionProcessingStateField, sessionProcessingDecorationsField];
}
