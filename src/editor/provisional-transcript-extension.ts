import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

export interface ProvisionalTranscriptRange {
  from: number;
  to: number;
  utteranceId: string;
}

export const setProvisionalTranscriptEffect = StateEffect.define<ProvisionalTranscriptRange>();
export const clearProvisionalTranscriptEffect = StateEffect.define<readonly string[]>();

export const provisionalTranscriptStateField = StateField.define<
  ReadonlyMap<string, ProvisionalTranscriptRange>
>({
  create: () => new Map(),
  update(value, transaction) {
    const next = new Map<string, ProvisionalTranscriptRange>();

    for (const [utteranceId, range] of value) {
      const from = transaction.changes.mapPos(range.from, -1);
      const to = transaction.changes.mapPos(range.to, 1);
      if (from < to) {
        next.set(utteranceId, { from, to, utteranceId });
      }
    }

    for (const effect of transaction.effects) {
      if (effect.is(setProvisionalTranscriptEffect)) {
        const range = effect.value;
        if (range.from < range.to) {
          next.set(range.utteranceId, { ...range });
        } else {
          next.delete(range.utteranceId);
        }
      } else if (effect.is(clearProvisionalTranscriptEffect)) {
        for (const utteranceId of effect.value) {
          next.delete(utteranceId);
        }
      }
    }

    return next;
  },
});

const PROVISIONAL_DECORATION = Decoration.mark({ class: 'local-stt-transcript-provisional' });

export const provisionalTranscriptDecorationsField = StateField.define<DecorationSet>({
  create: (state) => decorationsFor(state),
  update: (_value, transaction) => decorationsFor(transaction.state),
  provide: (field) => EditorView.decorations.from(field),
});

function decorationsFor(state: EditorState): DecorationSet {
  const ranges = state.field(provisionalTranscriptStateField, false);
  if (ranges === undefined || ranges.size === 0) {
    return Decoration.none;
  }

  return Decoration.set(
    [...ranges.values()]
      .sort((left, right) => left.from - right.from || left.to - right.to)
      .map((range) => PROVISIONAL_DECORATION.range(range.from, range.to)),
  );
}

export function provisionalTranscriptExtension(): Extension {
  return [provisionalTranscriptStateField, provisionalTranscriptDecorationsField];
}
